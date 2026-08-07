#!/usr/bin/env python3
"""Compatibility entry point for preparing a Figma context package."""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections.abc import Sequence
from pathlib import Path

import requests


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from figma_context_bridge.client import FigmaClient  # noqa: E402
from figma_context_bridge.downloader import (  # noqa: E402
    PrepareOptions,
    prepare_package,
)
from figma_context_bridge.models import PackageStatus  # noqa: E402
from figma_context_bridge.url import parse_figma_url as _parse_figma_url  # noqa: E402


DEFAULT_OUT = PROJECT_ROOT / "downloads"


def parse_figma_url(url: str) -> tuple[str, str]:
    """Preserve the tuple-returning helper used by the legacy pipeline."""
    target = _parse_figma_url(url)
    return target.file_key, target.node_id


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download a Figma node into a versioned context package."
    )
    parser.add_argument(
        "url",
        help="Figma design URL (must contain ?node-id=...)",
    )
    parser.add_argument(
        "-o",
        "--out",
        default=str(DEFAULT_OUT),
        help=f"Output directory (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "-t",
        "--token",
        default=os.environ.get("FIGMA_TOKEN"),
        help="Figma personal access token (or set FIGMA_TOKEN env var)",
    )
    parser.add_argument(
        "--scale",
        type=int,
        default=2,
        help="Export scale for raster images (default 2)",
    )
    parser.add_argument(
        "--format",
        default="png",
        choices=["png", "jpg", "svg"],
        help="Export format (default png)",
    )
    parser.add_argument(
        "--no-screenshot",
        action="store_true",
        help=(
            "Deprecated compatibility flag; schema v2 packages always keep "
            "the root screenshot"
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Compatibility flag; the legacy downloader always refreshes",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.token:
        print(
            "Error: Figma token required. Set FIGMA_TOKEN or pass -t <token>.",
            file=sys.stderr,
        )
        return 1

    if args.no_screenshot:
        print(
            "[WARN] --no-screenshot is deprecated; schema v2 requires the "
            "root screenshot, so it will still be stored.",
            file=sys.stderr,
        )

    try:
        result = prepare_package(
            args.url,
            FigmaClient(args.token),
            PrepareOptions(
                output_root=Path(args.out),
                fmt=args.format,
                scale=args.scale,
                # The old downloader always contacted Figma. Preserve that
                # behavior here; Task 8's unified CLI owns opt-in cache reuse.
                force=True,
            ),
        )
    except requests.RequestException as error:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
        suffix = f" (HTTP {status_code})" if status_code is not None else ""
        print(f"Error: Figma API request failed{suffix}.", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(
            f"Error: {_redact_message(str(error), args.token)}",
            file=sys.stderr,
        )
        return 1
    except Exception as error:
        print(
            f"Error: download failed ({type(error).__name__}).",
            file=sys.stderr,
        )
        return 1

    source = "cache" if result.cache_hit else "download"
    print(f"[DONE] package status: {result.validation.status.value} ({source})")
    print(f"       output dir: {result.package_dir}")
    if result.validation.status is PackageStatus.PARTIAL:
        print("[WARN] Some non-critical assets are unavailable:", file=sys.stderr)
        for diagnostic in result.validation.diagnostics:
            node = f" [{diagnostic.node_id}]" if diagnostic.node_id else ""
            print(
                f"  - {diagnostic.code}{node}: {diagnostic.message}",
                file=sys.stderr,
            )
    return 0


def _redact_message(message: str, token: str) -> str:
    if token:
        message = message.replace(token, "[REDACTED]")
    return re.sub(
        r"(?i)((?:access_)?token|authorization|secret)=([^&\s]+)",
        r"\1=[REDACTED]",
        message,
    )


if __name__ == "__main__":
    raise SystemExit(main())
