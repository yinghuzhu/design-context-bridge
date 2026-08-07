from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

from figma_context_bridge.downloader import (
    PrepareOptions,
    PrepareResult,
    collect_export_targets,
    prepare_package,
)
from figma_context_bridge.models import (
    Diagnostic,
    PackageStatus,
    PackageValidation,
)
from figma_context_bridge.package import build_fingerprint
from figma_context_bridge.url import parse_figma_url


SOURCE_URL = "https://www.figma.com/design/file123/Title?node-id=1-2"


def node_payload(*, include_second_asset: bool = True) -> dict[str, Any]:
    children: list[dict[str, Any]] = [
        {
            "id": "2:3",
            "name": "Hero image",
            "type": "RECTANGLE",
            "fills": [{"type": "IMAGE", "imageRef": "image-ref"}],
        }
    ]
    if include_second_asset:
        children.append(
            {
                "id": "3:4",
                "name": "Logo / Mark",
                "type": "VECTOR",
            }
        )
    return {
        "nodes": {
            "1:2": {
                "document": {
                    "id": "1:2",
                    "name": "Checkout",
                    "type": "FRAME",
                    "absoluteBoundingBox": {
                        "x": 0,
                        "y": 0,
                        "width": 1440,
                        "height": 900,
                    },
                    "children": children,
                }
            }
        }
    }


class FakeFigmaClient:
    def __init__(
        self,
        *,
        node_data: dict[str, Any] | None = None,
        image_urls: dict[str, str] | None = None,
        payloads: dict[str, bytes] | None = None,
        diagnostics: tuple[Diagnostic, ...] = (),
        failed_downloads: set[str] | None = None,
    ) -> None:
        self.node_data = node_data or node_payload()
        self.image_urls = image_urls or {
            "1:2": "https://signed.invalid/root",
            "2:3": "https://signed.invalid/hero",
            "3:4": "https://signed.invalid/logo",
        }
        self.payloads = payloads or {
            "https://signed.invalid/root": b"root-image",
            "https://signed.invalid/hero": b"hero-image",
            "https://signed.invalid/logo": b"logo-image",
        }
        self.diagnostics = diagnostics
        self.failed_downloads = failed_downloads or set()
        self.fetch_calls = 0
        self.export_calls: list[tuple[str, tuple[str, ...], str, int]] = []
        self.download_calls: list[tuple[str, Path]] = []

    def fetch_node(self, target: object) -> dict[str, Any]:
        self.fetch_calls += 1
        return self.node_data

    def export_image_urls(
        self,
        file_key: str,
        node_ids: list[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]:
        self.export_calls.append((file_key, tuple(node_ids), fmt, scale))
        return self.image_urls, self.diagnostics

    def download(self, url: str, destination: Path) -> None:
        self.download_calls.append((url, destination))
        if url in self.failed_downloads:
            raise OSError("simulated download failure")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.payloads[url])


def read_manifest(package_dir: Path) -> dict[str, Any]:
    return json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))


def test_collect_export_targets_is_depth_first_deduplicated_and_bounded() -> None:
    duplicate = {
        "id": "4-5",
        "name": "Duplicate",
        "type": "BOOLEAN_OPERATION",
    }
    root = {
        "id": "1:2",
        "type": "FRAME",
        "children": [
            {
                "id": "2:3",
                "name": "Photo",
                "type": "RECTANGLE",
                "fills": [{"type": "IMAGE"}],
                "children": [duplicate],
            },
            duplicate,
            {
                "id": "I2:3;9:10",
                "name": "Nested instance child",
                "type": "INSTANCE",
            },
            {"id": "6:7", "name": "Component", "type": "COMPONENT"},
            {"id": "8:9", "name": "Instance", "type": "INSTANCE"},
        ],
    }

    assert collect_export_targets(root) == [
        {"id": "2:3", "name": "Photo", "type": "RECTANGLE"},
        {"id": "4:5", "name": "Duplicate", "type": "BOOLEAN_OPERATION"},
        {"id": "6:7", "name": "Component", "type": "COMPONENT"},
        {"id": "8:9", "name": "Instance", "type": "INSTANCE"},
    ]


