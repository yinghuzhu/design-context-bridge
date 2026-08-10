import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', 'evals', 'design-replicate');

interface EvalCase {
  name: string;
  fixture: string;
  provider: string | null;
  designUrl: string | null;
  prompt: string;
  expectedReads: string[];
  forbiddenReads: string[];
  expectedCommands: string[];
  expectedState: Record<string, unknown>;
  completionAllowed: boolean;
}

async function cases(): Promise<EvalCase[]> {
  return JSON.parse(await readFile(join(ROOT, 'cases.json'), 'utf8')) as EvalCase[];
}

describe('cross-Agent evaluation contract', () => {
  it('covers established scenarios plus provider selection and repository cleanliness', async () => {
    expect(new Set((await cases()).map(({ name }) => name))).toEqual(new Set([
      'missing-required-input', 'non-multimodal-agent', 'new-page', 'initial-migration',
      'continuation', 'adoption-with-user-reference', 'bounded-large-repository',
      'playwright-mcp-fallback', 'documented-login', 'mfa-user-handoff',
      'visual-pass-business-fail', 'provider-selection', 'repository-cleanliness',
    ]));
  });

  it('uses strict generic fields and confined fixture/report paths', async () => {
    const root = resolve(ROOT);
    for (const value of await cases()) {
      expect(Object.keys(value).sort()).toEqual(['completionAllowed', 'designUrl', 'expectedCommands', 'expectedReads', 'expectedState', 'fixture', 'forbiddenReads', 'name', 'prompt', 'provider'].sort());
      const fixture = resolve(ROOT, value.fixture);
      const report = resolve(ROOT, 'expected', `${value.name}.md`);
      expect(fixture.startsWith(`${root}/`)).toBe(true);
      expect(report.startsWith(`${root}/`)).toBe(true);
      await expect(readFile(fixture, 'utf8')).resolves.not.toBe('');
      await expect(readFile(report, 'utf8')).resolves.toContain(value.name);
      if (value.name === 'missing-required-input') {
        expect(value.provider).toBeNull();
        expect(value.designUrl).toBeNull();
      } else {
        expect(value.provider).toBe('figma');
        expect(value.designUrl).toMatch(/^https:\/\//u);
      }
    }
  });

  it('requires real target screenshots and multimodal comparison for completion', async () => {
    for (const value of await cases()) {
      if (!value.completionAllowed) continue;
      const commands = value.expectedCommands.map((command) => command.toLowerCase());
      expect(commands.some((command) => command.includes('screenshot real target page') && !command.startsWith('design-context ')), value.name).toBe(true);
      expect(commands.some((command) => command.includes('multimodal compare source and actual screenshots')), value.name).toBe(true);
      expect(commands.some((command) => command.startsWith('design-context ') && /render|score|compare/u.test(command)), value.name).toBe(false);
      expect(commands).toContain('git diff --cached --name-only');
    }
  });

  it('encodes bounded, browser, auth, business, and provider gates', async () => {
    const values = Object.fromEntries((await cases()).map((value) => [value.name, value]));
    expect(values['missing-required-input']?.expectedReads).toEqual([]);
    expect(values['missing-required-input']?.completionAllowed).toBe(false);
    expect(values['non-multimodal-agent']?.expectedState.visualValidation).toBe('not-run');
    expect(values['initial-migration']?.expectedState.approvedReferences).toEqual([]);
    expect(values.continuation?.expectedState.priorState).toBe('preserved');
    expect(values['adoption-with-user-reference']?.expectedState.approvedByUser).toBe(true);
    expect(values['bounded-large-repository']?.forbiddenReads).toContain('project/node_modules/**');
    expect(values['playwright-mcp-fallback']?.expectedState.sessionReuse).toBe('not-assumed');
    expect(values['mfa-user-handoff']?.expectedState.credentialRequest).toBe('none');
    expect(values['visual-pass-business-fail']?.expectedState.humanHandoff).toBe('forbidden');
    expect(values['provider-selection']?.expectedState.selection).toBe('registry-url-match');
    expect(values['repository-cleanliness']?.expectedState.repositoryPollution).toBe('none');
    expect(values['repository-cleanliness']?.expectedState.stagedGeneratedFiles).toBe('none');
  });

  it('uses external workspace commands and never stages generated files', async () => {
    const serialized = JSON.stringify(await cases());
    expect(serialized).not.toContain('git add -A');
    for (const value of await cases()) {
      if (value.name === 'missing-required-input') continue;
      expect(value.expectedCommands).toContain('design-context workspace resolve');
      if (value.expectedCommands.some((command) => command.startsWith('design-context prepare'))) {
        expect(value.expectedCommands).toContain('design-context prepare --target');
      }
    }
  });

  it('keeps runbook provider-neutral and expected reports case-specific', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('$design-replicate');
    expect(readme).toContain('/design-replicate');
    expect(readme).toContain('隔离');
    expect(readme).toContain('expected/');
    expect(readme).toContain('production');
    const reports = await readdir(join(ROOT, 'expected'));
    expect(reports).toHaveLength((await cases()).length);
    for (const filename of reports) {
      const report = await readFile(join(ROOT, 'expected', filename), 'utf8');
      expect(report).toContain('## 允许行为');
      expect(report).toContain('## 禁止行为');
      expect(report).toContain('## 最终报告条件');
    }
  });
});
