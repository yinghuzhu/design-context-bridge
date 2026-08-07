#!/usr/bin/env python3
"""Figma Design Downloader.

Given a Figma URL, downloads:
  1. Full node tree JSON (structure, layout, text, styles)
  2. A full-page screenshot of the root node
  3. All image-bearing / vector / component assets used in the design

Usage:
  export FIGMA_TOKEN=fig_xxx
  python figma_download.py "https://www.figma.com/design/<fileKey>/<title>?node-id=<node-id>"

  # Or pass token explicitly:
  python figma_download.py URL -t fig_xxx -o ./output
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

FIGMA_API = "https://api.figma.com"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "downloads"

# Node types that are hard to recreate from vector data alone -> export as image.
EXPORT_NODE_TYPES = {"INSTANCE", "COMPONENT", "VECTOR", "BOOLEAN_OPERATION"}


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------
def parse_figma_url(url: str) -> tuple[str, str]:
    """Extract (fileKey, nodeId) from a Figma URL.

    Accepts both new (/design/...) and legacy (/file/...) formats.
    """
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]

    file_key = None
    for kind in ("design", "file", "proto"):
        if kind in parts:
            idx = parts.index(kind)
            if idx + 1 < len(parts):
                file_key = parts[idx + 1]
            break
    if not file_key:
        raise ValueError(f"Cannot find fileKey in URL: {url}")

    qs = parse_qs(parsed.query)
    node_id_raw = qs.get("node-id", [None])[0]
    if not node_id_raw:
        raise ValueError(f"URL missing ?node-id= query parameter: {url}")

    # URL form uses "-" (e.g. 1:2 -> 1-2), API uses ":"
    node_id = node_id_raw.replace("-", ":")
    return file_key, node_id


# ---------------------------------------------------------------------------
# Figma API calls
# ---------------------------------------------------------------------------
def _headers(token: str) -> dict:
    return {"X-Figma-Token": token}


def fetch_node(session: requests.Session, token: str, file_key: str, node_id: str) -> dict:
    """Fetch a node tree from Figma API."""
    url = f"{FIGMA_API}/v1/files/{file_key}/nodes"
    params = {"ids": node_id}
    r = session.get(url, headers=_headers(token), params=params, timeout=90)
    r.raise_for_status()
    return r.json()


def export_images(
    session: requests.Session,
    token: str,
    file_key: str,
    ids: list[str],
    fmt: str = "png",
    scale: int = 2,
) -> dict:
    """Export node ids to image URLs. Returns {node_id: url}.

    Figma API limits request URL length, so we batch. On a batch-level failure
    (e.g. one offending id), we fall back to per-id retry and skip the rejects.
    """
    result: dict[str, str] = {}
    batch_size = 40
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        url = f"{FIGMA_API}/v1/images/{file_key}"
        params = {
            "ids": ",".join(batch),
            "format": fmt,
            "scale": scale,
        }
        try:
            r = session.get(url, headers=_headers(token), params=params, timeout=120)
            r.raise_for_status()
            images = r.json().get("images", {}) or {}
            for nid, u in images.items():
                if u:
                    result[nid] = u
        except requests.HTTPError:
            # Batch failed (often a single offending id) -> retry one-by-one.
            print(f"      [warn] batch of {len(batch)} failed, retrying one-by-one ...")
            for nid in batch:
                try:
                    rr = session.get(
                        url,
                        headers=_headers(token),
                        params={"ids": nid, "format": fmt, "scale": scale},
                        timeout=60,
                    )
                    if rr.status_code != 200:
                        print(f"      [skip] {nid}: HTTP {rr.status_code}")
                        continue
                    u = (rr.json().get("images") or {}).get(nid)
                    if u:
                        result[nid] = u
                except Exception as e:
                    print(f"      [skip] {nid}: {e}")
        if i + batch_size < len(ids):
            time.sleep(0.3)  # gentle rate limit between batches
    return result


# ---------------------------------------------------------------------------
# Tree traversal
# ---------------------------------------------------------------------------
def collect_image_nodes(node: dict, acc: list[dict]):
    """Recursively collect nodes that should be exported as standalone images.

    Captures:
      - Nodes with IMAGE fills (bitmap assets)
      - VECTOR / BOOLEAN_OPERATION (complex paths)
      - COMPONENT / INSTANCE (reusable units)
    """
    node_type = node.get("type")
    fills = node.get("fills") or []
    has_image_fill = any(
        isinstance(f, dict) and f.get("type") == "IMAGE" for f in fills
    )

    # Skip nested-instance IDs like "I209:8007;2:351" - these target a child inside
    # an Instance and are rejected by /v1/images/. They are exported automatically
    # with their parent Instance node.
    if (has_image_fill or node_type in EXPORT_NODE_TYPES) and ";" not in node["id"]:
        acc.append({"id": node["id"], "name": node.get("name", ""), "type": node_type})

    for child in node.get("children") or []:
        collect_image_nodes(child, acc)


def count_nodes(node: dict, n: int = 0) -> int:
    n += 1
    for child in node.get("children") or []:
        n = count_nodes(child, n)
    return n


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------
def safe_name(s: str, max_len: int = 50) -> str:
    s = re.sub(r"[^\w\-.]+", "_", s or "").strip("_")
    return (s or "untitled")[:max_len]


def download_file(session: requests.Session, url: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with session.get(url, stream=True, timeout=180) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="Download Figma node JSON + all images.")
    ap.add_argument("url", help="Figma design URL (must contain ?node-id=...)")
    ap.add_argument(
        "-o",
        "--out",
        default=str(DEFAULT_OUT),
        help=f"Output directory (default: {DEFAULT_OUT})",
    )
    ap.add_argument(
        "-t",
        "--token",
        default=os.environ.get("FIGMA_TOKEN"),
        help="Figma personal access token (or set FIGMA_TOKEN env var)",
    )
    ap.add_argument(
        "--scale", type=int, default=2, help="Export scale for raster images (default 2)"
    )
    ap.add_argument(
        "--format",
        default="png",
        choices=["png", "jpg", "svg"],
        help="Export format (default png)",
    )
    ap.add_argument(
        "--no-screenshot",
        action="store_true",
        help="Skip downloading the full-page root screenshot",
    )
    args = ap.parse_args()

    if not args.token:
        sys.exit(
            "Error: Figma token required. Set $FIGMA_TOKEN or pass -t <token>."
        )

    try:
        file_key, node_id = parse_figma_url(args.url)
    except ValueError as e:
        sys.exit(str(e))

    # Figma API accepts both ":" and "-" forms; use "-" for safety
    api_node_id = node_id.replace(":", "-")
    out_dir = Path(args.out) / f"{file_key}_{api_node_id}"
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] fileKey = {file_key}")
    print(f"[INFO] nodeId  = {node_id}")
    print(f"[INFO] output  = {out_dir}")

    session = requests.Session()

    # 1. Fetch node tree ----------------------------------------------------
    print("[1/4] Fetching node tree from Figma API ...")
    try:
        data = fetch_node(session, args.token, file_key, node_id)
    except requests.HTTPError as e:
        msg = ""
        try:
            msg = e.response.text
        except Exception:
            pass
        sys.exit(f"Error: Figma API call failed: {e}\n{msg}")

    nodes_field = data.get("nodes", {})
    node_entry = nodes_field.get(node_id) or nodes_field.get(api_node_id)
    if not node_entry:
        sys.exit(f"Error: node '{node_id}' not found in API response.")
    root_node = node_entry["document"]
    root_name = safe_name(root_node.get("name", "design"))

    (out_dir / "node.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total_nodes = count_nodes(root_node)
    print(f"      Root: {root_node.get('type')} '{root_name}' ({total_nodes} nodes)")

    # 2. Collect image nodes ------------------------------------------------
    print("[2/4] Scanning tree for image / vector / component nodes ...")
    targets: list[dict] = []
    collect_image_nodes(root_node, targets)
    # Dedup by id, preserve order
    seen = set()
    unique_targets = []
    for t in targets:
        if t["id"] not in seen:
            seen.add(t["id"])
            unique_targets.append(t)
    print(f"      Found {len(unique_targets)} exportable nodes.")

    # 3. Export + download --------------------------------------------------
    all_ids = [t["id"].replace(":", "-") for t in unique_targets]
    # Always add root node for full-page screenshot.
    # NOTE: store the colon-form id in unique_targets so lookups against the
    # Figma API response (which uses colon-form keys) succeed.
    if api_node_id not in all_ids:
        all_ids.insert(0, api_node_id)
        unique_targets.insert(0, {"id": node_id, "name": root_name, "type": "ROOT"})

    print(f"[3/4] Exporting {len(all_ids)} nodes as {args.format} (scale={args.scale}) ...")
    images = export_images(
        session, args.token, file_key, all_ids, fmt=args.format, scale=args.scale
    )

    manifest = {
        "source": args.url,
        "fileKey": file_key,
        "nodeId": node_id,
        "rootName": root_name,
        "rootType": root_node.get("type"),
        "totalNodes": total_nodes,
        "format": args.format,
        "scale": args.scale,
        "files": {},
    }

    ok, fail = 0, 0
    for i, t in enumerate(unique_targets, 1):
        nid_dash = t["id"].replace(":", "-")
        url = images.get(nid_dash) or images.get(t["id"])
        if not url:
            print(f"      [{i:>3}/{len(unique_targets)}] SKIP  {t['type']:<10} {t['name']!r} (no url)")
            fail += 1
            continue
        slug = safe_name(t["name"]) or "node"
        fname = f"{i:03d}_{slug}_{nid_dash}.{args.format}"
        dest = assets_dir / fname
        try:
            download_file(session, url, dest)
            manifest["files"][t["id"]] = {
                "name": t["name"],
                "type": t["type"],
                "file": f"assets/{fname}",
                "url": url,
            }
            ok += 1
            print(f"      [{i:>3}/{len(unique_targets)}] OK    {t['type']:<10} {fname}")
        except Exception as e:
            print(f"      [{i:>3}/{len(unique_targets)}] FAIL  {t['name']!r}: {e}")
            fail += 1
        time.sleep(0.05)

    # 4. Root screenshot ----------------------------------------------------
    print("[4/4] Saving root screenshot + manifest ...")
    if not args.no_screenshot:
        root_url = images.get(api_node_id) or images.get(node_id)
        if root_url:
            root_dest = out_dir / "screenshot.png"
            try:
                download_file(session, root_url, root_dest)
                manifest["screenshot"] = "screenshot.png"
                print(f"      screenshot.png ({root_dest.stat().st_size // 1024} KB)")
            except Exception as e:
                print(f"      [!] screenshot failed: {e}")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 5. README -------------------------------------------------------------
    (out_dir / "README.md").write_text(
        f"# {root_name}\n\n"
        f"- **Source URL**: {args.url}\n"
        f"- **fileKey**: `{file_key}`\n"
        f"- **nodeId**: `{node_id}`\n"
        f"- **Root type**: {root_node.get('type')}\n"
        f"- **Total nodes**: {total_nodes}\n"
        f"- **Export format**: {args.format} @ {args.scale}x\n"
        f"- **Assets downloaded**: {ok} ok / {fail} failed\n\n"
        "## Files\n\n"
        "- `node.json` — Full Figma node tree (layout, text, colors, styles). Source of truth for structure.\n"
        "- `screenshot.png` — Full-page raster of the root node. Golden reference for visual QA.\n"
        "- `manifest.json` — Maps node id -> asset file path.\n"
        "- `assets/` — Exported images (image fills, icons, vectors, components).\n\n"
        "## Restore a design from this package\n\n"
        "1. Read `node.json` for layout/text/style structure.\n"
        "2. Use `screenshot.png` as the visual reference.\n"
        "3. Swap in `assets/` images where nodes have IMAGE fills.\n",
        encoding="utf-8",
    )

    print()
    print(f"[DONE] {ok}/{len(unique_targets)} assets downloaded")
    print(f"        output dir: {out_dir}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
