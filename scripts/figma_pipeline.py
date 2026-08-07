#!/usr/bin/env python3
"""Legacy-compatible Figma URL -> context package -> auxiliary HTML pipeline."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import requests


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from figma_context_bridge.client import FigmaClient  # noqa: E402
from figma_context_bridge.context import generate_context_files  # noqa: E402
from figma_context_bridge.downloader import (  # noqa: E402
    PrepareOptions,
    prepare_package,
)
from figma_context_bridge.models import PackageStatus  # noqa: E402
from figma_context_bridge.renderer import (  # noqa: E402
    PackageRenderError,
    render_package,
)


class _MissingTokenError(ValueError):
    pass


class _MissingTokenClient:
    """Permit Core cache lookup without constructing an authenticated client."""

    def fetch_node(self, target: object) -> dict:
        raise _MissingTokenError

    def export_image_urls(
        self,
        file_key: str,
        node_ids: list[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple]:
        raise _MissingTokenError

    def download(self, url: str, destination: Path) -> None:
        raise _MissingTokenError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="One-shot Figma URL -> package -> auxiliary HTML."
    )
    parser.add_argument("url", help="Figma design URL (must contain ?node-id=...)")
    parser.add_argument(
        "-o",
        "--out",
        default=str(PROJECT_ROOT / "downloads"),
        help="Output root dir",
    )
    parser.add_argument(
        "-t",
        "--token",
        default=os.environ.get("FIGMA_TOKEN"),
        help="Figma token (or $FIGMA_TOKEN)",
    )
    parser.add_argument(
        "-f", "--force", action="store_true", help="Re-download even if cached"
    )
    parser.add_argument(
        "--no-open", action="store_true", help="Do not auto-open the browser"
    )
    parser.add_argument(
        "--no-compare",
        action="store_true",
        help="Skip generating compare.html",
    )
    parser.add_argument("--scale", type=int, default=2, help="Export scale")
    parser.add_argument(
        "--format", default="png", choices=["png", "jpg", "svg"]
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        client = FigmaClient(args.token) if args.token else _MissingTokenClient()
        result = prepare_package(
            args.url,
            client,
            PrepareOptions(
                output_root=Path(args.out),
                fmt=args.format,
                scale=args.scale,
                force=args.force,
            ),
        )
        generate_context_files(result.package_dir)
    except requests.RequestException as error:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
        suffix = f" (HTTP {status_code})" if status_code is not None else ""
        print(f"Error: Figma API request failed{suffix}.", file=sys.stderr)
        return 1
    except _MissingTokenError:
        print(
            "Error: Figma token required. Set FIGMA_TOKEN or pass -t.",
            file=sys.stderr,
        )
        return 1
    except (OSError, ValueError) as error:
        print(
            f"Error: {_redact_message(str(error), args.token or '')}",
            file=sys.stderr,
        )
        return 1

    source = "cache" if result.cache_hit else "download"
    print(
        f"[pipeline] Package {result.validation.status.value} ({source}): "
        f"{result.package_dir}"
    )
    if result.validation.status is PackageStatus.PARTIAL:
        print(
            "[pipeline] Some non-critical assets are unavailable:",
            file=sys.stderr,
        )
        for diagnostic in result.validation.diagnostics:
            node = f" [{diagnostic.node_id}]" if diagnostic.node_id else ""
            print(
                f"  - {diagnostic.code}{node}: {diagnostic.message}",
                file=sys.stderr,
            )

    try:
        rendered = render_package(
            result.package_dir,
            compare=not args.no_compare,
        )
    except (PackageRenderError, OSError) as error:
        print(f"Error: render failed: {error}", file=sys.stderr)
        return 1

    if not args.no_open:
        print(f"[pipeline] Opening browser: {rendered.html_path.name}")
        _open_browser(rendered.html_path)

    print(f"[DONE] {rendered.html_path}")
    return 0


def _open_browser(html_path: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", str(html_path)], check=False)
    elif sys.platform.startswith("linux"):
        subprocess.run(["xdg-open", str(html_path)], check=False)
    elif sys.platform == "win32":
        os.startfile(html_path)  # type: ignore[attr-defined]


def _redact_message(message: str, token: str) -> str:
    if token:
        message = message.replace(token, "[REDACTED]")
    message = re.sub(r"https?://[^\s]+", "[REDACTED_URL]", message)
    return re.sub(
        r"(?i)((?:access_)?token|authorization|secret)=([^&\s]+)",
        r"\1=[REDACTED]",
        message,
    )


if __name__ == "__main__":
    raise SystemExit(main())
