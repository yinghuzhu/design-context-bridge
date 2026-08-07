#!/usr/bin/env python3
"""Compatibility entry point for rendering a Figma context package."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from figma_context_bridge.renderer import (  # noqa: E402
    PackageRenderError,
    render_package,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render a figma-context-bridge package to HTML."
    )
    parser.add_argument(
        "package_dir",
        help="Path to the downloads/<fileKey>_<nodeId>/ directory",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output HTML path (default: <pkg>/reconstruct.html)",
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Also write compare.html with the original screenshot",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    package_dir = Path(args.package_dir)
    if not package_dir.is_dir():
        print(f"Not a directory: {package_dir.resolve()}", file=sys.stderr)
        return 1

    try:
        result = render_package(
            package_dir,
            output=Path(args.output) if args.output else None,
            compare=args.compare,
        )
    except (PackageRenderError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(
        f"[OK] {result.html_path}  "
        f"({result.width}x{result.height})"
    )
    if result.compare_path is not None:
        print(f"[OK] {result.compare_path}  (side-by-side comparison)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