def test_prepare_writes_schema_v2_manifest_and_readme(tmp_path: Path) -> None:
    client = FakeFigmaClient()

    result = prepare_package(SOURCE_URL, client, PrepareOptions(tmp_path))

    assert result.validation.status is PackageStatus.COMPLETE
    assert result.cache_hit is False
    manifest = read_manifest(result.package_dir)
    assert manifest["schemaVersion"] == 2
    assert manifest["status"] == "complete"
    assert manifest["source"] == {
        "url": SOURCE_URL,
        "fileKey": "file123",
        "nodeId": "1:2",
    }
    assert manifest["root"] == {
        "name": "Checkout",
        "type": "FRAME",
        "totalNodes": 3,
    }
    assert manifest["export"] == {"format": "png", "scale": 2}
    assert manifest["fingerprint"] == build_fingerprint(
        parse_figma_url(SOURCE_URL), "png", 2
    )
    assert manifest["screenshot"] == "screenshot.png"
    assert set(manifest["files"]) == {"2:3", "3:4"}
    assert manifest["diagnostics"] == []
    assert (result.package_dir / "README.md").is_file()
    serialized = (result.package_dir / "manifest.json").read_text(encoding="utf-8")
    assert "https://signed.invalid" not in serialized


def test_failed_non_root_asset_publishes_partial_package(tmp_path: Path) -> None:
    client = FakeFigmaClient(
        image_urls={
            "1:2": "https://signed.invalid/root",
            "2:3": "https://signed.invalid/hero",
        },
        diagnostics=(
            Diagnostic(
                code="asset_export_failed",
                message="Figma did not export an image for node 3:4",
                retryable=True,
                node_id="3:4",
            ),
        ),
    )

    result = prepare_package(SOURCE_URL, client, PrepareOptions(tmp_path))

    assert result.validation.status is PackageStatus.PARTIAL
    manifest = read_manifest(result.package_dir)
    assert manifest["status"] == "partial"
    assert set(manifest["files"]) == {"2:3"}
    assert [item["node_id"] for item in manifest["diagnostics"]] == ["3:4"]


def test_missing_root_screenshot_preserves_existing_cache(tmp_path: Path) -> None:
    destination = tmp_path / "file123_1-2"
    destination.mkdir()
    (destination / "sentinel.txt").write_text("original", encoding="utf-8")
    client = FakeFigmaClient(
        image_urls={
            "2:3": "https://signed.invalid/hero",
            "3:4": "https://signed.invalid/logo",
        }
    )

    with pytest.raises(ValueError, match="root screenshot"):
        prepare_package(SOURCE_URL, client, PrepareOptions(tmp_path))

    assert (destination / "sentinel.txt").read_text(encoding="utf-8") == "original"
    assert list(tmp_path.glob(".file123_1-2.staging-*")) == []


def test_equal_fingerprint_returns_cache_hit_without_client_calls(
    tmp_path: Path,
) -> None:
    first_client = FakeFigmaClient()
    first = prepare_package(SOURCE_URL, first_client, PrepareOptions(tmp_path))
    client = FakeFigmaClient()

    result = prepare_package(SOURCE_URL, client, PrepareOptions(tmp_path))

    assert result.package_dir == first.package_dir
    assert result.cache_hit is True
    assert result.validation.status is PackageStatus.COMPLETE
    assert client.fetch_calls == 0
    assert client.export_calls == []
    assert client.download_calls == []


def test_svg_does_not_reuse_png_fingerprint(tmp_path: Path) -> None:
    prepare_package(SOURCE_URL, FakeFigmaClient(), PrepareOptions(tmp_path))
    client = FakeFigmaClient()

    result = prepare_package(
        SOURCE_URL,
        client,
        PrepareOptions(tmp_path, fmt="svg", scale=2),
    )

    assert result.cache_hit is False
    assert client.fetch_calls == 1
    manifest = read_manifest(result.package_dir)
    assert manifest["screenshot"] == "screenshot.svg"
    assert all(
        entry["file"].endswith(".svg") for entry in manifest["files"].values()
    )
    assert not (result.package_dir / "screenshot.png").exists()


def test_jpg_screenshot_uses_requested_suffix(tmp_path: Path) -> None:
    result = prepare_package(
        SOURCE_URL,
        FakeFigmaClient(),
        PrepareOptions(tmp_path, fmt="jpg"),
    )

    manifest = read_manifest(result.package_dir)
    assert manifest["screenshot"] == "screenshot.jpg"
    assert (result.package_dir / "screenshot.jpg").is_file()


