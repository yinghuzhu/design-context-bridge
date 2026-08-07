from __future__ import annotations

import json
import shutil
from pathlib import Path

from figma_context_bridge.context import generate_context_files


FIXTURE = Path(__file__).parent / "fixtures" / "payment-node-small.json"


def make_package(tmp_path: Path) -> Path:
    package_dir = tmp_path / "payment-package"
    package_dir.mkdir()
    shutil.copyfile(FIXTURE, package_dir / "node.json")
    (package_dir / "screenshot.png").write_bytes(b"fixture image")
    (package_dir / "assets").mkdir()
    (package_dir / "assets" / "receipt.png").write_bytes(b"fixture asset")
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "status": "complete",
                "source": {
                    "fileKey": "payment-file",
                    "nodeId": "10:20",
                    "url": "https://www.figma.com/design/payment-file/Page?node-id=10-20",
                },
                "screenshot": "screenshot.png",
                "files": {
                    "10:40": {
                        "name": "Receipt preview",
                        "type": "RECTANGLE",
                        "file": "assets/receipt.png",
                        "url": "https://signed.invalid/secret?token=never-render",
                    }
                },
                "diagnostics": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return package_dir


def test_ai_context_contains_page_navigation_without_sensitive_payloads(
    tmp_path: Path,
) -> None:
    package_dir = make_package(tmp_path)

    context_path, _, _ = generate_context_files(package_dir)

    markdown = context_path.read_text(encoding="utf-8")
    assert "Payment Result" in markdown
    assert "1440 × 900" in markdown
    assert "Header" in markdown
    assert "Payment successful" in markdown
    assert "Your order is confirmed" in markdown
    assert "Do not show this text" not in markdown
    assert "Payment card / Success" in markdown
    assert "assets/receipt.png" in markdown
    assert "screenshot.png" in markdown
    assert "visual source of truth" in markdown
    assert "https://signed.invalid" not in markdown
    assert "receipt-image-ref" not in markdown


def test_duplicate_styles_collapse_with_unique_usage_counts(tmp_path: Path) -> None:
    package_dir = make_package(tmp_path)

    _, styles_path, _ = generate_context_files(package_dir)

    styles = json.loads(styles_path.read_text(encoding="utf-8"))
    text_color = next(
        item
        for item in styles["colors"]
        if item["rgba"] == {"r": 0.1, "g": 0.2, "b": 0.3, "a": 1.0}
    )
    assert text_color["usageCount"] == 2
    assert text_color["nodeIds"] == ["10:22", "10:23"]
    assert len(styles["typography"]) == 1
    assert styles["typography"][0]["usageCount"] == 2
    assert styles["typography"][0]["nodeIds"] == ["10:22", "10:23"]
    assert styles["spacing"]
    assert styles["radii"]
    assert styles["effects"]


def test_components_include_definitions_instances_and_variant_properties(
    tmp_path: Path,
) -> None:
    package_dir = make_package(tmp_path)

    _, _, components_path = generate_context_files(package_dir)

    components = json.loads(components_path.read_text(encoding="utf-8"))
    assert components["components"][0]["id"] == "10:30"
    assert components["instances"][0]["componentId"] == "10:30"
    assert components["instances"][0]["componentProperties"]["State"] == {
        "type": "VARIANT",
        "value": "Success",
    }
    assert components["referencedComponentIds"] == ["10:30"]


def test_generation_is_byte_deterministic(tmp_path: Path) -> None:
    package_dir = make_package(tmp_path)

    first_paths = generate_context_files(package_dir)
    first = tuple(path.read_bytes() for path in first_paths)
    second_paths = generate_context_files(package_dir)
    second = tuple(path.read_bytes() for path in second_paths)

    assert first_paths == second_paths
    assert first == second
