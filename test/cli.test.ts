import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXIT_AUTH,
  EXIT_FILESYSTEM,
  EXIT_INVALID_INPUT,
  EXIT_INVALID_PACKAGE,
  EXIT_OK,
  EXIT_SOURCE,
  main,
  MissingTokenError,
  type CliDependencies,
} from '../src/cli.js';
import { FigmaDownloadSizeError, FigmaHttpError } from '../src/sources/figma/client.js';
import { VERSION } from '../src/version.js';

function harness(overrides: Partial<CliDependencies> = {}) {
  let stdout = '';
  let stderr = '';
  const dependencies: CliDependencies = {
    env: {},
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
    ...overrides,
  };
  return { dependencies, stdout: () => stdout, stderr: () => stderr };
}

describe('CLI JSON contract', () => {
  it('prints the project version without touching providers', async () => {
    const h = harness();

    const exit = await main(['--version'], h.dependencies);

    expect(exit).toBe(EXIT_OK);
    expect(h.stdout()).toBe(`${VERSION}\n`);
    expect(h.stderr()).toBe('');
  });

  it('maps --refresh to a forced package preparation', async () => {
    let forced = false;
    const h = harness({
      preparePackage: async (_sourceUrl, _registry, options) => {
        forced = options.force === true;
        return { packageDirectory: '/tmp/package', validation: { status: 'complete', diagnostics: [] }, cacheHit: false, provider: 'figma' };
      },
      generateContextFiles: async () => ({ context: '/tmp/package/AI_CONTEXT.md', styles: '/tmp/package/styles.json', components: '/tmp/package/components.json' }),
    });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--output', '/tmp/output', '--refresh', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_OK);
    expect(forced).toBe(true);
  });

  it.each(['complete', 'partial'] as const)('returns prepare status %s and generated context paths', async (status) => {
    const h = harness({
      preparePackage: async () => ({ packageDirectory: '/tmp/package', validation: { status, diagnostics: status === 'partial' ? [{ code: 'asset_missing', message: 'optional', retryable: true, nodeId: '2:3' }] : [] }, cacheHit: false, provider: 'figma' }),
      generateContextFiles: async () => ({ context: '/tmp/package/AI_CONTEXT.md', styles: '/tmp/package/styles.json', components: '/tmp/package/components.json' }),
    });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--output', '/tmp/output', '--json'], h.dependencies);
    const payload = JSON.parse(h.stdout()) as Record<string, unknown>;

    expect(exit).toBe(EXIT_OK);
    expect(payload).toMatchObject({ ok: true, command: 'prepare', status });
    expect(h.stdout().trim().split('\n')).toHaveLength(1);
    expect(h.stderr()).toBe('');
  });

  it('returns exit 20 for an invalid package', async () => {
    const h = harness({ validatePackage: async () => ({ status: 'invalid', diagnostics: [{ code: 'missing_manifest', message: 'missing', retryable: false, nodeId: null }] }) });

    const exit = await main(['validate-package', '/tmp/missing', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_INVALID_PACKAGE);
    expect(JSON.parse(h.stdout())).toMatchObject({ ok: false, status: 'invalid' });
  });

  it('does not require a token for status', async () => {
    const h = harness({ validatePackage: async () => ({ status: 'complete', diagnostics: [] }) });

    const exit = await main(['status', '/tmp/package', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_OK);
  });

  it('returns exit 30 for provider mismatch before any source request', async () => {
    const h = harness();

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--provider', 'unknown', '--output', '/tmp/output', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_INVALID_INPUT);
    expect(JSON.parse(h.stdout())).toMatchObject({ diagnostics: [{ code: 'invalid_input' }] });
  });

  it.each([
    [new MissingTokenError(), EXIT_AUTH, 'missing_token'],
    [new FigmaHttpError(403), EXIT_AUTH, 'source_auth_failed'],
    [new FigmaHttpError(503), EXIT_SOURCE, 'source_api_failed'],
    [new FigmaDownloadSizeError(), EXIT_SOURCE, 'source_asset_too_large'],
    [Object.assign(new Error('disk secret path'), { code: 'EIO' }), EXIT_FILESYSTEM, 'filesystem_error'],
  ] as const)('maps typed failure without leaking details', async (failure, expectedExit, code) => {
    const h = harness({ preparePackage: async () => { throw failure; } });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--output', '/tmp/output', '--json'], h.dependencies);
    const serialized = h.stdout();

    expect(exit).toBe(expectedExit);
    expect(JSON.parse(serialized)).toMatchObject({ diagnostics: [{ code }] });
    expect(serialized).not.toMatch(/disk secret path|top-secret|signed\.invalid/);
  });

  it('initializes and validates migration state with generic paths', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-cli-'));
    const first = harness();
    const second = harness();

    expect(await main(['migration', 'init', target, '--json'], first.dependencies)).toBe(EXIT_OK);
    expect(await main(['migration', 'validate', target, '--json'], second.dependencies)).toBe(EXIT_OK);
    expect(JSON.parse(first.stdout())).toMatchObject({ command: 'migration.init', status: 'initialized', data: { stateFile: join(target, '.design-context', 'migration.json') } });
    expect(JSON.parse(second.stdout())).toMatchObject({ command: 'migration.validate', status: 'valid' });
  });

  it('redacts URLs and credential query values from diagnostics', async () => {
    const h = harness({ validatePackage: async () => ({ status: 'partial', diagnostics: [{ code: 'asset', message: 'failed https://signed.invalid/x?token=private', retryable: true, nodeId: null }] }) });

    await main(['inspect', '/tmp/package', '--json'], h.dependencies);

    expect(h.stdout()).not.toMatch(/signed\.invalid|private/);
  });
});
