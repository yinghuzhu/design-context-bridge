import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SKILL = join(import.meta.dirname, '..', 'skills', 'design-replicate');

async function text(path: string): Promise<string> {
  return readFile(join(SKILL, path), 'utf8');
}

describe('design-replicate Skill contract', () => {
  it('has valid generic metadata and bounded core workflow', async () => {
    const skill = await text('SKILL.md');

    expect(skill).toMatch(/^---\nname: design-replicate\ndescription: .+\n---/u);
    expect(skill).toContain('多模态');
    expect(skill).toContain('design-platform URL');
    expect(skill).toContain('target repository');
    expect(skill).toContain('target page/route');
    expect(skill).toContain('approved reference');
    expect(skill).toContain('protected business behavior');
    expect(skill).toContain('design-context workspace resolve');
    expect(skill).toContain('外部 workspace');
    expect(skill).toContain('design-context prepare');
    expect(skill).toContain('design_scope_suspicious');
    expect(skill).toContain('读取或修改目标仓库前');
    expect(skill).toContain('只阻塞当前 unit');
    expect(skill).toContain('Playwright MCP');
    expect(skill).toContain('不得扫描整个仓库');
    expect(skill).toContain('视觉通过但业务失败');
    expect(skill).toContain('git diff --cached --name-only');
    expect(skill).toContain('不得执行 `git add -A`');
    expect(skill.split('\n').length).toBeLessThan(500);
  });

  it('routes all one-level references and examples', async () => {
    const skill = await text('SKILL.md');
    const references = (await readdir(join(SKILL, 'references'))).filter((name) => name.endsWith('.md'));
    const examples = (await readdir(join(SKILL, 'examples'))).filter((name) => name.endsWith('.md'));

    expect(references.sort()).toEqual(['browser-auth.md', 'context-package.md', 'input-contract.md', 'migration.md', 'validation.md']);
    expect(examples.sort()).toEqual(['adoption.md', 'continuation.md', 'initial-migration.md', 'new-page.md']);
    for (const filename of [...references.map((name) => `references/${name}`), ...examples.map((name) => `examples/${name}`)]) expect(skill).toContain(filename);
  });

  it('defines provider-aware credentials and deterministic package gates', async () => {
    const context = await text('references/context-package.md');

    expect(context).toContain('design-context prepare');
    expect(context).toContain('design-context validate-package');
    expect(context).toContain('complete');
    expect(context).toContain('partial');
    expect(context).toContain('invalid');
    expect(context).toContain('adapter');
    expect(context).toContain('FIGMA_TOKEN');
    expect(context).toContain('design.json');
    expect(context).toContain('signed asset URL');
    expect(context).toContain('CLI 不具备图片识别能力');
    expect(context).toContain('--refresh');
    expect(context).toContain('--target "$TARGET_DIR"');
    expect(context).toContain('storageScope');
    expect(context).toContain('--allow-in-repo');
    expect(context).toContain('design_scope_suspicious');
    expect(context).toContain('retryable: false');
    expect(context).toContain('不得使用 `--refresh`');
    expect(context).toContain('Frame、Group、Section 或 Component');
  });

  it('requires explicit inputs and forbids unbounded repository discovery', async () => {
    const input = await text('references/input-contract.md');

    for (const phrase of ['design-platform URL', 'target directory', 'target page/route', 'approved completed new references', 'protected business behavior']) expect(input).toContain(phrase);
    for (const role of ['target', 'approved_reference', 'legacy_behavior_source', 'protected', 'unknown']) expect(input).toContain(`\`${role}\``);
    expect(input).toContain('输入缺失');
    expect(input).toContain('不得扫描或修改');
    expect(input).toContain('禁止默认遍历全部页面、完整组件库或全部 Git 历史');
    expect(input).toContain('外部 migration state');
    expect(input).toContain('设计范围');
    expect(input).toContain('所选内容的链接');
  });

  it('covers migration modes, auth fallback, and visual plus business gates', async () => {
    const migration = await text('references/migration.md');
    const browser = await text('references/browser-auth.md');
    const validation = await text('references/validation.md');

    for (const mode of ['new', 'initial', 'continuation', 'adoption']) expect(migration).toContain(`\`${mode}\``);
    expect(migration).toContain('新会话不等于新迁移');
    expect(migration).toContain('design-context workspace resolve');
    expect(migration).toContain('DESIGN_CONTEXT_STATE_HOME');
    expect(migration).toContain('DESIGN_CONTEXT_CACHE_HOME');
    expect(migration).toContain('migration import');
    expect(migration).toContain('visualEvidence');
    expect(migration).toContain('businessEvidence');
    expect(migration).toContain('packagesDirectory');
    expect(migration).toContain('evidenceDirectory');
    expect(migration).toContain('不得自动修改目标项目的 `.gitignore`');
    expect(migration).toContain('design-context-bridge/workspace-id');
    expect(migration).toContain('identitySource');
    expect(migration).toContain('path-hash');
    expect(migration).toContain('非 Git');
    expect(migration).toContain('目录改名');
    expect(browser.indexOf('当前 Agent')).toBeLessThan(browser.indexOf('Playwright MCP'));
    expect(browser).toMatch(/MFA|CAPTCHA/);
    expect(browser).toContain('不得索要');
    expect(validation).toContain('原稿截图');
    expect(validation).toContain('实际截图');
    expect(validation).toContain('高、中优先级');
    expect(validation).toContain('可能影响交互或已有业务流程');
    expect(validation).toContain('必须验证');
    expect(validation).toContain('视觉通过但业务失败');
    expect(validation).toContain('人工验收');
    expect(validation).toContain('用户描述');
    expect(validation).toContain('读取或修改目标仓库前');
    expect(validation).toContain('不得静默选择父节点、兄弟节点');
    expect(validation).toContain('只阻塞引用该设计来源的当前 unit');
    for (const generated of ['.design-context/', 'playwright-report/', 'test-results/', 'coverage/', '原始 JSON', '临时证据']) expect(validation).toContain(generated);
    expect(validation).toContain('git diff --cached --name-only');
    expect(validation).toContain('停止提交');
  });

  it('keeps default generated state and assets outside the target repository', async () => {
    const skill = await text('SKILL.md');
    const examples = (await readdir(join(SKILL, 'examples'))).filter((name) => name.endsWith('.md'));
    const exampleText = (await Promise.all(examples.map((name) => text(`examples/${name}`)))).join('\n');

    expect(skill).not.toContain('更新 `.design-context/migration.json`');
    expect(exampleText).not.toContain('建立 `.design-context/migration.json`');
    expect(exampleText).not.toContain('初始化 `.design-context/migration.json`');
  });

  it('contains no active legacy command, state, or Skill names', async () => {
    const files = ['SKILL.md', 'agents/openai.yaml', ...(await readdir(join(SKILL, 'references'))).map((name) => `references/${name}`), ...(await readdir(join(SKILL, 'examples'))).map((name) => `examples/${name}`)];
    const combined = (await Promise.all(files.map(text))).join('\n');

    const legacy = ['figma', 'context'].join('-');
    expect(combined).not.toContain(legacy);
    expect(combined).not.toContain(`.${legacy}`);
    expect(combined).not.toContain(['figma', 'replicate'].join('-'));
  });
});
