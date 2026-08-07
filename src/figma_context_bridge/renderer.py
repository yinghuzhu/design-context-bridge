from __future__ import annotations

import html
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import PackageStatus
from .package import validate_package


class PackageRenderError(ValueError):
    """Raised when a context package cannot be rendered safely."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"{code}: {message}")


@dataclass(frozen=True)
class RenderResult:
    html_path: Path
    compare_path: Path | None
    width: float
    height: float


def figma_color(color: dict[str, Any]) -> str:
    red = round(color.get("r", 0) * 255)
    green = round(color.get("g", 0) * 255)
    blue = round(color.get("b", 0) * 255)
    alpha = color.get("a", 1)
    if alpha >= 1:
        return f"rgb({red},{green},{blue})"
    return f"rgba({red},{green},{blue},{alpha:.3f})"


def fills_to_background(fills: list[Any] | None) -> str | None:
    """Convert visible Figma fills to a CSS background value."""
    if not fills:
        return None
    visible = [fill for fill in fills if isinstance(fill, dict) and fill.get("visible", True)]
    if not visible:
        return None
    layers: list[str] = []
    for fill in visible:
        fill_type = fill.get("type")
        blend = fill.get("blendMode", "NORMAL")
        if fill_type == "SOLID":
            color = fill.get("color", {})
            if not isinstance(color, dict):
                color = {}
            opacity = fill.get("opacity", 1)
            alpha = color.get("a", 1) * opacity
            is_white = (
                color.get("r", 0) >= 0.95
                and color.get("g", 0) >= 0.95
                and color.get("b", 0) >= 0.95
            )
            if blend == "MULTIPLY" and is_white:
                continue
            layers.append(figma_color({**color, "a": alpha}))
        elif fill_type in ("GRADIENT_LINEAR", "GRADIENT_RADIAL"):
            stops = fill.get("gradientStops", [])
            css_stops = ", ".join(
                f"{figma_color(stop.get('color', {}))} "
                f"{stop.get('position', 0) * 100:.1f}%"
                for stop in stops
                if isinstance(stop, dict)
            )
            if fill_type == "GRADIENT_LINEAR":
                layers.append(f"linear-gradient(90deg, {css_stops})")
            else:
                layers.append(f"radial-gradient(circle, {css_stops})")
    return ", ".join(reversed(layers)) if layers else None


def effects_to_filters(
    effects: list[Any] | None,
) -> tuple[str | None, str | None, str | None]:
    """Return box-shadow, backdrop-filter, and filter CSS values."""
    if not effects:
        return None, None, None
    box_shadows: list[str] = []
    backdrop_radius = 0
    layer_blur = 0
    for effect in effects:
        if not isinstance(effect, dict) or not effect.get("visible", True):
            continue
        effect_type = effect.get("type")
        color = effect.get("color", {})
        css_color = figma_color(color if isinstance(color, dict) else {})
        offset = effect.get("offset", {"x": 0, "y": 0})
        if not isinstance(offset, dict):
            offset = {"x": 0, "y": 0}
        offset_x = offset.get("x", 0)
        offset_y = offset.get("y", 0)
        radius = effect.get("radius", 0)
        spread = effect.get("spread", 0)
        if effect_type == "DROP_SHADOW":
            box_shadows.append(
                f"{offset_x}px {offset_y}px {radius}px {spread}px {css_color}"
            )
        elif effect_type == "INNER_SHADOW":
            box_shadows.append(
                f"inset {offset_x}px {offset_y}px {radius}px {spread}px {css_color}"
            )
        elif effect_type == "BACKGROUND_BLUR":
            backdrop_radius = max(backdrop_radius, radius)
        elif effect_type == "LAYER_BLUR":
            layer_blur = max(layer_blur, radius)
    box_shadow = ", ".join(box_shadows) if box_shadows else None
    backdrop = (
        f"blur({min(backdrop_radius / 4, 40):.1f}px)"
        if backdrop_radius
        else None
    )
    layer_filter = f"blur({layer_blur / 2:.1f}px)" if layer_blur else None
    return box_shadow, backdrop, layer_filter


def corners_css(node: dict[str, Any]) -> str | None:
    radii = node.get("rectangleCornerRadii")
    if isinstance(radii, list) and radii:
        return " ".join(f"{radius}px" for radius in radii)
    radius = node.get("cornerRadius")
    if isinstance(radius, (int, float)) and radius > 0:
        return f"{radius}px"
    return None


def strokes_to_border(node: dict[str, Any]) -> str | None:
    strokes = node.get("strokes") or []
    if not isinstance(strokes, list) or not strokes:
        return None
    stroke = strokes[0]
    if not isinstance(stroke, dict) or not stroke.get("visible", True):
        return None
    color = stroke.get("color", {})
    css_color = figma_color(color if isinstance(color, dict) else {})
    return f"{node.get('strokeWeight', 1)}px solid {css_color}"


def text_style_css(style: dict[str, Any]) -> str:
    family = style.get("fontFamily", "AC Nord Text")
    size = style.get("fontSize", 14)
    weight = style.get("fontWeight", 400)
    line_height = style.get("lineHeightPx") or size * 1.2
    letter_spacing = style.get("letterSpacing", 0)
    align = (style.get("textAlignHorizontal") or "LEFT").lower()
    return (
        f"font-family:'{family}','Helvetica Neue',sans-serif;"
        f"font-size:{size}px;font-weight:{weight};line-height:{line_height}px;"
        f"letter-spacing:{letter_spacing}px;text-align:{align};"
    )


class Renderer:
    def __init__(
        self,
        manifest_files: dict[str, Any],
        root_box: dict[str, float],
        assets_prefix: str = "",
    ) -> None:
        self.manifest = manifest_files
        self.root_box = root_box
        self.assets_prefix = assets_prefix

    def render(self, node: dict[str, Any], parent_box: dict[str, float]) -> str:
        """Render a node using coordinates relative to its rendered parent."""
        if node.get("visible", True) is False or node.get("opacity", 1) == 0:
            return ""

        node_id = str(node.get("id", ""))
        node_type = str(node.get("type", ""))
        box = node.get("absoluteBoundingBox") or {}
        if not isinstance(box, dict) or not box:
            return ""

        x = box.get("x", parent_box["x"]) - parent_box["x"]
        y = box.get("y", parent_box["y"]) - parent_box["y"]
        width = box.get("width", 0)
        height = box.get("height", 0)
        if width <= 0 or height <= 0:
            return ""
        if abs(x) < 5:
            x = 0
        if abs(y) < 5:
            y = 0

        children = node.get("children")
        child_nodes = (
            [child for child in children if isinstance(child, dict)]
            if isinstance(children, list)
            else []
        )
        if node_type == "GROUP":
            return "".join(self.render(child, parent_box) for child in child_nodes)

        vector_types = {
            "VECTOR",
            "LINE",
            "ELLIPSE",
            "STAR",
            "POLYGON",
            "BOOLEAN_OPERATION",
        }
        manifest_entry = self.manifest.get(node_id)
        use_asset = False
        if isinstance(manifest_entry, dict):
            if node_type in vector_types:
                use_asset = True
            elif node_type == "RECTANGLE":
                fills = node.get("fills") or []
                use_asset = isinstance(fills, list) and any(
                    isinstance(fill, dict) and fill.get("type") == "IMAGE"
                    for fill in fills
                )

        escaped_id = html.escape(node_id, quote=True)
        escaped_type = html.escape(node_type, quote=True)
        if use_asset and isinstance(manifest_entry, dict):
            asset_file = manifest_entry.get("file", "")
            source = html.escape(
                self.assets_prefix + str(asset_file), quote=True
            )
            image_blend = (
                "mix-blend-mode:multiply;"
                if node.get("blendMode", "NORMAL") == "PASS_THROUGH"
                else ""
            )
            return (
                f'<div class="abs" style="left:{x:.1f}px;top:{y:.1f}px;'
                f'width:{width:.1f}px;height:{height:.1f}px;" '
                f'data-id="{escaped_id}" data-type="{escaped_type}">'
                f'<img src="{source}" style="width:100%;height:100%;display:block;'
                f'object-fit:fill;{image_blend}">'
                "</div>"
            )

        if node_type == "TEXT":
            characters = html.escape(str(node.get("characters", ""))).replace(
                "\n", "<br>"
            )
            style = node.get("style", {})
            if not isinstance(style, dict):
                style = {}
            fills = node.get("fills") or []
            color = "#fff"
            if isinstance(fills, list):
                for fill in fills:
                    if (
                        isinstance(fill, dict)
                        and fill.get("type") == "SOLID"
                        and fill.get("visible", True)
                    ):
                        fill_color = fill.get("color", {})
                        color = figma_color(
                            fill_color if isinstance(fill_color, dict) else {}
                        )
                        break
            return (
                f'<div class="abs" style="left:{x:.1f}px;top:{y:.1f}px;'
                f"width:{width:.1f}px;{text_style_css(style)}"
                f'color:{color};white-space:pre-wrap;" '
                f'data-id="{escaped_id}" data-type="TEXT">{characters}</div>'
            )

        children_html = "".join(self.render(child, box) for child in child_nodes)
        style_parts = [
            f"left:{x:.1f}px",
            f"top:{y:.1f}px",
            f"width:{width:.1f}px",
            f"height:{height:.1f}px",
        ]
        background = fills_to_background(node.get("fills"))
        if background:
            style_parts.append(f"background:{background}")
        corners = corners_css(node)
        if corners:
            style_parts.append(f"border-radius:{corners}")
        border = strokes_to_border(node)
        if border:
            style_parts.append(f"border:{border}")
        box_shadow, backdrop, layer_filter = effects_to_filters(node.get("effects"))
        if box_shadow:
            style_parts.append(f"box-shadow:{box_shadow}")
        if layer_filter:
            style_parts.append(f"filter:{layer_filter}")
        if node.get("clipsContent", False) is True:
            style_parts.append("overflow:hidden")
        opacity = node.get("opacity", 1)
        if isinstance(opacity, (int, float)) and opacity < 1:
            style_parts.append(f"opacity:{opacity:.3f}")
        if backdrop:
            style_parts.append(f"backdrop-filter:{backdrop}")
            style_parts.append(f"-webkit-backdrop-filter:{backdrop}")

        return (
            f'<div class="abs" style="{";".join(style_parts)};" '
            f'data-id="{escaped_id}" data-type="{escaped_type}">'
            f"{children_html}</div>"
        )


def render_package(
    package_dir: Path,
    output: Path | None = None,
    compare: bool = False,
) -> RenderResult:
    """Render a validated context package and optional comparison page."""
    package_dir = Path(package_dir).resolve()
    validation = validate_package(package_dir)
    if validation.status is PackageStatus.INVALID:
        codes = ", ".join(item.code for item in validation.diagnostics)
        raise PackageRenderError(
            codes or "invalid_package", "context package validation failed"
        )

    manifest = _load_json_object(package_dir / "manifest.json")
    node_data = _load_json_object(package_dir / "node.json")
    root_node = _select_root(node_data, manifest)
    root_box = _root_bounds(root_node)
    width = root_box["width"]
    height = root_box["height"]
    root_name = str(root_node.get("name", "design"))
    manifest_files = manifest.get("files")
    if not isinstance(manifest_files, dict):
        raise PackageRenderError(
            "malformed_manifest", "manifest files must be a JSON object"
        )

    html_path = Path(output) if output is not None else package_dir / "reconstruct.html"
    package_prefix = _relative_prefix(html_path.parent, package_dir)
    renderer = Renderer(manifest_files, root_box, package_prefix)
    body_html = renderer.render(root_node, root_box)
    root_background = fills_to_background(root_node.get("fills")) or "#fff"
    html_path.write_text(
        _standalone_html(
            name=root_name,
            width=width,
            height=height,
            background=root_background,
            body=body_html,
        ),
        encoding="utf-8",
    )

    compare_path: Path | None = None
    if compare:
        screenshot = manifest.get("screenshot")
        if isinstance(screenshot, str) and (package_dir / screenshot).is_file():
            compare_path = html_path.parent / "compare.html"
            screenshot_source = html.escape(
                package_prefix + screenshot, quote=True
            )
            compare_path.write_text(
                _comparison_html(
                    name=root_name,
                    screenshot_name=screenshot,
                    screenshot_source=screenshot_source,
                    width=width,
                    height=height,
                    background=root_background,
                    body=body_html,
                ),
                encoding="utf-8",
            )

    return RenderResult(html_path, compare_path, width, height)


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PackageRenderError(
            "invalid_json", f"cannot read valid JSON object from {path.name}"
        ) from error
    if not isinstance(value, dict):
        raise PackageRenderError(
            "invalid_json", f"{path.name} must contain a JSON object"
        )
    return value


def _select_root(
    node_data: dict[str, Any], manifest: dict[str, Any]
) -> dict[str, Any]:
    nodes = node_data.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        raise PackageRenderError(
            "invalid_nodes", "node.json requires a non-empty nodes object"
        )
    source = manifest.get("source")
    node_id = source.get("nodeId") if isinstance(source, dict) else None
    if not isinstance(node_id, str) or not node_id:
        raise PackageRenderError(
            "missing_source_node", "manifest source.nodeId is required"
        )
    for candidate in (node_id, node_id.replace("-", ":"), node_id.replace(":", "-")):
        entry = nodes.get(candidate)
        document = entry.get("document") if isinstance(entry, dict) else None
        if isinstance(document, dict):
            return document
    raise PackageRenderError(
        "missing_source_node", f"node.json is missing selected node {node_id}"
    )


def _root_bounds(root_node: dict[str, Any]) -> dict[str, float]:
    bounds = root_node.get("absoluteBoundingBox")
    if not isinstance(bounds, dict):
        raise PackageRenderError(
            "missing_bounds", "selected root is missing absoluteBoundingBox"
        )
    result: dict[str, float] = {}
    for key in ("x", "y", "width", "height"):
        value = bounds.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PackageRenderError(
                "missing_bounds",
                f"selected root absoluteBoundingBox requires numeric {key}",
            )
        result[key] = value
    if result["width"] <= 0 or result["height"] <= 0:
        raise PackageRenderError(
            "missing_bounds", "selected root dimensions must be positive"
        )
    return result


def _relative_prefix(from_dir: Path, package_dir: Path) -> str:
    relative = os.path.relpath(package_dir, start=from_dir)
    if relative == ".":
        return ""
    return relative.replace(os.sep, "/").rstrip("/") + "/"


def _standalone_html(
    *, name: str, width: float, height: float, background: str, body: str
) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(name)}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: "AC Nord Text", -apple-system, "Helvetica Neue", sans-serif;
    background: {background};
  }}
  .page {{
    position: relative;
    width: {width}px;
    height: {height}px;
    margin: 0 auto;
    overflow: hidden;
  }}
  .abs {{ position: absolute; box-sizing: border-box; }}
  img {{ display: block; max-width: none; }}
</style>
</head>
<body>
<div class="page">
{body}
</div>
</body>
</html>
"""


