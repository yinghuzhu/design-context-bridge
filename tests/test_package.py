import json
import os
from pathlib import Path

import pytest

from figma_context_bridge.models import FigmaTarget, PackageStatus
from figma_context_bridge.package import (
    PackagePaths,
    build_fingerprint,
    publish_staging,
    validate_package,
)


FIXTURES = Path(__file__).parent / "fixtures"


def write_package(
    package_dir: Path,
    *,
    status: str = "complete",
    screenshot: str = "screenshot.png",
    files: dict[str, object] | None = None,
    diagnostics: list[dict[str, object]] | None = None,
) -> None:
    package_dir.mkdir(parents=True)
    (package_dir / "assets").mkdir()
    (package_dir / "node.json").write_text(
        '{"nodes":{"1:2":{"document":{"id":"1:2","type":"FRAME",'
        '"absoluteBoundingBox":{"x":0,"y":0,"width":10,"height":10}}}}}',
        encoding="utf-8",
    )
    (package_dir / screenshot).write_bytes(b"\x89PNG\r\n\x1a\n")
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "status": status,
                "screenshot": screenshot,
                "files": files or {},
                "diagnostics": diagnostics or [],
            }
        ),
        encoding="utf-8",
    )


def test_package_paths_are_derived_from_target(tmp_path: Path) -> None:
    paths = PackagePaths.for_target(tmp_path, FigmaTarget("file", "1:2"))
    assert paths.root == tmp_path / "file_1-2"
    assert paths.node == paths.root / "node.json"
    assert paths.screenshot == paths.root / "screenshot.png"
    assert paths.manifest == paths.root / "manifest.json"
    assert paths.assets == paths.root / "assets"


def test_fingerprint_is_stable_and_includes_export_options() -> None:
    target = FigmaTarget("file", "1:2")
    first = build_fingerprint(target, "png", 2)
    assert first == build_fingerprint(target, "png", 2)
    assert first != build_fingerprint(target, "svg", 2)
    assert first != build_fingerprint(target, "png", 3)


def test_valid_minimal_package_is_complete(tmp_path: Path) -> None:
    write_package(tmp_path / "package")
    assert validate_package(tmp_path / "package").status is PackageStatus.COMPLETE


def test_checked_in_minimal_package_fixture_is_complete() -> None:
    result = validate_package(FIXTURES / "minimal-package")
    assert result.status is PackageStatus.COMPLETE
    assert result.diagnostics == ()


def test_screenshot_path_comes_from_manifest(tmp_path: Path) -> None:
    write_package(tmp_path / "package", screenshot="screenshot.svg")
    assert validate_package(tmp_path / "package").status is PackageStatus.COMPLETE


def test_missing_screenshot_is_invalid(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    write_package(package_dir)
    (package_dir / "screenshot.png").unlink()

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {"missing_screenshot"}


def test_manifest_asset_failure_is_partial(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    write_package(
        package_dir,
        status="partial",
        diagnostics=[
            {
                "code": "asset_missing",
                "message": "2:3",
                "retryable": True,
                "node_id": "2:3",
            }
        ],
    )

    result = validate_package(package_dir)

    assert result.status is PackageStatus.PARTIAL
    assert result.diagnostics[0].code == "asset_missing"
    assert result.diagnostics[0].retryable is True
    assert result.diagnostics[0].node_id == "2:3"


def test_complete_manifest_with_missing_asset_becomes_partial(
    tmp_path: Path,
) -> None:
    package_dir = tmp_path / "package"
    write_package(
        package_dir,
        files={"2:3": {"file": "assets/missing.png"}},
    )

    result = validate_package(package_dir)

    assert result.status is PackageStatus.PARTIAL
    missing = [item for item in result.diagnostics if item.code == "asset_missing"]
    assert len(missing) == 1
    assert missing[0].retryable is True
    assert missing[0].node_id == "2:3"


def test_existing_manifest_asset_keeps_complete_status(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    write_package(
        package_dir,
        files={"2:3": {"file": "assets/present.png"}},
    )
    (package_dir / "assets" / "present.png").write_bytes(b"asset")

    result = validate_package(package_dir)

    assert result.status is PackageStatus.COMPLETE
    assert result.diagnostics == ()


def test_manifest_asset_path_escape_is_invalid(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    write_package(
        package_dir,
        files={"2:3": {"file": "../outside.png"}},
    )
    (tmp_path / "outside.png").write_bytes(b"outside")

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {"malformed_manifest"}


@pytest.mark.parametrize(
    "entry",
    ["assets/not-an-object.png", {}, {"file": ""}],
)
def test_malformed_manifest_asset_entry_is_invalid(
    tmp_path: Path, entry: object
) -> None:
    package_dir = tmp_path / "package"
    write_package(package_dir, files={"2:3": entry})

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {"malformed_manifest"}


def test_validation_reports_every_missing_required_file(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "manifest.json").write_text(
        '{"schemaVersion":2,"status":"complete","screenshot":"shot.png",'
        '"files":{},"diagnostics":[]}',
        encoding="utf-8",
    )

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {
        "missing_node",
        "missing_screenshot",
    }


@pytest.mark.parametrize(
    ("filename", "content", "code"),
    [
        ("manifest.json", "not-json", "malformed_manifest"),
        ("node.json", "not-json", "malformed_node"),
    ],
)
def test_malformed_json_is_invalid(
    tmp_path: Path, filename: str, content: str, code: str
) -> None:
    package_dir = tmp_path / "package"
    write_package(package_dir)
    (package_dir / filename).write_text(content, encoding="utf-8")

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert code in {item.code for item in result.diagnostics}


def test_unsupported_schema_is_invalid(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    write_package(package_dir)
    manifest = json.loads((package_dir / "manifest.json").read_text())
    manifest["schemaVersion"] = 1
    (package_dir / "manifest.json").write_text(json.dumps(manifest))

    result = validate_package(package_dir)

    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {"unsupported_schema"}


def test_declared_invalid_package_is_not_publishable(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    destination = tmp_path / "destination"
    write_package(staging, status="invalid")
    destination.mkdir()
    (destination / "sentinel.txt").write_text("original", encoding="utf-8")

    with pytest.raises(ValueError, match="invalid package"):
        publish_staging(staging, destination)

    assert staging.exists()
    assert (destination / "sentinel.txt").read_text(encoding="utf-8") == "original"


@pytest.mark.parametrize("status", ["complete", "partial"])
def test_publish_accepts_usable_statuses(tmp_path: Path, status: str) -> None:
    staging = tmp_path / "staging"
    destination = tmp_path / "destination"
    write_package(staging, status=status)

    validation = publish_staging(staging, destination)

    assert validation.status.value == status
    assert destination.exists()
    assert not staging.exists()


def test_publish_failure_restores_original_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    destination = tmp_path / "destination"
    write_package(staging)
    destination.mkdir()
    (destination / "sentinel.txt").write_text("original", encoding="utf-8")
    real_replace = os.replace
    calls = 0

    def fail_second_replace(source: Path, target: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("publish failed")
        real_replace(source, target)

    monkeypatch.setattr(os, "replace", fail_second_replace)

    with pytest.raises(OSError, match="publish failed"):
        publish_staging(staging, destination)

    assert (destination / "sentinel.txt").read_text(encoding="utf-8") == "original"
    assert staging.exists()
    assert not list(tmp_path.glob(".destination.backup-*"))
