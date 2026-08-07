#!/usr/bin/env python3
"""Render a figma-context-bridge download package into a standalone HTML.

Recursively walks node.json and produces absolutely-positioned HTML that
mirrors the Figma layout. For any node that was exported as a PNG (listed in
manifest.json), the raster image is used directly — this guarantees fidelity
for VECTOR / INSTANCE / IMAGE-fill nodes. Other nodes (TEXT, FRAME, RECTANGLE)
are rendered with native HTML/CSS translated from Figma properties.

Usage:
  python render_html.py downloads/<fileKey>_<nodeId>/            # writes reconstruct.html
  python render_html.py downloads/<fileKey>_<nodeId>/ -o out.html
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Figma -> CSS converters
# ---------------------------------------------------------------------------
def figma_color(c: dict) -> str:
    r = round(c.get("r", 0) * 255)
    g = round(c.get("g", 0) * 255)
    b = round(c.get("b", 0) * 255)
    a = c.get("a", 1)
    return f"rgb({r},{g},{b})" if a >= 1 else f"rgba({r},{g},{b},{a:.3f})"


def fills_to_background(fills: list | None) -> str | None:
    """Convert Figma fills to a CSS background value (may be multi-layered)."""
    if not fills:
        return None
    visible = [f for f in fills if f.get("visible", True)]
    if not visible:
        return None
    layers = []
    for f in visible:
        t = f.get("type")
        blend = f.get("blendMode", "NORMAL")
        if t == "SOLID":
            c = f.get("color", {})
            op = f.get("opacity", 1)
            a = c.get("a", 1) * op
            # White fill with MULTIPLY blendMode is a no-op (x * white = x).
            # Rendering it as opaque white would wrongly cover layers beneath.
            is_white = c.get("r", 0) >= 0.95 and c.get("g", 0) >= 0.95 and c.get("b", 0) >= 0.95
            if blend == "MULTIPLY" and is_white:
                continue
            col = figma_color({**c, "a": a})
            layers.append(col)
        elif t in ("GRADIENT_LINEAR", "GRADIENT_RADIAL"):
            stops = f.get("gradientStops", [])
            css_stops = ", ".join(
                f"{figma_color(s.get('color', {}))} {s.get('position', 0) * 100:.1f}%"
                for s in stops
            )
            if t == "GRADIENT_LINEAR":
                layers.append(f"linear-gradient(90deg, {css_stops})")
            else:
                layers.append(f"radial-gradient(circle, {css_stops})")
        # IMAGE fills handled by caller via manifest lookup
    return ", ".join(reversed(layers)) if layers else None


def effects_to_filters(effects: list | None) -> tuple[str | None, str | None, str | None]:
    """Return (box_shadow, backdrop_filter, filter)."""
    if not effects:
        return None, None, None
    box_shadows: list[str] = []
    backdrop_radius = 0
    layer_blur = 0
    for e in effects:
        if not e.get("visible", True):
            continue
        t = e.get("type")
        col = figma_color(e.get("color", {}))
        off = e.get("offset", {"x": 0, "y": 0})
        ox = off.get("x", 0)
        oy = off.get("y", 0)
        r = e.get("radius", 0)
        spread = e.get("spread", 0)
        if t == "DROP_SHADOW":
            box_shadows.append(f"{ox}px {oy}px {r}px {spread}px {col}")
        elif t == "INNER_SHADOW":
            box_shadows.append(f"inset {ox}px {oy}px {r}px {spread}px {col}")
        elif t == "BACKGROUND_BLUR":
            backdrop_radius = max(backdrop_radius, r)
        elif t == "LAYER_BLUR":
            layer_blur = max(layer_blur, r)
    box = ", ".join(box_shadows) if box_shadows else None
    backdrop = f"blur({min(backdrop_radius / 4, 40):.1f}px)" if backdrop_radius else None
    filt = f"blur({layer_blur / 2:.1f}px)" if layer_blur else None
    return box, backdrop, filt


def corners_css(node: dict) -> str | None:
    radii = node.get("rectangleCornerRadii")
    if radii:
        return " ".join(f"{r}px" for r in radii)
    cr = node.get("cornerRadius")
    if cr is not None and cr > 0:
        return f"{cr}px"
    return None


def strokes_to_border(node: dict) -> str | None:
    strokes = node.get("strokes") or []
    if not strokes:
        return None
    s = strokes[0]
    if not s.get("visible", True):
        return None
    col = figma_color(s.get("color", {}))
    w = node.get("strokeWeight", 1)
    align = node.get("strokeAlign", "CENTER").lower()
    # Approximate: outer/center/inner all rendered as standard border
    return f"{w}px {align == 'inside' and 'solid' or 'solid'} {col}"


def text_style_css(style: dict) -> str:
    family = style.get("fontFamily", "AC Nord Text")
    size = style.get("fontSize", 14)
    weight = style.get("fontWeight", 400)
    lh = style.get("lineHeightPx") or size * 1.2
    ls = style.get("letterSpacing", 0)
    align = (style.get("textAlignHorizontal") or "LEFT").lower()
    return (
        f"font-family:'{family}','Helvetica Neue',sans-serif;"
        f"font-size:{size}px;font-weight:{weight};line-height:{lh}px;"
        f"letter-spacing:{ls}px;text-align:{align};"
    )


# ---------------------------------------------------------------------------
# Recursive renderer
# ---------------------------------------------------------------------------
class Renderer:
    def __init__(self, manifest_files: dict, root_box: dict, assets_prefix: str = ""):
        self.manifest = manifest_files
        self.root_box = root_box
        self.assets_prefix = assets_prefix

    def render(self, node: dict, parent_box: dict) -> str:
        """Render a node. Coordinates are computed relative to parent_box so
        that nested absolutely-positioned divs land in the right place.

        GROUP nodes do not create a DOM element: their children are emitted
        inline using the inherited parent_box (the GROUP's parent's coords).
        """
        if node.get("visible", True) is False:
            return ""
        if node.get("opacity", 1) == 0:
            return ""

        nid = node["id"]
        ntype = node["type"]
        box = node.get("absoluteBoundingBox") or {}
        if not box:
            return ""

        # Coordinates are relative to the parent's bounding box.
        # This is critical: CSS position:absolute is relative to the nearest
        # positioned ancestor, which is the parent div we emit.
        x = box.get("x", parent_box["x"]) - parent_box["x"]
        y = box.get("y", parent_box["y"]) - parent_box["y"]
        w = box.get("width", 0)
        h = box.get("height", 0)
        if w <= 0 or h <= 0:
            return ""

        # Snap near-zero offsets to 0 for full-bleed background layers.
        # Figma sometimes reports y=2 for a 1920x1793 background that should
        # cover the entire 1920x1795 root — this 2px gap shows through.
        if abs(x) < 5:
            x = 0
        if abs(y) < 5:
            y = 0

        # GROUP — transparent logical container, emit children inline with
        # the SAME parent_box (no DOM wrapper, so no coordinate shift).
        if ntype == "GROUP":
            return "".join(self.render(c, parent_box) for c in node.get("children", []))

        # VECTOR / image-RECTANGLE -> use raster PNG from manifest
        VECTOR_TYPES = {"VECTOR", "LINE", "ELLIPSE", "STAR", "POLYGON", "BOOLEAN_OPERATION"}
        use_png = False
        if nid in self.manifest:
            if ntype in VECTOR_TYPES:
                use_png = True
            elif ntype == "RECTANGLE":
                fills = node.get("fills") or []
                use_png = any(
                    isinstance(f, dict) and f.get("type") == "IMAGE" for f in fills
                )

        if use_png:
            src = self.assets_prefix + self.manifest[nid]["file"]
            # Figma's blendMode=PASS_THROUGH means the node doesn't create a
            # new compositing layer — its content shows through to whatever is
            # below. When exported as a standalone PNG this effect is lost, so
            # white/light VECTORs become opaque white boxes that cover everything
            # beneath them. Use mix-blend-mode:multiply to approximate PASS_THROUGH:
            # white (255) becomes transparent, colored pixels blend with layers below.
            blend = node.get("blendMode", "NORMAL")
            img_blend = ""
            if blend == "PASS_THROUGH":
                img_blend = "mix-blend-mode:multiply;"

            return (
                f'<div class="abs" style="left:{x:.1f}px;top:{y:.1f}px;'
                f"width:{w:.1f}px;height:{h:.1f}px;\" "
                f'data-id="{nid}" data-type="{ntype}">'
                f'<img src="{src}" style="width:100%;height:100%;display:block;object-fit:fill;{img_blend}">'
                f"</div>"
            )

        # TEXT node -> native HTML text.
        # NOTE: Figma's absoluteBoundingBox.height for TEXT is often smaller than
        # lineHeightPx (it reflects the glyph baseline box, not the full line).
        # Using it + overflow:hidden clips text. So we DON'T set a fixed height
        # and DON'T clip — let the text flow naturally.
        if ntype == "TEXT":
            chars = node.get("characters", "")
            escaped = html.escape(chars).replace("\n", "<br>")
            style = node.get("style", {})
            fills = node.get("fills") or []
            color = "#fff"
            for f in fills:
                if f.get("type") == "SOLID" and f.get("visible", True):
                    color = figma_color(f.get("color", {}))
                    break
            # lineHeightPx drives vertical sizing; width from boundingBox; no height clamp
            lh = style.get("lineHeightPx") or style.get("fontSize", 14) * 1.2
            return (
                f'<div class="abs" style="left:{x:.1f}px;top:{y:.1f}px;'
                f"width:{w:.1f}px;{text_style_css(style)}"
                f'color:{color};white-space:pre-wrap;" '
                f'data-id="{nid}" data-type="TEXT">{escaped}</div>'
            )

        # FRAME / RECTANGLE / COMPONENT / INSTANCE -> div, children relative to THIS node's box
        children_html = "".join(self.render(c, box) for c in node.get("children", []))

        style_parts: list[str] = [
            f"left:{x:.1f}px",
            f"top:{y:.1f}px",
            f"width:{w:.1f}px",
            f"height:{h:.1f}px",
        ]

        bg = fills_to_background(node.get("fills"))
        if bg:
            style_parts.append(f"background:{bg}")

        cr = corners_css(node)
        if cr:
            style_parts.append(f"border-radius:{cr}")

        border = strokes_to_border(node)
        if border:
            style_parts.append(f"border:{border}")

        box_sh, backdrop, filt = effects_to_filters(node.get("effects"))
        if box_sh:
            style_parts.append(f"box-shadow:{box_sh}")
        if filt:
            style_parts.append(f"filter:{filt}")

        if node.get("clipsContent", False) or node.get("clipsContent") is True:
            style_parts.append("overflow:hidden")

        opacity = node.get("opacity", 1)
        if opacity < 1:
            style_parts.append(f"opacity:{opacity:.3f}")

        # backdrop-filter must be applied even without other visible content
        backdrop_attr = ""
        if backdrop:
            style_parts.append(f"backdrop-filter:{backdrop}")
            style_parts.append(f"-webkit-backdrop-filter:{backdrop}")

        # VECTOR without manifest image: render as transparent placeholder
        # (true vector path data isn't in node.json without geometry=paths)
        return (
            f'<div class="abs" style="{";".join(style_parts)};" '
            f'data-id="{nid}" data-type="{ntype}">{children_html}</div>'
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="Render a figma-context-bridge package to HTML.")
    ap.add_argument("package_dir", help="Path to the downloads/<fileKey>_<nodeId>/ directory")
    ap.add_argument("-o", "--output", default=None, help="Output HTML path (default: <pkg>/reconstruct.html)")
    ap.add_argument("--compare", action="store_true", help="Also write compare.html with side-by-side original screenshot")
    args = ap.parse_args()

    pkg = Path(args.package_dir).resolve()
    if not pkg.is_dir():
        sys.exit(f"Not a directory: {pkg}")

    node_path = pkg / "node.json"
    manifest_path = pkg / "manifest.json"
    if not node_path.exists():
        sys.exit(f"Missing node.json in {pkg}")

    data = json.loads(node_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest_files = manifest.get("files", {})

    nodes_field = data.get("nodes", {})
    first_key = next(iter(nodes_field))
    root_node = nodes_field[first_key]["document"]
    root_box = root_node["absoluteBoundingBox"]

    renderer = Renderer(manifest_files, root_box)
    body_html = renderer.render(root_node, root_box)

    root_w = root_box["width"]
    root_h = root_box["height"]
    root_name = root_node.get("name", "design")

    # Root node fills: use as page background if it's a solid color
    root_bg = fills_to_background(root_node.get("fills")) or "#fff"

    # --- Mode 1: pure frontend page (default) ---
    # A clean, production-ready HTML page with no debug UI.
    pure_html = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(root_name)}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: "AC Nord Text", -apple-system, "Helvetica Neue", sans-serif;
    background: {root_bg};
  }}
  .page {{
    position: relative;
    width: {root_w}px;
    height: {root_h}px;
    margin: 0 auto;
    overflow: hidden;
  }}
  .abs {{ position: absolute; box-sizing: border-box; }}
  img {{ display: block; max-width: none; }}
</style>
</head>
<body>
<div class="page">
{body_html}
</div>
</body>
</html>
"""

    # --- Mode 2: compare page (opt-in via --compare) ---
    compare_html = ""
    if args.compare and (pkg / "screenshot.png").exists():
        compare_html = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Compare - {html.escape(root_name)}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:24px; background:#0a0a12; color:#eee;
         font-family: -apple-system, "Helvetica Neue", sans-serif; }}
  .cmp {{ display:flex; gap:16px; justify-content:center; flex-wrap:wrap; }}
  .p {{ background:#14141f; border:1px solid #26263a; border-radius:8px; padding:12px; }}
  .p h2 {{ margin:0 0 8px; font-size:12px; color:#888; font-weight:500; }}
  .stage {{ position:relative; width:{root_w}px; height:{root_h}px; overflow:hidden; background:{root_bg}; }}
  .stage img {{ width:100%; height:100%; object-fit:fill; }}
  .abs {{ position:absolute; box-sizing:border-box; }}
  img {{ max-width:none; }}
</style>
</head>
<body>
<div class="cmp">
  <div class="p">
    <h2>Reconstruct</h2>
    <div class="stage">{body_html}</div>
  </div>
  <div class="p">
    <h2>Original screenshot.png</h2>
    <div class="stage"><img src="screenshot.png" alt="original"></div>
  </div>
</div>
</body>
</html>
"""

    # Write outputs
    out_pure = Path(args.output) if args.output else pkg / "reconstruct.html"
    out_pure.write_text(pure_html, encoding="utf-8")
    print(f"[OK] {out_pure}  ({root_w}x{root_h}, {len(manifest_files)} assets)")

    if compare_html:
        out_cmp = out_pure.parent / "compare.html"
        out_cmp.write_text(compare_html, encoding="utf-8")
        print(f"[OK] {out_cmp}  (side-by-side comparison)")


if __name__ == "__main__":
    sys.exit(main())
