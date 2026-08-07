#!/usr/bin/env python3
"""Figma pipeline orchestrator: download + render in one command.

Smart caching: if the asset package for a URL already exists, skips the
Figma API call and just re-renders the HTML. Use --force to bypass cache.

Usage:
  python figma_pipeline.py URL                  # download (if needed) + render + open browser
  python figma_pipeline.py URL --force          # always re-download
  python figma_pipeline.py URL --no-open        # don't open browser
  python figma_pipeline.py URL -o ./my-out      # custom output root
  python figma_pipeline.py URL --format svg     # export as SVG (zero loss for vectors)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser(
        description="One-shot Figma URL -> HTML. Caches the asset package locally."
    )
    ap.add_argument("url", help="Figma design URL (must contain ?node-id=...)")
    ap.add_argument("-o", "--out", default=str(SCRIPT_DIR.parent / "downloads"), help="Output root dir")
    ap.add_argument("-t", "--token", default=os.environ.get("FIGMA_TOKEN"), help="Figma token (or $FIGMA_TOKEN)")
    ap.add_argument("-f", "--force", action="store_true", help="Re-download even if cached")
    ap.add_argument("--no-open", action="store_true", help="Do not auto-open the browser")
    ap.add_argument("--no-compare", action="store_true", help="Skip generating compare.html (original screenshot side-by-side)")
    ap.add_argument("--scale", type=int, default=2, help="Export scale (default 2)")
    ap.add_argument("--format", default="png", choices=["png", "jpg", "svg"], help="Export format")
    args = ap.parse_args()

    # Reuse URL parser from the download module
    sys.path.insert(0, str(SCRIPT_DIR))
    from figma_download import parse_figma_url

    try:
        file_key, node_id = parse_figma_url(args.url)
    except ValueError as e:
        sys.exit(str(e))

    pkg = Path(args.out) / f"{file_key}_{node_id.replace(':', '-')}"
    py = sys.executable
    download_script = SCRIPT_DIR / "figma_download.py"
    render_script = SCRIPT_DIR / "render_html.py"

    # 1. Download (with cache) -------------------------------------------------
    if (pkg / "node.json").exists() and not args.force:
        print(f"[pipeline] Using cached package: {pkg}")
        print("           (pass --force to re-download from Figma)")
    else:
        if not args.token:
            sys.exit("Error: Figma token required. Set $FIGMA_TOKEN or pass -t.")
        print("[pipeline] Downloading from Figma API ...")
        cmd = [
            py, str(download_script), args.url,
            "-o", args.out,
            "--scale", str(args.scale),
            "--format", args.format,
            "-t", args.token,
        ]
        rc = subprocess.run(cmd).returncode
        if rc != 0:
            sys.exit(rc)

    # 2. Render ---------------------------------------------------------------
    print("[pipeline] Rendering HTML ...")
    render_cmd = [py, str(render_script), str(pkg)]
    if not args.no_compare:
        render_cmd.append("--compare")
    rc = subprocess.run(render_cmd).returncode
    if rc != 0:
        sys.exit(rc)

    # 3. Open browser ---------------------------------------------------------
    html_path = pkg / "reconstruct.html"
    if not args.no_open:
        print(f"[pipeline] Opening browser: {html_path.name}")
        if sys.platform == "darwin":
            subprocess.run(["open", str(html_path)])
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", str(html_path)])
        elif sys.platform == "win32":
            subprocess.run(["start", "", str(html_path)], shell=True)

    print(f"\n[DONE] {html_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
