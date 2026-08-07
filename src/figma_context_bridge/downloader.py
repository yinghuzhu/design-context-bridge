from __future__ import annotations

import json
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import Diagnostic, FigmaTarget, PackageStatus, PackageValidation
from .package import build_fingerprint, publish_staging, validate_package
from .url import parse_figma_url


EXPORT_NODE_TYPES = {
    "INSTANCE",
    "COMPONENT",
    "VECTOR",
    "BOOLEAN_OPERATION",
}
SUPPORTED_FORMATS = {"png", "jpg", "svg"}
_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "authorization",
    "figma_token",
    "secret",
    "token",
}


class DownloaderClient(Protocol):
    def fetch_node(self, target: FigmaTarget) -> dict[str, Any]: ...

    def export_image_urls(
        self,
        file_key: str,
        node_ids: list[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]: ...

    def download(self, url: str, destination: Path) -> None: ...


@dataclass(frozen=True)
class PrepareOptions:
    output_root: Path
    fmt: str = "png"
    scale: int = 2
    force: bool = False


@dataclass(frozen=True)
class PrepareResult:
    package_dir: Path
    validation: PackageValidation
    cache_hit: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "packageDir": str(self.package_dir),
            "cacheHit": self.cache_hit,
            **self.validation.to_dict(),
        }


def collect_export_targets(root_node: dict[str, Any]) -> list[dict[str, str]]:
    """Return deduplicated export targets in depth-first order."""
    targets: list[dict[str, str]] = []
    seen: set[str] = set()

    def visit(node: dict[str, Any]) -> None:
        node_id_value = node.get("id")
        node_id = (
            _colon_id(node_id_value) if isinstance(node_id_value, str) else None
        )
        node_type_value = node.get("type")
        node_type = node_type_value if isinstance(node_type_value, str) else ""
        fills = node.get("fills")
        has_image_fill = isinstance(fills, list) and any(
            isinstance(fill, dict) and fill.get("type") == "IMAGE"
            for fill in fills
        )

        if (
            node_id
            and ";" not in node_id
            and node_id not in seen
            and (has_image_fill or node_type in EXPORT_NODE_TYPES)
        ):
            name_value = node.get("name")
            targets.append(
                {
                    "id": node_id,
                    "name": name_value if isinstance(name_value, str) else "",
                    "type": node_type,
                }
            )
            seen.add(node_id)

        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    visit(child)

    visit(root_node)
    return targets


def prepare_package(
    source_url: str,
    client: DownloaderClient,
    options: PrepareOptions,
) -> PrepareResult:
    target = parse_figma_url(source_url)
    fmt = options.fmt.lower()
    if fmt not in SUPPORTED_FORMATS:
        raise ValueError(f"unsupported export format: {options.fmt}")
    if options.scale < 1:
        raise ValueError("export scale must be at least 1")

    output_root = Path(options.output_root)
    destination = output_root / target.cache_key
    fingerprint = build_fingerprint(target, fmt, options.scale)
    if not options.force:
        cached = _matching_cache(destination, fingerprint)
        if cached is not None:
            return PrepareResult(
                package_dir=destination,
                validation=cached,
                cache_hit=True,
            )

    output_root.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{destination.name}.staging-",
            dir=output_root,
        )
    )
    try:
        _prepare_staging(
            source_url=source_url,
            target=target,
            client=client,
            options=PrepareOptions(
                output_root=output_root,
                fmt=fmt,
                scale=options.scale,
                force=options.force,
            ),
            fingerprint=fingerprint,
            staging=staging,
        )
        validation = publish_staging(staging, destination)
        return PrepareResult(
            package_dir=destination,
            validation=validation,
            cache_hit=False,
        )
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def _prepare_staging(
    *,
    source_url: str,
    target: FigmaTarget,
    client: DownloaderClient,
    options: PrepareOptions,
    fingerprint: str,
    staging: Path,
) -> PackageValidation:
    node_data = client.fetch_node(target)
    root_node = _find_root_node(node_data, target)
    targets = collect_export_targets(root_node)
    export_ids = _deduplicate_ids([target.node_id, *[item["id"] for item in targets]])
    image_urls, export_diagnostics = client.export_image_urls(
        target.file_key,
        export_ids,
        options.fmt,
        options.scale,
    )
    normalized_urls = {_colon_id(key): value for key, value in image_urls.items()}

    screenshot_name = f"screenshot.{options.fmt}"
    screenshot_url = normalized_urls.get(target.node_id)
    if not screenshot_url:
        raise ValueError(
            f"root screenshot is unavailable for node {target.node_id}"
        )
    try:
        client.download(screenshot_url, staging / screenshot_name)
    except Exception as error:
        raise ValueError(
            f"root screenshot download failed for node {target.node_id}"
        ) from error

    (staging / "assets").mkdir(parents=True, exist_ok=True)
    diagnostics = [_sanitize_diagnostic(item) for item in export_diagnostics]
    files: dict[str, dict[str, str]] = {}
    diagnosed_ids = {
        item.node_id for item in diagnostics if item.node_id is not None
    }
    for index, item in enumerate(targets, start=1):
        node_id = item["id"]
        url = normalized_urls.get(node_id)
        if not url:
            if node_id not in diagnosed_ids:
                diagnostics.append(
                    Diagnostic(
                        code="asset_export_failed",
                        message=f"Figma did not export an image for node {node_id}",
                        retryable=True,
                        node_id=node_id,
                    )
                )
                diagnosed_ids.add(node_id)
            continue

        filename = (
            f"{index:03d}_{_safe_name(item['name'])}_"
            f"{_dash_id(node_id)}.{options.fmt}"
        )
        relative_path = f"assets/{filename}"
        try:
            client.download(url, staging / relative_path)
        except Exception:
            diagnostics.append(
                Diagnostic(
                    code="asset_download_failed",
                    message=f"Failed to download exported asset for node {node_id}",
                    retryable=True,
                    node_id=node_id,
                )
            )
            continue

        files[node_id] = {
            "name": item["name"],
            "type": item["type"],
            "file": relative_path,
        }

    status = PackageStatus.PARTIAL if diagnostics else PackageStatus.COMPLETE
    root_name_value = root_node.get("name")
    root_type_value = root_node.get("type")
    root_name = root_name_value if isinstance(root_name_value, str) else "design"
    root_type = root_type_value if isinstance(root_type_value, str) else ""
    manifest = {
        "schemaVersion": 2,
        "source": {
            "url": _sanitize_source_url(source_url),
            "fileKey": target.file_key,
            "nodeId": target.node_id,
        },
        "root": {
            "name": root_name,
            "type": root_type,
            "totalNodes": _count_nodes(root_node),
        },
        "export": {"format": options.fmt, "scale": options.scale},
        "fingerprint": fingerprint,
        "status": status.value,
        "screenshot": screenshot_name,
        "files": files,
        "diagnostics": [asdict(item) for item in diagnostics],
    }
    _write_json(staging / "node.json", node_data)
    _write_json(staging / "manifest.json", manifest)
    (staging / "README.md").write_text(
        _render_readme(manifest),
        encoding="utf-8",
    )

    validation = validate_package(staging)
    if validation.status is PackageStatus.INVALID:
        raise ValueError("prepared package is invalid")
    return validation


