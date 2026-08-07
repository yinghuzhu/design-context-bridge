from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Diagnostic, FigmaTarget, PackageStatus, PackageValidation


SCHEMA_VERSION = 2


@dataclass(frozen=True)
class PackagePaths:
    root: Path
    node: Path
    screenshot: Path
    manifest: Path
    assets: Path

    @classmethod
    def for_target(
        cls, output_root: Path, target: FigmaTarget
    ) -> "PackagePaths":
        root = output_root / target.cache_key
        return cls(
            root,
            root / "node.json",
            root / "screenshot.png",
            root / "manifest.json",
            root / "assets",
        )


def build_fingerprint(target: FigmaTarget, fmt: str, scale: int) -> str:
    value = {
        "fileKey": target.file_key,
        "nodeId": target.node_id,
        "format": fmt,
        "scale": scale,
    }
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def validate_package(package_dir: Path) -> PackageValidation:
    package_dir = Path(package_dir)
    diagnostics: list[Diagnostic] = []
    manifest = _load_manifest(package_dir / "manifest.json", diagnostics)
    _load_node(package_dir / "node.json", diagnostics)

    declared_status: PackageStatus | None = None
    manifest_diagnostics: tuple[Diagnostic, ...] = ()
    asset_diagnostics: tuple[Diagnostic, ...] = ()
    if manifest is not None:
        if manifest.get("schemaVersion") != SCHEMA_VERSION:
            diagnostics.append(
                Diagnostic(
                    code="unsupported_schema",
                    message=(
                        "manifest.json requires schemaVersion "
                        f"{SCHEMA_VERSION}"
                    ),
                )
            )

        declared_status = _parse_status(manifest, diagnostics)
        asset_diagnostics = _validate_files(
            package_dir, manifest, diagnostics
        )
        manifest_diagnostics = _parse_manifest_diagnostics(manifest, diagnostics)
        _validate_screenshot(package_dir, manifest, diagnostics)

    if diagnostics or declared_status is None:
        return PackageValidation(
            status=PackageStatus.INVALID,
            diagnostics=(
                tuple(diagnostics)
                + manifest_diagnostics
                + asset_diagnostics
            ),
        )

    if declared_status is PackageStatus.INVALID:
        return PackageValidation(
            status=PackageStatus.INVALID,
            diagnostics=manifest_diagnostics
            + asset_diagnostics
            + (
                Diagnostic(
                    code="declared_invalid",
                    message="manifest declares the package invalid",
                ),
            ),
        )

    status = declared_status
    if asset_diagnostics:
        status = PackageStatus.PARTIAL
    return PackageValidation(
        status=status,
        diagnostics=manifest_diagnostics + asset_diagnostics,
    )


def publish_staging(
    staging_dir: Path, destination: Path
) -> PackageValidation:
    staging_dir = Path(staging_dir)
    destination = Path(destination)
    validation = validate_package(staging_dir)
    if validation.status is PackageStatus.INVALID:
        raise ValueError("cannot publish invalid package")

    if staging_dir.resolve() == destination.resolve():
        raise ValueError("staging and destination must be different paths")

    destination.parent.mkdir(parents=True, exist_ok=True)
    backup = destination.with_name(
        f".{destination.name}.backup-{uuid.uuid4().hex}"
    )
    backup_created = False

    try:
        if destination.exists() or destination.is_symlink():
            os.replace(destination, backup)
            backup_created = True
        os.replace(staging_dir, destination)
    except BaseException:
        if backup_created:
            os.replace(backup, destination)
        raise

    if backup_created:
        _remove_path(backup)
    return validation


def _load_manifest(
    manifest_path: Path, diagnostics: list[Diagnostic]
) -> dict[str, Any] | None:
    if not manifest_path.is_file():
        diagnostics.append(
            Diagnostic(
                code="missing_manifest",
                message="required file manifest.json is missing",
            )
        )
        return None

    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest.json is not valid UTF-8 JSON",
            )
        )
        return None

    if not isinstance(value, dict):
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest.json must contain a JSON object",
            )
        )
        return None
    return value


