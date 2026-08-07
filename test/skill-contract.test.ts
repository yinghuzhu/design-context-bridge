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
    expect(skill).toContain('.design-context/migration.json');
    expect(skill).toContain('design-context prepare');
    expect(skill).toContain('Playwright MCP');
    expect(skill).toContain('不得扫描整个仓库');
    expect(skill).toContain('视觉通过但业务失败');
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
  });

  it('requires explicit inputs and forbids unbounded repository discovery', async () => {
    const input = await text('references/input-contract.md');

    for (const phrase of ['design-platform URL', 'target directory', 'target page/route', 'approved completed new references', 'protected business behavior']) expect(input).toContain(phrase);
    for (const role of ['target', 'approved_reference', 'legacy_behavior_source', 'protected', 'unknown']) expect(input).toContain(`\`${role}\``);
    expect(input).toContain('输入缺失');
    expect(input).toContain('不得扫描或修改');
    expect(input).toContain('禁止默认遍历全部页面、完整组件库或全部 Git 历史');
  });

  it('covers migration modes, auth fallback, and visual plus business gates', async () => {
    const migration = await text('references/migration.md');
    const browser = await text('references/browser-auth.md');
    const validation = await text('references/validation.md');

    for (const mode of ['new', 'initial', 'continuation', 'adoption']) expect(migration).toContain(`\`${mode}\``);
    expect(migration).toContain('新会话不等于新迁移');
    expect(migration).toContain('.design-context/migration.json');
    expect(migration).toContain('visualEvidence');
    expect(migration).toContain('businessEvidence');
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
  });

  it('contains no active legacy command, state, or Skill names', async () => {
    const files = ['SKILL.md', 'agents/openai.yaml', ...(await readdir(join(SKILL, 'references'))).map((name) => `references/${name}`), ...(await readdir(join(SKILL, 'examples'))).map((name) => `examples/${name}`)];
    const combined = (await Promise.all(files.map(text))).join('\n');

    expect(combined).not.toMatch(/figma-context|\.figma-context|figma-replicate/);
  });
});
