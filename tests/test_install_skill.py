from pathlib import Path

import pytest

from scripts import install_skill as installer


def make_source(root: Path) -> Path:
    source = root / "source"
    for directory in ("references", "examples", "agents"):
        (source / directory).mkdir(parents=True, exist_ok=True)
    (source / "SKILL.md").write_text("---\nname: figma-replicate\n---\n", encoding="utf-8")
    (source / "references/rules.md").write_text("rules", encoding="utf-8")
    (source / "examples/new-page.md").write_text("example", encoding="utf-8")
    (source / "agents/openai.yaml").write_text("interface: {}\n", encoding="utf-8")
    return source


def test_install_both_creates_client_links(tmp_path: Path) -> None:
    source = make_source(tmp_path)
    home = tmp_path / "home"

    installed = installer.install_skill(source, home, ("codex", "claude"), copy=False)

    assert installed == [
        home / ".agents/skills/figma-replicate",
        home / ".claude/skills/figma-replicate",
    ]
    assert all(path.is_symlink() for path in installed)
    assert all(path.readlink() == source.resolve() for path in installed)


def test_copy_mode_copies_complete_skill_tree(tmp_path: Path) -> None:
    source = make_source(tmp_path)

    installed = installer.install_skill(source, tmp_path / "home", ("codex",), copy=True)

    destination = installed[0]
    assert not destination.is_symlink()
    assert (destination / "references/rules.md").read_text(encoding="utf-8") == "rules"
    assert (destination / "examples/new-page.md").read_text(encoding="utf-8") == "example"
    assert (destination / "agents/openai.yaml").read_text(encoding="utf-8") == "interface: {}\n"


def test_install_both_preflights_all_destinations(tmp_path: Path) -> None:
    source = make_source(tmp_path)
    home = tmp_path / "home"
    existing = home / ".claude/skills/figma-replicate"
    existing.mkdir(parents=True)
    marker = existing / "owned-by-user"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(FileExistsError, match="figma-replicate"):
        installer.install_skill(source, home, ("codex", "claude"), copy=False)

    assert not (home / ".agents/skills/figma-replicate").exists()
    assert marker.read_text(encoding="utf-8") == "keep"


def test_broken_destination_symlink_is_never_overwritten(tmp_path: Path) -> None:
    source = make_source(tmp_path)
    home = tmp_path / "home"
    destination = home / ".agents/skills/figma-replicate"
    destination.parent.mkdir(parents=True)
    missing_target = tmp_path / "missing-skill"
    destination.symlink_to(missing_target, target_is_directory=True)

    with pytest.raises(FileExistsError, match="figma-replicate"):
        installer.install_skill(source, home, ("codex",), copy=False)

    assert destination.is_symlink()
    assert destination.readlink() == missing_target


def test_install_validates_source_and_clients(tmp_path: Path) -> None:
    source = make_source(tmp_path)

    with pytest.raises(ValueError, match="Missing SKILL.md"):
        installer.install_skill(tmp_path / "missing", tmp_path / "home", ("codex",), copy=False)
    with pytest.raises(ValueError, match="at least one client"):
        installer.install_skill(source, tmp_path / "home", (), copy=False)
    with pytest.raises(ValueError, match="Unsupported client"):
        installer.install_skill(source, tmp_path / "home", ("cursor",), copy=False)


def test_execution_failure_rolls_back_only_paths_created_by_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = make_source(tmp_path)
    home = tmp_path / "home"
    original_copytree = installer.shutil.copytree
    claude_destination = home / ".claude/skills/figma-replicate"

    def fail_second_copy(src: Path, dst: Path, *args: object, **kwargs: object) -> Path:
        if Path(dst) == claude_destination:
            raise OSError("simulated copy failure")
        return original_copytree(src, dst, *args, **kwargs)

    monkeypatch.setattr(installer.shutil, "copytree", fail_second_copy)

    with pytest.raises(OSError, match="simulated copy failure"):
        installer.install_skill(source, home, ("codex", "claude"), copy=True)

    assert not (home / ".agents/skills/figma-replicate").exists()
    assert not (home / ".claude/skills/figma-replicate").exists()


def test_cli_parses_options_and_installs_requested_client(tmp_path: Path) -> None:
    source = make_source(tmp_path)
    home = tmp_path / "home"

    result = installer.main(
        [
            "--client",
            "claude",
            "--copy",
            "--home",
            str(home),
            "--source",
            str(source),
        ]
    )

    assert result == 0
    destination = home / ".claude/skills/figma-replicate"
    assert (destination / "SKILL.md").is_file()
    assert not (home / ".agents/skills/figma-replicate").exists()
