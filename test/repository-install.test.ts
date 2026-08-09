import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);
const installer = resolve(ROOT, 'scripts', 'install.sh');

async function runInstaller(client = 'both') {
  const root = await mkdtemp(join(tmpdir(), 'design-context-install-'));
  const home = join(root, 'home');
  const installRoot = join(root, 'share', 'design-context-bridge');
  const binDirectory = join(root, 'bin');
  await mkdir(home, { recursive: true });
  const result = await execute('bash', [installer, '--client', client, '--home', home, '--install-root', installRoot, '--bin-dir', binDirectory, '--skip-check'], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return { ...result, root, home, installRoot, binDirectory };
}

describe('repository distribution', () => {
  it('is private and has no npm publication lifecycle', async () => {
    const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      private?: boolean;
      scripts?: Record<string, string>;
    };

    expect(packageJson.private).toBe(true);
    expect(packageJson.scripts?.prepack).toBeUndefined();
  });

  it('documents only the repository installer and local state policy', async () => {
    const readme = await readFile(resolve(ROOT, 'README.md'), 'utf8');
    const template = await readFile(resolve(ROOT, 'templates', 'design-context.gitignore'), 'utf8');

    for (const required of ['./scripts/install.sh', 'git pull --ff-only', '--refresh', '~/.local/bin', '.design-context/packages/', '.design-context/evidence/']) {
      expect(readme).toContain(required);
    }
    for (const forbidden of ['npm install -g', 'npx design-context-bridge', 'npm publish']) {
      expect(readme).not.toContain(forbidden);
    }
    expect(template).toContain('.design-context/packages/');
    expect(template).toContain('.design-context/evidence/');
    expect(template).not.toContain('migration.json');
  });

  it('marks obsolete implementation plans as historical', async () => {
    const paths = [
      'docs/plans/2026-08-07-agent-figma-replication-design.md',
      'docs/plans/2026-08-07-design-context-node-rebuild-design.md',
      'docs/superpowers/plans/2026-08-07-design-context-node-rebuild.md',
      'docs/superpowers/plans/2026-08-07-figma-context-core-cli.md',
      'docs/superpowers/plans/2026-08-07-figma-replicate-skill.md',
    ];

    for (const path of paths) {
      expect(await readFile(resolve(ROOT, path), 'utf8')).toMatch(/^# .+\n\n> Historical implementation record\./u);
    }
  });

  it('runs supported checks and installer smoke on Node 20 and 22 without publishing', async () => {
    const workflow = await readFile(resolve(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

    for (const required of ['20', '22', 'npm ci', 'npm run check', 'scripts/install.sh', '--skip-check', 'design-context" --version']) {
      expect(workflow).toContain(required);
    }
    expect(workflow).not.toContain('npm publish');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
  });

  it('installs the runtime, wrappers, and both Agent Skills into disposable user paths', async () => {
    const result = await runInstaller();

    const manifest = JSON.parse(await readFile(join(result.installRoot, 'install-manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ schemaVersion: 1, tool: 'design-context-bridge', version: '0.2.0' });
    await access(join(result.home, '.agents', 'skills', 'design-replicate', 'SKILL.md'));
    await access(join(result.home, '.claude', 'skills', 'design-replicate', 'SKILL.md'));
    const version = await execute(join(result.binDirectory, 'design-context'), ['--version']);
    expect(version.stdout).toBe('0.2.0\n');
  }, 30_000);

  it('updates an owned installation without retaining stale runtime files', async () => {
    const first = await runInstaller('codex');
    await writeFile(join(first.installRoot, 'stale.txt'), 'stale');

    await execute('bash', [installer, '--client', 'codex', '--home', first.home, '--install-root', first.installRoot, '--bin-dir', first.binDirectory, '--skip-check'], {
      cwd: ROOT,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });

    await expect(access(join(first.installRoot, 'stale.txt'))).rejects.toThrow();
    await access(join(first.home, '.agents', 'skills', 'design-replicate', '.design-context-bridge-owned.json'));
    await expect(access(join(first.home, '.claude', 'skills', 'design-replicate'))).rejects.toThrow();
  }, 30_000);

  it('refuses to overwrite an unowned existing Skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-context-install-unknown-'));
    const home = join(root, 'home');
    const destination = join(home, '.agents', 'skills', 'design-replicate');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'owned-by-user'), 'keep');

    try {
      await execute('bash', [installer, '--client', 'codex', '--home', home, '--install-root', join(root, 'share'), '--bin-dir', join(root, 'bin'), '--skip-check'], {
        cwd: ROOT,
        env: process.env,
        maxBuffer: 1024 * 1024,
      });
      throw new Error('installer unexpectedly overwrote an unowned Skill');
    } catch (error) {
      expect(String((error as { stderr?: string }).stderr)).toMatch(/not owned/i);
    }

    await expect(readFile(join(destination, 'owned-by-user'), 'utf8')).resolves.toBe('keep');
  }, 30_000);
});
