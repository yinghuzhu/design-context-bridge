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


def test_context_reference_uses_json_and_package_statuses() -> None:
    text = (SKILL_DIR / "references/context-package.md").read_text(
        encoding="utf-8"
    )
    assert "figma-context prepare" in text
    assert "figma-context validate-package" in text
    assert "figma-context inspect" in text
    assert all(status in text for status in ("complete", "partial", "invalid"))
    assert "FIGMA_TOKEN" in text
    assert "signed asset URL" in text


def test_context_reference_defines_safe_agent_command_order() -> None:
    text = (SKILL_DIR / "references/context-package.md").read_text(
        encoding="utf-8"
    )
    command_section = text.split("## 命令顺序", 1)[1].split("## 包状态门禁", 1)[0]
    prepare = command_section.index("figma-context prepare")
    validate = command_section.index("figma-context validate-package")
    inspect = command_section.index("figma-context inspect")
    render = command_section.index("figma-context render")
    assert prepare < validate < inspect < render
    assert command_section.count("--json") >= 4
    assert "--token" not in command_section
    assert "禁止使用 `--token`" in text
    assert "data.packageDir" in text
    assert "status" in text
    assert "可信输入" in text
    assert "正确引用" in text


def test_context_reference_enforces_status_and_source_gates() -> None:
    text = (SKILL_DIR / "references/context-package.md").read_text(
        encoding="utf-8"
    )
    assert "retryable" in text and "--force" in text
    assert "缺失资产不阻止实现" in text
    assert "视觉验证仍然是强制门禁" in text
    assert "修改目标项目之前停止" in text
    assert "根截图" in text and "结构" in text
    source_order = text.split("## 读取顺序", 1)[1].split("## 安全与能力边界", 1)[0]
    positions = [
        source_order.index(name)
        for name in (
            "AI_CONTEXT.md",
            "manifest",
            "relevant nodes",
            "assets/",
            "styles.json",
            "components.json",
        )
    ]
    assert positions == sorted(positions)
    assert "完整 `node.json`" in text
    assert "原始图片 bytes" in text
    assert "signed asset URL" in text
    assert "CLI 不具备图片识别能力" in text


def test_migration_reference_requires_modes_and_user_approval() -> None:
    text = (SKILL_DIR / "references/migration.md").read_text(encoding="utf-8")
    assert all(
        f"`{mode}`" in text
        for mode in ("new", "initial", "continuation", "adoption")
    )
    assert "approvedByUser" in text
    assert "新会话不等于新迁移" in text
    assert "figma-context migration validate" in text
    assert "项目说明" in text and "用户裁决" in text
    assert "密码" in text and "Token" in text and "Cookie" in text


def test_migration_reference_defines_fact_based_state_transitions() -> None:
    text = (SKILL_DIR / "references/migration.md").read_text(encoding="utf-8")
    assert "approved_reference" in text and "approvedByUser" in text
    assert "implemented" in text
    assert "validated" in text
    assert "visualEvidence" in text and "businessEvidence" in text
    assert "schemaVersion" in text and "schema v1" in text
    assert "不得自动判定" in text


def test_migration_examples_are_bounded_and_complete() -> None:
    example_names = ("initial-migration", "continuation", "adoption")
    required_sections = (
        "## User prompt",
        "## Accepted mapping",
        "## Allowed files",
        "## Forbidden scope expansion",
        "## State changes",
        "## Evidence",
        "## Expected final report",
    )

    for name in example_names:
        text = (SKILL_DIR / f"examples/{name}.md").read_text(encoding="utf-8")
        assert all(section in text for section in required_sections)

    initial = (SKILL_DIR / "examples/initial-migration.md").read_text(
        encoding="utf-8"
    )
    assert "approvedReferences" in initial and "[]" in initial

    adoption = (SKILL_DIR / "examples/adoption.md").read_text(encoding="utf-8")
    assert "/checkout" in adoption and "approved_reference" in adoption
    assert "/payment/result" in adoption and "target" in adoption
    assert "支付 API" in adoption and "订单状态轮询" in adoption
    assert "不检查无关页面" in adoption
