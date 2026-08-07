#!/usr/bin/env python3
"""Install the bundled figma-replicate skill for supported coding agents."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from typing import Sequence


CLIENT_PATHS = {
    "codex": Path(".agents/skills/figma-replicate"),
    "claude": Path(".claude/skills/figma-replicate"),
}


def _path_exists(path: Path) -> bool:
    """Return True for regular paths and broken symbolic links."""

    return path.exists() or path.is_symlink()


def _remove_created(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def install_skill(
    source: Path,
    home: Path,
    clients: tuple[str, ...],
    copy: bool,
) -> list[Path]:
    """Install a skill without overwriting any existing destination."""

    source = Path(source)
    home = Path(home)
    if not source.is_dir() or not (source / "SKILL.md").is_file():
        raise ValueError(f"Missing SKILL.md: {source}")
    if not clients:
        raise ValueError("Specify at least one client")

    unknown = tuple(client for client in clients if client not in CLIENT_PATHS)
    if unknown:
        raise ValueError(f"Unsupported client: {unknown[0]}")
    if len(set(clients)) != len(clients):
        raise ValueError("Duplicate clients are not supported")

    destinations = [home / CLIENT_PATHS[client] for client in clients]

    # Preflight every destination before making the first installation. This
    # keeps `both` from leaving one client installed when the other conflicts.
    for destination in destinations:
        if _path_exists(destination):
            raise FileExistsError(destination)

    created: list[Path] = []
    try:
        for destination in destinations:
            destination.parent.mkdir(parents=True, exist_ok=True)

            # Repeat the check immediately before the atomic create so a path
            # introduced after preflight is never treated as ours.
            if _path_exists(destination):
                raise FileExistsError(destination)

            if copy:
                # Reserve the destination first. If copying later fails, the
                # rollback knows this exact directory was created by this call.
                destination.mkdir()
                created.append(destination)
                shutil.copytree(
                    source,
                    destination,
                    dirs_exist_ok=True,
                    symlinks=True,
                )
            else:
                destination.symlink_to(source.resolve(), target_is_directory=True)
                created.append(destination)
    except BaseException:
        for destination in reversed(created):
            try:
                _remove_created(destination)
            except OSError:
                # Preserve the original installation error while making a
                # best-effort rollback of only paths created by this call.
                pass
        raise

    return destinations


def default_source() -> Path:
    return Path(__file__).resolve().parents[1] / "skills/figma-replicate"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install the figma-replicate skill for Codex, Claude Code, or both."
    )
    parser.add_argument(
        "--client",
        choices=("codex", "claude", "both"),
        default="both",
        help="target client (default: both)",
    )
    parser.add_argument(
        "--copy",
        action="store_true",
        help="copy the complete skill tree instead of creating an absolute symlink",
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="home directory containing client configuration (default: Path.home())",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=default_source(),
        help="source skill directory (default: repository skills/figma-replicate)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    clients = ("codex", "claude") if args.client == "both" else (args.client,)
    installed = install_skill(args.source, args.home, clients, copy=args.copy)
    for destination in installed:
        print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
