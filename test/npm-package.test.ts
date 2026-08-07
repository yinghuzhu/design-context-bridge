import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

describe('npm distribution', () => {
  it('contains only the intended Node runtime, types, installer, docs, and Skill', async () => {
    await execute('npm', ['run', 'build', '--silent']);
    const { stdout } = await execute('npm', ['pack', '--json', '--dry-run', '--ignore-scripts']);
    const result = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = result[0]?.files.map(({ path }) => path) ?? [];

    for (const required of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'dist/install-skill.js', 'README.md', 'LICENSE', 'skills/design-replicate/SKILL.md']) expect(files).toContain(required);
    expect(files.some((path) => path.startsWith('skills/design-replicate/references/'))).toBe(true);
    expect(files.some((path) => path.startsWith('skills/design-replicate/examples/'))).toBe(true);
    for (const forbidden of [/\.py$/u, /^src\//u, /^test(s)?\//u, /fixture/iu, /token/iu, /download/iu, /transcript/iu]) {
      expect(files.filter((path) => forbidden.test(path)), String(forbidden)).toEqual([]);
    }
  });
});