def _matching_cache(
    destination: Path, fingerprint: str
) -> PackageValidation | None:
    validation = validate_package(destination)
    if validation.status is PackageStatus.INVALID:
        return None
    try:
        manifest = json.loads(
            (destination / "manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict) or manifest.get("fingerprint") != fingerprint:
        return None
    return validation


def _find_root_node(
    node_data: dict[str, Any], target: FigmaTarget
) -> dict[str, Any]:
    nodes = node_data.get("nodes") if isinstance(node_data, dict) else None
    if not isinstance(nodes, dict):
        raise ValueError("Figma node response is missing the nodes object")
    entry = nodes.get(target.node_id) or nodes.get(_dash_id(target.node_id))
    document = entry.get("document") if isinstance(entry, dict) else None
    if not isinstance(document, dict):
        raise ValueError(f"Figma node response is missing node {target.node_id}")
    return document


def _render_readme(manifest: dict[str, Any]) -> str:
    source = manifest["source"]
    root = manifest["root"]
    export = manifest["export"]
    files = manifest["files"]
    diagnostics = manifest["diagnostics"]
    screenshot = manifest["screenshot"]
    return (
        f"# {root['name']}\n\n"
        f"- **Source URL**: {source['url']}\n"
        f"- **fileKey**: `{source['fileKey']}`\n"
        f"- **nodeId**: `{source['nodeId']}`\n"
        f"- **Root type**: {root['type']}\n"
        f"- **Total nodes**: {root['totalNodes']}\n"
        f"- **Export format**: {export['format']} @ {export['scale']}x\n"
        f"- **Package status**: {manifest['status']}\n"
        f"- **Assets downloaded**: {len(files)}\n"
        f"- **Diagnostics**: {len(diagnostics)}\n\n"
        "## Files\n\n"
        "- `node.json` — Full Figma node tree and the structural source of truth.\n"
        f"- `{screenshot}` — Root-node screenshot and the visual source of truth.\n"
        "- `manifest.json` — Versioned package metadata and asset paths.\n"
        "- `assets/` — Exported image, vector, component, and instance assets.\n\n"
        "## Agent usage\n\n"
        f"1. Inspect `{screenshot}` first for visual truth.\n"
        "2. Read `node.json` only where exact structure or values are needed.\n"
        "3. Reuse files from `assets/` instead of signed Figma export URLs.\n"
    )


def _sanitize_source_url(source_url: str) -> str:
    parts = urlsplit(source_url)
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in _SENSITIVE_QUERY_KEYS
        ]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _sanitize_diagnostic(diagnostic: Diagnostic) -> Diagnostic:
    message = re.sub(r"https?://[^\s]+", "[REDACTED_URL]", diagnostic.message)
    message = re.sub(
        r"(?i)((?:access_)?token|authorization|secret)=([^&\s]+)",
        r"\1=[REDACTED]",
        message,
    )
    return Diagnostic(
        code=diagnostic.code,
        message=message,
        retryable=diagnostic.retryable,
        node_id=diagnostic.node_id,
    )


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _count_nodes(node: dict[str, Any]) -> int:
    children = node.get("children")
    if not isinstance(children, list):
        return 1
    return 1 + sum(
        _count_nodes(child) for child in children if isinstance(child, dict)
    )


def _deduplicate_ids(node_ids: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for node_id in node_ids:
        normalized = _colon_id(node_id)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _safe_name(value: str, max_length: int = 50) -> str:
    cleaned = re.sub(r"[^\w.-]+", "_", value or "").strip("_")
    return (cleaned or "untitled")[:max_length]


def _colon_id(node_id: str) -> str:
    return node_id.replace("-", ":")


def _dash_id(node_id: str) -> str:
    return node_id.replace(":", "-")
