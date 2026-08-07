import { lstat, mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { installSkill, main, type InstallOperations } from '../scripts/install-skill.js';

async function sourceSkill(): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), 'design-replicate-source-'));
  await mkdir(join(source, 'references'), { recursive: true });
  await mkdir(join(source, 'examples'), { recursive: true });
  await mkdir(join(source, 'agents'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: design-replicate\ndescription: test\n---\n');
  await writeFile(join(source, 'references', 'rules.md'), 'rules');
  await writeFile(join(source, 'examples', 'new-page.md'), 'example');
  await writeFile(join(source, 'agents', 'openai.yaml'), 'interface: {}\n');
  return source;
}

describe('installSkill', () => {
  it('installs absolute links for Codex and Claude Code', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));

    const installed = await installSkill(source, home, ['codex', 'claude'], false);

    expect(installed).toEqual([join(home, '.agents', 'skills', 'design-replicate'), join(home, '.claude', 'skills', 'design-replicate')]);
    for (const destination of installed) {
      expect((await lstat(destination)).isSymbolicLink()).toBe(true);
      expect(await readlink(destination)).toBe(resolve(source));
    }
  });

  it('copies the complete Skill tree', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));

    const [destination] = await installSkill(source, home, ['codex'], true);

    expect((await lstat(destination ?? '')).isSymbolicLink()).toBe(false);
    await expect(readFile(join(destination ?? '', 'references', 'rules.md'), 'utf8')).resolves.toBe('rules');
    await expect(readFile(join(destination ?? '', 'examples', 'new-page.md'), 'utf8')).resolves.toBe('example');
  });

  it('preflights all targets and preserves an existing destination', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));
    const existing = join(home, '.claude', 'skills', 'design-replicate');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'owned-by-user'), 'keep');

    await expect(installSkill(source, home, ['codex', 'claude'], false)).rejects.toThrow(/already exists/);
    await expect(lstat(join(home, '.agents', 'skills', 'design-replicate'))).rejects.toThrow();
    await expect(readFile(join(existing, 'owned-by-user'), 'utf8')).resolves.toBe('keep');
  });

  it('refuses a broken destination symlink', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));
    const destination = join(home, '.agents', 'skills', 'design-replicate');
    await mkdir(join(destination, '..'), { recursive: true });
    await symlink(join(home, 'missing'), destination);

    await expect(installSkill(source, home, ['codex'], false)).rejects.toThrow(/already exists/);
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
  });

  it('rolls back only destinations created by the current call', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));
    let copies = 0;
    const operations: Partial<InstallOperations> = {
      copy: vi.fn(async (from, to) => {
        copies += 1;
        if (copies === 2) throw new Error('copy failed');
        const { cp } = await import('node:fs/promises');
        await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      }),
    };

    await expect(installSkill(source, home, ['codex', 'claude'], true, operations)).rejects.toThrow(/copy failed/);
    await expect(lstat(join(home, '.agents', 'skills', 'design-replicate'))).rejects.toThrow();
    await expect(lstat(join(home, '.claude', 'skills', 'design-replicate'))).rejects.toThrow();
  });

  it('exposes a distributable installer CLI', async () => {
    const source = await sourceSkill();
    const home = await mkdtemp(join(tmpdir(), 'design-replicate-home-'));
    let output = '';

    const exit = await main(['--client', 'claude', '--copy', '--home', home, '--source', source], {
      stderr: (value) => { output += value; },
    });

    expect(exit).toBe(0);
    expect(output).toContain(join(home, '.claude', 'skills', 'design-replicate'));
    await expect(readFile(join(home, '.claude', 'skills', 'design-replicate', 'SKILL.md'), 'utf8')).resolves.toContain('design-replicate');
  });
});