def test_force_replacement_removes_stale_asset_absent_from_new_manifest(
    tmp_path: Path,
) -> None:
    first = prepare_package(SOURCE_URL, FakeFigmaClient(), PrepareOptions(tmp_path))
    stale = first.package_dir / "assets" / "stale.png"
    stale.write_bytes(b"stale")
    second_client = FakeFigmaClient(
        node_data=node_payload(include_second_asset=False),
        image_urls={
            "1:2": "https://signed.invalid/root",
            "2:3": "https://signed.invalid/hero",
        },
    )

    result = prepare_package(
        SOURCE_URL,
        second_client,
        PrepareOptions(tmp_path, force=True),
    )

    assert result.cache_hit is False
    assert not stale.exists()
    assert set(read_manifest(result.package_dir)["files"]) == {"2:3"}


def test_download_failures_do_not_leak_signed_urls_or_secrets(
    tmp_path: Path,
) -> None:
    secret = "figd_super_secret"
    failed_url = "https://signed.invalid/logo?signature=private"
    client = FakeFigmaClient(
        image_urls={
            "1:2": "https://signed.invalid/root",
            "2:3": "https://signed.invalid/hero",
            "3:4": failed_url,
        },
        failed_downloads={failed_url},
    )

    result = prepare_package(
        SOURCE_URL,
        client,
        PrepareOptions(tmp_path),
    )

    content = (result.package_dir / "manifest.json").read_text(encoding="utf-8")
    assert result.validation.status is PackageStatus.PARTIAL
    assert failed_url not in content
    assert secret not in content
    assert "simulated download failure" not in content


def test_sensitive_source_query_values_are_not_persisted(tmp_path: Path) -> None:
    source_url = (
        "https://www.figma.com/design/file123/Title?"
        "node-id=1-2&token=figd_super_secret"
    )

    result = prepare_package(source_url, FakeFigmaClient(), PrepareOptions(tmp_path))

    manifest_text = (result.package_dir / "manifest.json").read_text(
        encoding="utf-8"
    )
    readme_text = (result.package_dir / "README.md").read_text(encoding="utf-8")
    assert "figd_super_secret" not in manifest_text
    assert "figd_super_secret" not in readme_text
    assert read_manifest(result.package_dir)["source"]["url"] == SOURCE_URL


def test_export_diagnostic_does_not_persist_a_signed_url(tmp_path: Path) -> None:
    signed_url = "https://signed.invalid/logo?signature=private"
    client = FakeFigmaClient(
        image_urls={
            "1:2": "https://signed.invalid/root",
            "2:3": "https://signed.invalid/hero",
        },
        diagnostics=(
            Diagnostic(
                code="asset_export_failed",
                message=f"export failed at {signed_url}",
                retryable=True,
                node_id="3:4",
            ),
        ),
    )

    result = prepare_package(SOURCE_URL, client, PrepareOptions(tmp_path))

    content = (result.package_dir / "manifest.json").read_text(encoding="utf-8")
    assert result.validation.status is PackageStatus.PARTIAL
    assert signed_url not in content
    assert "[REDACTED_URL]" in content


def test_legacy_script_translates_existing_arguments_and_partial_is_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    script_path = Path(__file__).parents[1] / "scripts" / "figma_download.py"
    spec = importlib.util.spec_from_file_location("legacy_figma_download", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    captured: dict[str, object] = {}

    class StubClient:
        def __init__(self, token: str) -> None:
            captured["token"] = token

    def stub_prepare(
        source_url: str,
        client: object,
        options: PrepareOptions,
    ) -> PrepareResult:
        captured.update(
            source_url=source_url,
            client=client,
            options=options,
        )
        return PrepareResult(
            package_dir=tmp_path / "file123_1-2",
            validation=PackageValidation(
                status=PackageStatus.PARTIAL,
                diagnostics=(
                    Diagnostic(
                        code="asset_export_failed",
                        message="asset unavailable",
                        retryable=True,
                        node_id="3:4",
                    ),
                ),
            ),
            cache_hit=False,
        )

    monkeypatch.setattr(module, "FigmaClient", StubClient)
    monkeypatch.setattr(module, "prepare_package", stub_prepare)

    exit_code = module.main(
        [
            SOURCE_URL,
            "-o",
            str(tmp_path),
            "-t",
            "figd_secret",
            "--scale",
            "3",
            "--format",
            "svg",
            "--no-screenshot",
        ]
    )

    assert exit_code == 0
    assert captured["token"] == "figd_secret"
    assert captured["source_url"] == SOURCE_URL
    assert captured["options"] == PrepareOptions(
        output_root=tmp_path,
        fmt="svg",
        scale=3,
        force=True,
    )
    output = capsys.readouterr()
    assert "asset_export_failed [3:4]" in output.err
    assert "figd_secret" not in output.out + output.err