def _comparison_html(
    *,
    name: str,
    screenshot_name: str,
    screenshot_source: str,
    width: float,
    height: float,
    background: str,
    body: str,
) -> str:
    escaped_name = html.escape(name)
    escaped_screenshot_name = html.escape(screenshot_name)
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Compare - {escaped_name}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:24px; background:#0a0a12; color:#eee;
         font-family: -apple-system, "Helvetica Neue", sans-serif; }}
  .cmp {{ display:flex; gap:16px; justify-content:center; flex-wrap:wrap; }}
  .p {{ background:#14141f; border:1px solid #26263a; border-radius:8px; padding:12px; }}
  .p h2 {{ margin:0 0 8px; font-size:12px; color:#888; font-weight:500; }}
  .stage {{ position:relative; width:{width}px; height:{height}px; overflow:hidden; background:{background}; }}
  .stage img {{ width:100%; height:100%; object-fit:fill; }}
  .abs {{ position:absolute; box-sizing:border-box; }}
  img {{ max-width:none; }}
</style>
</head>
<body>
<div class="cmp">
  <div class="p">
    <h2>Reconstruct</h2>
    <div class="stage">{body}</div>
  </div>
  <div class="p">
    <h2>Original {escaped_screenshot_name}</h2>
    <div class="stage"><img src="{screenshot_source}" alt="original"></div>
  </div>
</div>
</body>
</html>
"""
