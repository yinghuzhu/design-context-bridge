from __future__ import annotations

import json
import math
import re
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import Any


def walk_nodes(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield a Figma node tree in stable depth-first order."""
    yield node
    children = node.get("children")
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            yield from walk_nodes(child)


def extract_styles(root: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Extract reusable, de-duplicated style values from a Figma node tree."""
    colors: dict[str, dict[str, Any]] = {}
    typography: dict[str, dict[str, Any]] = {}
    spacing: dict[str, dict[str, Any]] = {}
    radii: dict[str, dict[str, Any]] = {}
    effects: dict[str, dict[str, Any]] = {}

    for index, node in enumerate(walk_nodes(root)):
        node_id = _node_reference(node, index)

        for source in ("fills", "strokes"):
            paints = node.get(source)
            if not isinstance(paints, list):
                continue
            for paint in paints:
                if (
                    not isinstance(paint, dict)
                    or paint.get("type") != "SOLID"
                    or paint.get("visible") is False
                ):
                    continue
                rgba = _normalized_rgba(paint.get("color"), paint.get("opacity"))
                if rgba is None:
                    continue
                key = _stable_key(rgba)
                entry = colors.setdefault(
                    key,
                    {
                        "rgba": rgba,
                        "css": _rgba_css(rgba),
                        "sources": set(),
                        "nodeIds": set(),
                    },
                )
                entry["sources"].add(source)
                entry["nodeIds"].add(node_id)

        if node.get("type") == "TEXT" and isinstance(node.get("style"), dict):
            value = _typography_value(node["style"])
            if value:
                key = _stable_key(value)
                entry = typography.setdefault(key, {**value, "nodeIds": set()})
                entry["nodeIds"].add(node_id)

        for property_name in (
            "itemSpacing",
            "paddingBottom",
            "paddingLeft",
            "paddingRight",
            "paddingTop",
        ):
            value = _normalized_number(node.get(property_name))
            if value is None:
                continue
            key = _stable_key(value)
            entry = spacing.setdefault(
                key,
                {"value": value, "properties": set(), "nodeIds": set()},
            )
            entry["properties"].add(property_name)
            entry["nodeIds"].add(node_id)

        radius_value = _radius_value(node)
        if radius_value is not None:
            key = _stable_key(radius_value)
            entry = radii.setdefault(
                key, {"value": radius_value, "nodeIds": set()}
            )
            entry["nodeIds"].add(node_id)

        node_effects = node.get("effects")
        if isinstance(node_effects, list):
            for effect in node_effects:
                value = _effect_value(effect)
                if value is None:
                    continue
                key = _stable_key(value)
                entry = effects.setdefault(key, {**value, "nodeIds": set()})
                entry["nodeIds"].add(node_id)

    return {
        "colors": _finalize_entries(colors, set_fields=("nodeIds", "sources")),
        "typography": _finalize_entries(typography, set_fields=("nodeIds",)),
        "spacing": _finalize_entries(
            spacing, set_fields=("nodeIds", "properties")
        ),
        "radii": _finalize_entries(radii, set_fields=("nodeIds",)),
        "effects": _finalize_entries(effects, set_fields=("nodeIds",)),
    }


def extract_components(root: dict[str, Any]) -> dict[str, Any]:
    """Extract component definitions and instance-to-component relationships."""
    components: list[dict[str, Any]] = []
    component_sets: list[dict[str, Any]] = []
    instances: list[dict[str, Any]] = []
    referenced_ids: set[str] = set()

    for node in walk_nodes(root):
        node_type = node.get("type")
        if node_type in {"COMPONENT", "COMPONENT_SET"}:
            entry = _component_definition(node)
            if node_type == "COMPONENT":
                components.append(entry)
            else:
                component_sets.append(entry)
            continue

        if node_type != "INSTANCE":
            continue
        component_id = node.get("componentId")
        if not isinstance(component_id, str):
            main_component = node.get("mainComponent")
            if isinstance(main_component, dict):
                value = main_component.get("id")
                component_id = value if isinstance(value, str) else None
            else:
                component_id = None
        entry: dict[str, Any] = {
            "id": _string_value(node.get("id")),
            "name": _string_value(node.get("name")),
            "componentId": component_id,
        }
        for key in (
            "componentProperties",
            "componentPropertyReferences",
            "variantProperties",
        ):
            value = node.get(key)
            if isinstance(value, dict):
                entry[key] = _sorted_json_value(value)
        instances.append(entry)
        if component_id:
            referenced_ids.add(component_id)

    sort_key = lambda item: (item.get("id", ""), item.get("name", ""))
    return {
        "components": sorted(components, key=sort_key),
        "componentSets": sorted(component_sets, key=sort_key),
        "instances": sorted(instances, key=sort_key),
        "referencedComponentIds": sorted(referenced_ids),
    }


def render_ai_context(
    root: dict[str, Any],
    manifest: dict[str, Any],
    components: dict[str, Any] | None = None,
) -> str:
    """Render a compact navigation document without embedding raw design data."""
    component_data = components or extract_components(root)
    root_name = _markdown_text(_string_value(root.get("name")) or "Untitled")
    root_id = _markdown_text(_string_value(root.get("id")) or "unknown")
    bounds = root.get("absoluteBoundingBox")
    width = _number_from_mapping(bounds, "width")
    height = _number_from_mapping(bounds, "height")
    dimensions = (
        f"{_display_number(width)} × {_display_number(height)}"
        if width is not None and height is not None
        else "not available"
    )
    screenshot = _relative_package_path(manifest.get("screenshot"))
    if screenshot is None:
        screenshot = "screenshot (see manifest.json)"

    lines = [
        f"# Figma Design Context: {root_name}",
        "",
        "This file is a deterministic navigation summary for an AI Agent.",
        "",
        "## Source-of-truth priority",
        "",
        f"1. `{screenshot}` — visual source of truth.",
        "2. `node.json` — exact geometry, text, and node properties.",
        "3. `assets/` — original exported media and vectors.",
        "4. `AI_CONTEXT.md`, `styles.json`, and `components.json` — navigation and reuse aids.",
        "5. `reconstruct.html` — auxiliary observation only, never the implementation source of truth.",
        "",
        "## Page summary",
        "",
        f"- Root: **{root_name}** (`{root_id}`)",
        f"- Type: `{_markdown_text(_string_value(root.get('type')) or 'unknown')}`",
        f"- Dimensions: **{dimensions}**",
    ]

    source = manifest.get("source")
    if isinstance(source, dict):
        file_key = source.get("fileKey")
        node_id = source.get("nodeId")
        if isinstance(file_key, str) and file_key:
            lines.append(f"- Figma file key: `{_markdown_text(file_key)}`")
        if isinstance(node_id, str) and node_id:
            lines.append(f"- Selected node: `{_markdown_text(node_id)}`")

    lines.extend(["", "## Top-level regions", ""])
    children = root.get("children")
    visible_children = (
        [child for child in children if isinstance(child, dict) and child.get("visible") is not False]
        if isinstance(children, list)
        else []
    )
    if not visible_children:
        lines.append("- No visible top-level regions.")
    else:
        lines.extend(
            [
                "| Node | Type | Dimensions |",
                "|---|---|---|",
            ]
        )
        for child in visible_children:
            child_bounds = child.get("absoluteBoundingBox")
            child_width = _number_from_mapping(child_bounds, "width")
            child_height = _number_from_mapping(child_bounds, "height")
            child_dimensions = (
                f"{_display_number(child_width)} × {_display_number(child_height)}"
                if child_width is not None and child_height is not None
                else "—"
            )
            label = _markdown_table_text(
                _string_value(child.get("name"))
                or _string_value(child.get("id"))
                or "unnamed"
            )
            node_type = _markdown_table_text(
                _string_value(child.get("type")) or "unknown"
            )
            lines.append(f"| {label} | `{node_type}` | {child_dimensions} |")

    lines.extend(["", "## Visible text", ""])
    visible_text = [
        node
        for node in _walk_effectively_visible(root)
        if node.get("type") == "TEXT"
        and isinstance(node.get("characters"), str)
        and node["characters"]
    ]
    if not visible_text:
        lines.append("- No visible text nodes.")
    else:
        for node in sorted(
            visible_text,
            key=lambda item: (
                _string_value(item.get("id")),
                _string_value(item.get("name")),
            ),
        ):
            node_id = _markdown_text(_string_value(node.get("id")) or "unknown")
            name = _markdown_text(_string_value(node.get("name")) or "Text")
            text = _markdown_text(node["characters"])
            lines.append(f"- `{node_id}` **{name}**: {text}")

    lines.extend(["", "## Component summary", ""])
    definitions = component_data["components"] + component_data["componentSets"]
    instances = component_data["instances"]
    lines.append(
        f"- Definitions: {len(definitions)}; instances: {len(instances)}."
    )
    for item in definitions:
        kind = "Component set" if item.get("type") == "COMPONENT_SET" else "Component"
        lines.append(
            f"- {kind} `{_markdown_text(item.get('id') or 'unknown')}`: "
            f"{_markdown_text(item.get('name') or 'Unnamed')}"
        )
    for item in instances:
        reference = item.get("componentId") or "unresolved"
        lines.append(
            f"- Instance `{_markdown_text(item.get('id') or 'unknown')}` "
            f"{_markdown_text(item.get('name') or 'Unnamed')} → "
            f"`{_markdown_text(reference)}`"
        )

    lines.extend(["", "## Asset inventory", ""])
    files = manifest.get("files")
    assets: list[tuple[str, str, str]] = []
    if isinstance(files, dict):
        for node_id, value in files.items():
            if not isinstance(node_id, str) or not isinstance(value, dict):
                continue
            asset_path = _relative_package_path(value.get("file"))
            if asset_path is None:
                continue
            name = value.get("name")
            assets.append(
                (
                    node_id,
                    name if isinstance(name, str) else "Unnamed asset",
                    asset_path,
                )
            )
    if not assets:
        lines.append("- No exported assets are listed in the manifest.")
    else:
        for node_id, name, asset_path in sorted(assets):
            lines.append(
                f"- `{_markdown_text(node_id)}` "
                f"{_markdown_text(name)}: `{_markdown_text(asset_path)}`"
            )

    lines.extend(
        [
            "",
            "## Implementation guidance",
            "",
            "- Inspect the screenshot first, then query only the relevant nodes in `node.json`.",
            "- Reuse package assets by their relative paths; do not reuse temporary export URLs.",
            "- Preserve existing routes, data flow, interactions, validation, and error behavior in the target project.",
            "",
        ]
    )
    return "\n".join(lines)


def generate_context_files(package_dir: Path) -> tuple[Path, Path, Path]:
    """Generate deterministic AI context, style, and component files offline."""
    package_dir = Path(package_dir)
    manifest = _load_json_object(package_dir / "manifest.json")
    node_data = _load_json_object(package_dir / "node.json")
    root = _select_root(node_data, manifest)

    styles = extract_styles(root)
    components = extract_components(root)
    markdown = render_ai_context(root, manifest, components)

    context_path = package_dir / "AI_CONTEXT.md"
    styles_path = package_dir / "styles.json"
    components_path = package_dir / "components.json"
    context_path.write_text(markdown, encoding="utf-8")
    _write_json(styles_path, styles)
    _write_json(components_path, components)
    return context_path, styles_path, components_path


def _component_definition(node: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": _string_value(node.get("id")),
        "name": _string_value(node.get("name")),
        "type": _string_value(node.get("type")),
    }
    description = node.get("description")
    if isinstance(description, str) and description:
        entry["description"] = description
    for key in (
        "componentPropertyDefinitions",
        "componentProperties",
        "variantProperties",
    ):
        value = node.get(key)
        if isinstance(value, dict):
            entry[key] = _sorted_json_value(value)
    return entry


def _typography_value(style: dict[str, Any]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key in (
        "fontFamily",
        "fontPostScriptName",
        "fontSize",
        "fontWeight",
        "italic",
        "letterSpacing",
        "lineHeightPercent",
        "lineHeightPx",
        "paragraphIndent",
        "paragraphSpacing",
        "textAlignHorizontal",
        "textAlignVertical",
        "textAutoResize",
        "textCase",
        "textDecoration",
    ):
        item = style.get(key)
        normalized = _normalized_scalar(item)
        if normalized is not None:
            value[key] = normalized
    return value


def _radius_value(node: dict[str, Any]) -> float | list[float] | None:
    radius = _normalized_number(node.get("cornerRadius"))
    if radius is not None:
        return radius
    values = node.get("rectangleCornerRadii")
    if not isinstance(values, list) or len(values) != 4:
        return None
    normalized = [_normalized_number(item) for item in values]
    if any(item is None for item in normalized):
        return None
    return [item for item in normalized if item is not None]


def _effect_value(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("visible") is False:
        return None
    effect_type = value.get("type")
    if not isinstance(effect_type, str) or not effect_type:
        return None
    result: dict[str, Any] = {"type": effect_type}
    for key in ("radius", "spread"):
        number = _normalized_number(value.get(key))
        if number is not None:
            result[key] = number
    offset = value.get("offset")
    if isinstance(offset, dict):
        x = _normalized_number(offset.get("x"))
        y = _normalized_number(offset.get("y"))
        if x is not None and y is not None:
            result["offset"] = {"x": x, "y": y}
    color = _normalized_rgba(value.get("color"))
    if color is not None:
        result["color"] = color
    blend_mode = value.get("blendMode")
    if isinstance(blend_mode, str):
        result["blendMode"] = blend_mode
    return result


def _normalized_rgba(value: Any, opacity: Any = None) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    channels = [_normalized_number(value.get(key)) for key in ("r", "g", "b")]
    if any(item is None for item in channels):
        return None
    alpha = _normalized_number(value.get("a"))
    alpha = 1.0 if alpha is None else alpha
    paint_opacity = _normalized_number(opacity)
    if paint_opacity is not None:
        alpha *= paint_opacity
    return {
        "r": _clamp_channel(channels[0]),
        "g": _clamp_channel(channels[1]),
        "b": _clamp_channel(channels[2]),
        "a": _clamp_channel(alpha),
    }


def _rgba_css(rgba: dict[str, float]) -> str:
    red = round(rgba["r"] * 255)
    green = round(rgba["g"] * 255)
    blue = round(rgba["b"] * 255)
    alpha = _display_number(rgba["a"])
    return f"rgba({red}, {green}, {blue}, {alpha})"


def _finalize_entries(
    entries: dict[str, dict[str, Any]], *, set_fields: tuple[str, ...]
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for key in sorted(entries):
        entry = entries[key]
        for field in set_fields:
            values = entry.get(field)
            if isinstance(values, set):
                entry[field] = sorted(values)
        node_ids = entry.get("nodeIds")
        entry["usageCount"] = len(node_ids) if isinstance(node_ids, list) else 0
        result.append(entry)
    return result


def _walk_effectively_visible(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    if node.get("visible") is False:
        return
    yield node
    children = node.get("children")
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            yield from _walk_effectively_visible(child)


def _select_root(
    node_data: dict[str, Any], manifest: dict[str, Any]
) -> dict[str, Any]:
    nodes = node_data.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        raise ValueError("node.json requires a non-empty nodes object")
    source = manifest.get("source")
    node_id = source.get("nodeId") if isinstance(source, dict) else None
    if isinstance(node_id, str):
        candidates = (node_id, node_id.replace("-", ":"), node_id.replace(":", "-"))
        for candidate in candidates:
            entry = nodes.get(candidate)
            document = entry.get("document") if isinstance(entry, dict) else None
            if isinstance(document, dict):
                return document
        raise ValueError(f"node.json is missing selected node {node_id}")
    if len(nodes) != 1:
        raise ValueError("manifest source.nodeId is required for multiple nodes")
    entry = next(iter(nodes.values()))
    document = entry.get("document") if isinstance(entry, dict) else None
    if not isinstance(document, dict):
        raise ValueError("selected node is missing its document object")
    return document


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read valid JSON object from {path.name}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _relative_package_path(value: Any) -> str | None:
    if not isinstance(value, str) or not value or "?" in value or "#" in value:
        return None
    if "://" in value or "\\" in value:
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        return None
    return str(path)


def _markdown_text(value: str) -> str:
    redacted = re.sub(r"https?://\S+", "[URL omitted]", value)
    return " ".join(redacted.replace("`", "\\`").split())


def _markdown_table_text(value: str) -> str:
    return _markdown_text(value).replace("|", "\\|")


def _node_reference(node: dict[str, Any], index: int) -> str:
    value = node.get("id")
    return value if isinstance(value, str) and value else f"@node-{index:06d}"


def _normalized_scalar(value: Any) -> str | bool | float | None:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return value
    return _normalized_number(value)


def _normalized_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return round(number, 6)


def _number_from_mapping(value: Any, key: str) -> float | None:
    if not isinstance(value, dict):
        return None
    return _normalized_number(value.get(key))


def _clamp_channel(value: float | None) -> float:
    assert value is not None
    return round(min(1.0, max(0.0, value)), 6)


def _display_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:g}"


def _stable_key(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sorted_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sorted_json_value(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_sorted_json_value(item) for item in value]
    return value


def _string_value(value: Any) -> str:
    return value if isinstance(value, str) else ""
