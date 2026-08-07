from __future__ import annotations

import json
from pathlib import Path

import pytest

from figma_context_bridge.renderer import PackageRenderError, render_package


def make_package(
    tmp_path: Path,
    *,
    screenshot: str = "screenshot.png",
    nodes: dict | None = None,
) -> Path:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "assets").mkdir()
    (package_dir / "assets" / "photo.png").write_bytes(b"photo")
    (package_dir / "assets" / "icon.svg").write_text("<svg/>", encoding="utf-8")
    (package_dir / screenshot).write_bytes(b"screenshot")

    root = {
        "id": "10:20",
        "name": 'Payment <Result> & "Receipt"',
        "type": "FRAME",
        "absoluteBoundingBox": {"x": 100, "y": 200, "width": 640, "height": 480},
        "fills": [{"type": "SOLID", "color": {"r": 1, "g": 1, "b": 1}}],
        "children": [
            {
                "id": "10:21",
                "name": "Panel",
                "type": "FRAME",
                "absoluteBoundingBox": {"x": 120, "y": 230, "width": 300, "height": 200},
                "cornerRadius": 8,
                "strokes": [
                    {"type": "SOLID", "color": {"r": 0, "g": 0, "b": 0}}
                ],
                "strokeWeight": 2,
                "effects": [
                    {
                        "type": "DROP_SHADOW",
                        "color": {"r": 0, "g": 0, "b": 0, "a": 0.2},
                        "offset": {"x": 1, "y": 2},
                        "radius": 3,
                    }
                ],
                "children": [
                    {
                        "id": "10:22",
                        "name": "Text",
                        "type": "TEXT",
                        "characters": '<Pay & "continue">\nNow',
                        "absoluteBoundingBox": {
                            "x": 130,
                            "y": 240,
                            "width": 180,
                            "height": 24,
                        },
                        "style": {"fontSize": 16, "lineHeightPx": 20},
                    },
                    {
                        "id": "10:23",
                        "name": "Photo",
                        "type": "RECTANGLE",
                        "absoluteBoundingBox": {
                            "x": 140,
                            "y": 270,
                            "width": 80,
                            "height": 60,
                        },
                        "fills": [{"type": "IMAGE", "imageRef": "photo-ref"}],
                    },
                ],
            },
            {
                "id": "10:24",
                "name": "Icon",
                "type": "VECTOR",
                "absoluteBoundingBox": {"x": 500, "y": 220, "width": 24, "height": 24},
            },
        ],
    }
    node_data = {
        "nodes": {
            "99:99": {
                "document": {
                    "id": "99:99",
                    "name": "Wrong root",
                    "type": "FRAME",
                    "absoluteBoundingBox": {"x": 0, "y": 0, "width": 1, "height": 1},
                }
            },
            "10:20": {"document": root},
        }
    }
    if nodes is not None:
        node_data["nodes"] = nodes

    (package_dir / "node.json").write_text(
        json.dumps(node_data), encoding="utf-8"
    )
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "status": "complete",
                "source": {
                    "url": "https://www.figma.com/design/file/Page?node-id=10-20",
                    "fileKey": "file",
                    "nodeId": "10:20",
                },
                "root": {
                    "name": 'Payment <Result> & "Receipt"',
                    "type": "FRAME",
                    "totalNodes": 5,
                },
                "export": {"format": "png", "scale": 2},
                "fingerprint": (
                    "8f65b8562a93ac5ee88f0d16a380f886"
                    "84eec1c3d03840d28389882b214b1126"
                ),
                "screenshot": screenshot,
                "files": {
                    "10:23": {
                        "name": "Photo",
                        "type": "RECTANGLE",
                        "file": "assets/photo.png",
                    },
                    "10:24": {
                        "name": "Icon",
                        "type": "VECTOR",
                        "file": "assets/icon.svg",
                    },
                },
                "diagnostics": [],
            }
        ),
        encoding="utf-8",
    )
    return package_dir


def test_render_preserves_relative_coordinates_and_escapes_text(tmp_path: Path) -> None:
    package_dir = make_package(tmp_path)

    result = render_package(package_dir)

    rendered = result.html_path.read_text(encoding="utf-8")
    assert result.width == 640
    assert result.height == 480
    assert "left:20.0px;top:30.0px;width:300.0px;height:200.0px" in rendered
    assert "left:10.0px;top:10.0px;width:180.0px" in rendered
    assert "&lt;Pay &amp; &quot;continue&quot;&gt;<br>Now" in rendered
    assert '<title>Payment &lt;Result&gt; &amp; &quot;Receipt&quot;</title>' in rendered
    assert "Wrong root" not in rendered


def test_render_uses_image_and_vector_asset_paths(tmp_path: Path) -> None:
    package_dir = make_package(tmp_path)

    rendered = render_package(package_dir).html_path.read_text(encoding="utf-8")

    assert 'data-id="10:23" data-type="RECTANGLE"' in rendered
    assert '<img src="assets/photo.png"' in rendered
    assert 'data-id="10:24" data-type="VECTOR"' in rendered
    assert '<img src="assets/icon.svg"' in rendered


def test_missing_manifest_raises_typed_package_error(tmp_path: Path) -> None:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "node.json").write_text('{"nodes": {}}', encoding="utf-8")

    with pytest.raises(PackageRenderError, match="missing_manifest"):
        render_package(package_dir)


def test_empty_nodes_raises_typed_package_error(tmp_path: Path) -> None:
    package_dir = make_package(tmp_path, nodes={})

    with pytest.raises(PackageRenderError, match="missing_source_node"):
        render_package(package_dir)


def test_root_without_absolute_bounding_box_raises_typed_error(tmp_path: Path) -> None:
    package_dir = make_package(
        tmp_path,
        nodes={
            "10:20": {
                "document": {"id": "10:20", "name": "Root", "type": "FRAME"}
            }
        },
    )

    with pytest.raises(PackageRenderError, match="absoluteBoundingBox"):
        render_package(package_dir)


@pytest.mark.parametrize("screenshot", ["screenshot.jpg", "screenshot.svg"])
def test_render_uses_manifest_screenshot_filename(
    tmp_path: Path, screenshot: str
) -> None:
    package_dir = make_package(tmp_path, screenshot=screenshot)

    result = render_package(package_dir, compare=True)

    assert result.compare_path is not None
    comparison = result.compare_path.read_text(encoding="utf-8")
    assert f'src="{screenshot}"' in comparison
    assert f"Original {screenshot}" in comparison
