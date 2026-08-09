import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const scanner = resolve(import.meta.dirname, '..', 'scripts', 'check-secrets.sh');

async function makeRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'design-context-secret-scan-'));
  await execute('git', ['init', '--quiet'], { cwd: root });
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  await execute('git', ['add', '.'], { cwd: root });
  return root;
}

async function runScanner(root: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await execute('bash', [scanner], { cwd: root });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('tracked secret scanner', () => {
  it('accepts explicit placeholders and invalid test domains', async () => {
    const root = await makeRepository({
      'safe.txt': 'FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxx\nhttps://signed.invalid/image?token=secret\n',
    });

    await expect(runScanner(root)).resolves.toMatchObject({ exitCode: 0, stderr: '' });
  });

  it('rejects a credential-shaped tracked value without printing it', async () => {
    const credential = `figd_${'A'.repeat(32)}`;
    const root = await makeRepository({ 'unsafe.txt': `${credential}\n` });

    const result = await runScanner(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('unsafe.txt');
    expect(result.stderr).not.toContain(credential);
  });

  it('ignores untracked local files', async () => {
    const root = await makeRepository({ 'safe.txt': 'tracked\n' });
    await writeFile(join(root, '.env'), `FIGMA_TOKEN=figd_${'B'.repeat(32)}\n`);

    await expect(runScanner(root)).resolves.toMatchObject({ exitCode: 0 });
  });
});