def _load_node(node_path: Path, diagnostics: list[Diagnostic]) -> None:
    if not node_path.is_file():
        diagnostics.append(
            Diagnostic(
                code="missing_node",
                message="required file node.json is missing",
            )
        )
        return

    try:
        value = json.loads(node_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        diagnostics.append(
            Diagnostic(
                code="malformed_node",
                message="node.json is not valid UTF-8 JSON",
            )
        )
        return

    if not isinstance(value, dict):
        diagnostics.append(
            Diagnostic(
                code="malformed_node",
                message="node.json must contain a JSON object",
            )
        )


def _parse_status(
    manifest: dict[str, Any], diagnostics: list[Diagnostic]
) -> PackageStatus | None:
    value = manifest.get("status")
    try:
        return PackageStatus(value)
    except (TypeError, ValueError):
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message=(
                    "manifest status must be complete, partial, or invalid"
                ),
            )
        )
        return None


def _validate_files(
    package_dir: Path,
    manifest: dict[str, Any],
    diagnostics: list[Diagnostic],
) -> tuple[Diagnostic, ...]:
    files = manifest.get("files")
    if not isinstance(files, dict):
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest files must be a JSON object",
            )
        )
        return ()

    missing: list[Diagnostic] = []
    for node_id, entry in files.items():
        if not isinstance(entry, dict):
            diagnostics.append(
                Diagnostic(
                    code="malformed_manifest",
                    message=f"manifest file entry must be an object: {node_id}",
                    node_id=node_id,
                )
            )
            continue

        value = entry.get("file")
        if not isinstance(value, str) or not value:
            diagnostics.append(
                Diagnostic(
                    code="malformed_manifest",
                    message=(
                        "manifest file entry requires a non-empty relative "
                        f"file path: {node_id}"
                    ),
                    node_id=node_id,
                )
            )
            continue

        asset = _resolve_package_path(package_dir, value)
        if asset is None:
            diagnostics.append(
                Diagnostic(
                    code="malformed_manifest",
                    message=f"manifest file path escapes package: {node_id}",
                    node_id=node_id,
                )
            )
            continue

        if not asset.is_file():
            missing.append(
                Diagnostic(
                    code="asset_missing",
                    message=f"referenced asset is missing: {value}",
                    retryable=True,
                    node_id=node_id,
                )
            )
    return tuple(missing)


def _parse_manifest_diagnostics(
    manifest: dict[str, Any], diagnostics: list[Diagnostic]
) -> tuple[Diagnostic, ...]:
    values = manifest.get("diagnostics")
    if not isinstance(values, list):
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest diagnostics must be a JSON array",
            )
        )
        return ()

    parsed: list[Diagnostic] = []
    for value in values:
        if not isinstance(value, dict):
            diagnostics.append(
                Diagnostic(
                    code="malformed_manifest",
                    message="each manifest diagnostic must be a JSON object",
                )
            )
            continue
        code = value.get("code")
        message = value.get("message")
        retryable = value.get("retryable", False)
        node_id = value.get("node_id", value.get("nodeId"))
        if (
            not isinstance(code, str)
            or not isinstance(message, str)
            or not isinstance(retryable, bool)
            or (node_id is not None and not isinstance(node_id, str))
        ):
            diagnostics.append(
                Diagnostic(
                    code="malformed_manifest",
                    message="manifest diagnostic fields have invalid types",
                )
            )
            continue
        parsed.append(
            Diagnostic(
                code=code,
                message=message,
                retryable=retryable,
                node_id=node_id,
            )
        )
    return tuple(parsed)


def _validate_screenshot(
    package_dir: Path,
    manifest: dict[str, Any],
    diagnostics: list[Diagnostic],
) -> None:
    value = manifest.get("screenshot")
    if not isinstance(value, str) or not value:
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest screenshot must be a non-empty relative path",
            )
        )
        return

    screenshot = _resolve_package_path(package_dir, value)
    if screenshot is None:
        diagnostics.append(
            Diagnostic(
                code="malformed_manifest",
                message="manifest screenshot must stay inside the package",
            )
        )
        return

    if not screenshot.is_file():
        diagnostics.append(
            Diagnostic(
                code="missing_screenshot",
                message=f"required screenshot is missing: {value}",
            )
        )


def _resolve_package_path(package_dir: Path, value: str) -> Path | None:
    candidate = package_dir / value
    try:
        candidate.resolve().relative_to(package_dir.resolve())
    except ValueError:
        return None
    return candidate


def _remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)
