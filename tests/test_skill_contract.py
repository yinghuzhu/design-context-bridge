from pathlib import Path


SKILL_DIR = Path("skills/figma-replicate")
SKILL = SKILL_DIR / "SKILL.md"
OPENAI_YAML = SKILL_DIR / "agents/openai.yaml"


def _frontmatter_lines(text: str) -> list[str]:
    assert text.startswith("---\n")
    _, frontmatter, _ = text.split("---", 2)
    return [line for line in frontmatter.strip().splitlines() if line.strip()]


def test_skill_has_portable_frontmatter() -> None:
    text = SKILL.read_text(encoding="utf-8")
    lines = _frontmatter_lines(text)
    assert lines[0] == "name: figma-replicate"
    assert lines[1].startswith("description:")
    assert len(lines) == 2


def test_skill_description_supports_explicit_and_implicit_triggers() -> None:
    text = SKILL.read_text(encoding="utf-8")
    description = _frontmatter_lines(text)[1]
    assert "Figma URL" in description
    assert "新项目" in description
    assert "迁移已有前端页面" in description
    assert "多模态视觉复刻" in description


def test_openai_metadata_is_minimal_and_quoted() -> None:
    lines = OPENAI_YAML.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "interface:"
    assert [line.strip().split(":", 1)[0] for line in lines[1:]] == [
        "display_name",
        "short_description",
        "default_prompt",
    ]
    assert all(line.split(":", 1)[1].strip().startswith('"') for line in lines[1:])
    assert all(line.rstrip().endswith('"') for line in lines[1:])
    assert "$figma-replicate" in lines[-1]
    assert "dependencies:" not in lines
    assert "mcp" not in OPENAI_YAML.read_text(encoding="utf-8").lower()


def test_skill_enforces_multimodal_and_required_inputs() -> None:
    text = SKILL.read_text(encoding="utf-8")
    assert "多模态" in text
    assert "目标页面" in text
    assert "Figma URL" in text
    assert "新版参考" in text
    assert "受保护业务行为" in text
    assert "不得开始仓库分析或修改" in text


def test_skill_routes_to_every_reference() -> None:
    text = SKILL.read_text(encoding="utf-8")
    names = (
        "input-contract.md",
        "context-package.md",
        "migration.md",
        "browser-auth.md",
        "validation.md",
    )
    assert all(f"references/{name}" in text for name in names)


def test_skill_preserves_separation_and_completion_gates() -> None:
    text = SKILL.read_text(encoding="utf-8")
    assert "禁止扫描整个仓库" in text
    assert "CLI 不负责视觉判断" in text
    assert "工具验证通过后才通知人工验收" in text
    assert "交互" in text
    assert "业务流程" in text


def test_source_priority_uses_manifest_screenshot_path() -> None:
    text = SKILL.read_text(encoding="utf-8")
    source_priority = text.split("## Source priority", 1)[1].split("## Prohibitions", 1)[0]
    assert "manifest" in source_priority
    assert "screenshot 路径" in source_priority
    assert "通常是 `screenshot.png`" in source_priority


def test_input_contract_requires_scope_before_repository_work() -> None:
    text = (SKILL_DIR / "references/input-contract.md").read_text(encoding="utf-8")
    assert "Figma URL" in text
    assert "target directory" in text
    assert "target page/route" in text
    assert "approved completed new references" in text
    assert "initial" in text and "明确为空" in text
    assert "protected business behavior" in text
    assert "输入缺失" in text and "不得扫描或修改" in text


def test_input_contract_forbids_unbounded_discovery() -> None:
    text = (SKILL_DIR / "references/input-contract.md").read_text(encoding="utf-8")
    roles = ("target", "approved_reference", "legacy_behavior_source", "protected", "unknown")
    assert all(f"`{role}`" in text for role in roles)
    assert "只有前四类可以影响实现" in text
    assert "unknown" in text and "澄清或忽略" in text
    assert "named routes/files" in text
    assert "direct components" in text
    assert "approved refs" in text
    assert "reusable direct dependencies" in text
    assert "API/store/validation/tests" in text
    assert "禁止默认遍历全部页面、完整组件库或全部 Git 历史" in text
    assert "信息满足当前迁移后立即停止" in text
    assert "具体文件和组件映射" in text and "供确认" in text
