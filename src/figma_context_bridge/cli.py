from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

import requests

from .client import FigmaClient
from .context import generate_context_files
from .downloader import PrepareOptions, prepare_package
from .migration import init_migration_state, load_migration_state
from .models import Diagnostic, PackageStatus, PackageValidation
from .package import validate_package
from .renderer import PackageRenderError, render_package


EXIT_OK = 0
EXIT_INVALID_PACKAGE = 20
EXIT_INVALID_INPUT = 30
EXIT_TOKEN = 40
EXIT_FIGMA_API = 50
EXIT_FILESYSTEM = 60


class InvalidInputError(ValueError):
    pass


class MissingTokenError(ValueError):
    pass


class _MissingTokenClient:
    """Permit cache lookup while failing before any network operation."""

    def fetch_node(self, target: object) -> dict[str, Any]:
        raise MissingTokenError

    def export_image_urls(
        self,
        file_key: str,
        node_ids: list[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]:
        raise MissingTokenError

    def download(self, url: str, destination: Path) -> None:
        raise MissingTokenError


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise InvalidInputError(message)


def build_parser() -> argparse.ArgumentParser:
    parser = _ArgumentParser(
        prog="figma-context",
        description="Prepare and inspect deterministic Figma context packages.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    prepare = subcommands.add_parser("prepare", help="Download a Figma context package")
    prepare.add_argument("url", help="Figma design URL with node-id")
    prepare.add_argument("--output", required=True, help="Package output root")
    prepare.add_argument("--format", choices=["png", "jpg", "svg"], default="png")
    prepare.add_argument("--scale", type=int, default=2)
    prepare.add_argument("--force", action="store_true")
    _add_json_flag(prepare)

    inspect = subcommands.add_parser("inspect", help="Inspect package status")
    inspect.add_argument("package")
    _add_json_flag(inspect)

    validate = subcommands.add_parser(
        "validate-package", help="Validate a schema v2 package"
    )
    validate.add_argument("package")
    _add_json_flag(validate)

    render = subcommands.add_parser("render", help="Render package to auxiliary HTML")
    render.add_argument("package")
    render.add_argument("--output")
    render.add_argument("--compare", action="store_true")
    _add_json_flag(render)

    status = subcommands.add_parser("status", help="Report package status")
    status.add_argument("package")
    _add_json_flag(status)

    migration = subcommands.add_parser(
        "migration", help="Manage target-repository migration context"
    )
    migration_commands = migration.add_subparsers(
        dest="migration_command", required=True
    )
    migration_init = migration_commands.add_parser(
        "init", help="Initialize .figma-context/migration.json"
    )
    migration_init.add_argument("target_dir")
    _add_json_flag(migration_init)
    migration_validate = migration_commands.add_parser(
        "validate", help="Validate .figma-context/migration.json"
    )
    migration_validate.add_argument("target_dir")
    _add_json_flag(migration_validate)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    json_mode = "--json" in arguments
    command = _command_hint(arguments)
    try:
        args = build_parser().parse_args(arguments)
        command = _command_name(args)
        envelope, exit_code = _dispatch(args, command)
    except InvalidInputError as error:
        envelope = _error_envelope(
            command,
            "invalid",
            "invalid_input",
            str(error),
        )
        exit_code = EXIT_INVALID_INPUT
    except MissingTokenError:
        envelope = _error_envelope(
            command,
            "error",
            "missing_token",
            "FIGMA_TOKEN is required when no matching package is available in cache.",
        )
        exit_code = EXIT_TOKEN
    except PackageRenderError as error:
        envelope = _error_envelope(
            command,
            "invalid",
            error.code,
            "Context package cannot be rendered.",
        )
        exit_code = EXIT_INVALID_PACKAGE
    except FileNotFoundError:
        envelope = _error_envelope(
            command,
            "invalid",
            "missing_input",
            "Required input file or directory does not exist.",
        )
        exit_code = EXIT_INVALID_INPUT
    except requests.HTTPError as error:
        response = error.response
        if response is not None and response.status_code in {401, 403}:
            code = "figma_auth_failed"
            message = "Figma rejected the configured token."
            exit_code = EXIT_TOKEN
        else:
            code = "figma_api_failed"
            message = "Figma API request failed."
            exit_code = EXIT_FIGMA_API
        envelope = _error_envelope(command, "error", code, message, retryable=True)
    except requests.RequestException:
        envelope = _error_envelope(
            command,
            "error",
            "figma_api_failed",
            "Figma API request failed.",
            retryable=True,
        )
        exit_code = EXIT_FIGMA_API
    except OSError:
        envelope = _error_envelope(
            command,
            "error",
            "filesystem_error",
            "A filesystem operation failed.",
        )
        exit_code = EXIT_FILESYSTEM
    except ValueError as error:
        envelope = _error_envelope(
            command,
            "invalid",
            "invalid_input",
            str(error),
        )
        exit_code = EXIT_INVALID_INPUT

    _emit(envelope, json_mode=json_mode)
    return exit_code


def _dispatch(args: argparse.Namespace, command: str) -> tuple[dict[str, Any], int]:
    if args.command == "prepare":
        token = os.environ.get("FIGMA_TOKEN")
        client = FigmaClient(token) if token else _MissingTokenClient()
        result = prepare_package(
            args.url,
            client,
            PrepareOptions(
                output_root=Path(args.output),
                fmt=args.format,
                scale=args.scale,
                force=args.force,
            ),
        )
        context_paths = generate_context_files(result.package_dir)
        data = {
            "packageDir": str(result.package_dir),
            "cacheHit": result.cache_hit,
            "contextFiles": [str(path) for path in context_paths],
        }
        return _validation_envelope(command, result.validation, data)

    if args.command in {"inspect", "validate-package", "status"}:
        package_dir = Path(args.package).resolve()
        validation = validate_package(package_dir)
        return _validation_envelope(
            command,
            validation,
            {"packageDir": str(package_dir)},
        )

    if args.command == "render":
        package_dir = Path(args.package).resolve()
        validation = validate_package(package_dir)
        if validation.status is PackageStatus.INVALID:
            return _validation_envelope(
                command,
                validation,
                {"packageDir": str(package_dir)},
            )
        result = render_package(
            package_dir,
            output=Path(args.output) if args.output else None,
            compare=args.compare,
        )
        data = {
            "packageDir": str(package_dir),
            "htmlPath": str(result.html_path),
            "comparePath": (
                str(result.compare_path) if result.compare_path is not None else None
            ),
            "width": result.width,
            "height": result.height,
        }
        return _validation_envelope(command, validation, data)

    target_dir = Path(args.target_dir).resolve()
    if args.migration_command == "init":
        state = init_migration_state(target_dir)
        data = {
            "targetDir": str(target_dir),
            "stateFile": str(target_dir / ".figma-context" / "migration.json"),
            "schemaVersion": state["schemaVersion"],
        }
        return _success_envelope(command, "initialized", data), EXIT_OK

    state = load_migration_state(target_dir)
    data = {
        "targetDir": str(target_dir),
        "stateFile": str(target_dir / ".figma-context" / "migration.json"),
        "schemaVersion": state["schemaVersion"],
    }
    return _success_envelope(command, "valid", data), EXIT_OK


def _validation_envelope(
    command: str,
    validation: PackageValidation,
    data: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    status = validation.status.value
    ok = validation.status is not PackageStatus.INVALID
    envelope = {
        "ok": ok,
        "command": command,
        "status": status,
        "data": data,
        "diagnostics": [_diagnostic_dict(item) for item in validation.diagnostics],
    }
    return envelope, EXIT_OK if ok else EXIT_INVALID_PACKAGE


def _success_envelope(
    command: str, status: str, data: dict[str, Any]
) -> dict[str, Any]:
    return {
        "ok": True,
        "command": command,
        "status": status,
        "data": data,
        "diagnostics": [],
    }


def _error_envelope(
    command: str,
    status: str,
    code: str,
    message: str,
    *,
    retryable: bool = False,
) -> dict[str, Any]:
    return {
        "ok": False,
        "command": command,
        "status": status,
        "data": {},
        "diagnostics": [
            _diagnostic_dict(Diagnostic(code, _sanitize_message(message), retryable))
        ],
    }


def _emit(envelope: dict[str, Any], *, json_mode: bool) -> None:
    if json_mode:
        print(
            json.dumps(envelope, ensure_ascii=False, separators=(",", ":")),
            file=sys.stdout,
        )
        return

    command = envelope["command"]
    status = envelope["status"]
    print(f"[{command}] {status}", file=sys.stderr)
    for diagnostic in envelope["diagnostics"]:
        node = f" [{diagnostic['node_id']}]" if diagnostic["node_id"] else ""
        print(
            f"  - {diagnostic['code']}{node}: {diagnostic['message']}",
            file=sys.stderr,
        )
    for key, value in envelope["data"].items():
        print(f"  {key}: {value}", file=sys.stderr)


def _add_json_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="Emit one JSON object")


def _command_name(args: argparse.Namespace) -> str:
    if args.command == "migration":
        return f"migration.{args.migration_command}"
    return str(args.command)


def _command_hint(arguments: Sequence[str]) -> str:
    if not arguments:
        return "unknown"
    if arguments[0] == "migration" and len(arguments) > 1:
        return f"migration.{arguments[1]}"
    return arguments[0]


def _diagnostic_dict(diagnostic: Diagnostic) -> dict[str, Any]:
    value = asdict(diagnostic)
    value["message"] = _sanitize_message(value["message"])
    return value


def _sanitize_message(message: str) -> str:
    message = re.sub(r"https?://[^\s]+", "[REDACTED_URL]", message)
    return re.sub(
        r"(?i)((?:access_)?token|authorization|secret)=([^&\s]+)",
        r"\1=[REDACTED]",
        message,
    )


if __name__ == "__main__":
    raise SystemExit(main())
