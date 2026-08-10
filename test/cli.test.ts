import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
import { emptyMigrationState } from '../src/core/migration.js';
import type { DesignTarget } from '../src/core/models.js';
import { SourceRegistry } from '../src/sources/registry.js';
import type { DesignSourceAdapter, PreparedSource, RemoteAsset } from '../src/sources/types.js';

const execute = promisify(execFile);

class CliFixtureAdapter implements DesignSourceAdapter {
  readonly provider = 'fixture';

  supports(url: URL): boolean { return url.hostname === 'design.example'; }
  parse(): DesignTarget {
    return { provider: 'fixture', documentId: 'document', nodeId: '1:2', sourceUrl: 'https://design.example/page?node=1-2', cacheKey: 'fixture_document_1-2' };
  }
  async prepare(): Promise<PreparedSource> {
    return {
      raw: { document: 'fixture' },
      design: {
        provider: 'fixture',
        documentId: 'document',
        rootId: '1:2',
        nodes: { '1:2': { id: '1:2', name: 'Page', type: 'FRAME', visible: true, bounds: { x: 0, y: 0, width: 100, height: 100 }, children: [], style: {} } },
      },
      screenshot: { id: '1:2', name: 'Page', type: 'FRAME', url: 'https://assets.invalid/root', rootScreenshot: true },
      assets: [],
      diagnostics: [],
    };
  }
  async download(_asset: RemoteAsset, destination: string): Promise<void> {
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, 'fixture-image');
  }
}

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

  it('resolves a target repository to an external workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-context-cli-workspace-'));
    const target = join(root, 'target');
    await mkdir(target);
    await execute('git', ['init', '--quiet', target]);
    const h = harness({
      env: {
        DESIGN_CONTEXT_STATE_HOME: join(root, 'state'),
        DESIGN_CONTEXT_CACHE_HOME: join(root, 'cache'),
      },
    });

    const exit = await main(['workspace', 'resolve', target, '--json'], h.dependencies);
    const payload = JSON.parse(h.stdout()) as { data: Record<string, unknown> };

    expect(exit).toBe(EXIT_OK);
    expect(payload.data).toMatchObject({
      targetDirectory: expect.any(String),
      gitRoot: expect.any(String),
      workspaceId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      identitySource: 'git-metadata',
      workspaceIdFile: expect.stringContaining('design-context-bridge/workspace-id'),
      workspaceMetadataFile: expect.stringContaining('workspace.json'),
      storageScope: 'external',
    });
    expect(String(payload.data.stateFile).startsWith(`${target}/`)).toBe(false);
    expect(String(payload.data.packagesDirectory).startsWith(`${target}/`)).toBe(false);
    expect(String(payload.data.evidenceDirectory).startsWith(`${target}/`)).toBe(false);
    await expect(readdir(target)).resolves.toEqual(['.git']);
  });

  it('uses --target external packages without modifying the target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-context-cli-target-'));
    const target = join(root, 'target');
    await mkdir(target);
    await execute('git', ['init', '--quiet', target]);
    let outputRoot = '';
    const h = harness({
      env: {
        DESIGN_CONTEXT_STATE_HOME: join(root, 'state'),
        DESIGN_CONTEXT_CACHE_HOME: join(root, 'cache'),
      },
      preparePackage: async (_sourceUrl, _registry, options) => {
        outputRoot = options.outputRoot;
        return { packageDirectory: join(options.outputRoot, 'package'), validation: { status: 'complete', diagnostics: [] }, cacheHit: false, provider: 'figma' };
      },
      generateContextFiles: async () => ({ context: join(outputRoot, 'package', 'AI_CONTEXT.md'), styles: join(outputRoot, 'package', 'styles.json'), components: join(outputRoot, 'package', 'components.json') }),
    });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--target', target, '--json'], h.dependencies);
    const payload = JSON.parse(h.stdout()) as { data: Record<string, unknown> };

    expect(exit).toBe(EXIT_OK);
    expect(outputRoot).toContain(join(root, 'cache', 'design-context-bridge', 'workspaces'));
    expect(payload.data).toMatchObject({ storageScope: 'external', workspaceId: expect.any(String), packagesDirectory: outputRoot });
    await expect(readdir(target)).resolves.toEqual(['.git']);
  });

  it('publishes a real package through --target only in the external cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-context-cli-real-target-'));
    const target = join(root, 'target');
    await mkdir(target);
    await execute('git', ['init', '--quiet', target]);
    const h = harness({
      env: { DESIGN_CONTEXT_STATE_HOME: join(root, 'state'), DESIGN_CONTEXT_CACHE_HOME: join(root, 'cache') },
      registry: new SourceRegistry([new CliFixtureAdapter()]),
    });

    const exit = await main(['prepare', 'https://design.example/page?node=1-2', '--target', target, '--json'], h.dependencies);
    const payload = JSON.parse(h.stdout()) as { data: { packageDirectory: string; packagesDirectory: string; storageScope: string } };

    expect(exit).toBe(EXIT_OK);
    expect(payload.data.storageScope).toBe('external');
    expect(payload.data.packageDirectory.startsWith(`${payload.data.packagesDirectory}/`)).toBe(true);
    await access(join(payload.data.packageDirectory, 'manifest.json'));
    await access(join(payload.data.packageDirectory, 'source', 'raw.json'));
    await expect(readdir(target)).resolves.toEqual(['.git']);
  });

  it('refuses in-repository --output before preparation and leaves no partial directory', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-cli-refuse-'));
    await execute('git', ['init', '--quiet', target]);
    const output = join(target, 'generated', 'packages');
    let called = false;
    const h = harness({ preparePackage: async () => { called = true; throw new Error('must not run'); } });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--output', output, '--json'], h.dependencies);

    expect(exit).toBe(EXIT_INVALID_INPUT);
    expect(called).toBe(false);
    expect(JSON.parse(h.stdout())).toMatchObject({ diagnostics: [{ code: 'in_repo_output_refused' }] });
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows explicitly confirmed in-repository output and reports the risk', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-cli-allow-'));
    await execute('git', ['init', '--quiet', target]);
    const output = join(target, '.design-context', 'packages');
    const h = harness({
      preparePackage: async () => ({ packageDirectory: join(output, 'package'), validation: { status: 'complete', diagnostics: [] }, cacheHit: false, provider: 'figma' }),
      generateContextFiles: async () => ({ context: join(output, 'package', 'AI_CONTEXT.md'), styles: join(output, 'package', 'styles.json'), components: join(output, 'package', 'components.json') }),
    });

    const exit = await main(['prepare', 'https://www.figma.com/design/file/Page?node-id=1-2', '--output', output, '--allow-in-repo', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_OK);
    expect(JSON.parse(h.stdout())).toMatchObject({
      data: { storageScope: 'in-repo' },
      diagnostics: [{ code: 'in_repo_storage_enabled', retryable: false }],
    });
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
    const root = await mkdtemp(join(tmpdir(), 'design-context-cli-'));
    const target = join(root, 'target');
    await mkdir(target);
    const env = { DESIGN_CONTEXT_STATE_HOME: join(root, 'state'), DESIGN_CONTEXT_CACHE_HOME: join(root, 'cache') };
    const first = harness({ env });
    const second = harness({ env });

    expect(await main(['migration', 'init', target, '--json'], first.dependencies)).toBe(EXIT_OK);
    expect(await main(['migration', 'validate', target, '--json'], second.dependencies)).toBe(EXIT_OK);
    const initialized = JSON.parse(first.stdout()) as { data: Record<string, unknown> };
    expect(initialized).toMatchObject({ command: 'migration.init', status: 'initialized', data: { storageScope: 'external' } });
    expect(String(initialized.data.stateFile).startsWith(`${target}/`)).toBe(false);
    expect(JSON.parse(second.stdout())).toMatchObject({ command: 'migration.validate', status: 'valid', data: { stateFile: initialized.data.stateFile } });
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('imports legacy repository state without deleting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-context-cli-import-'));
    const target = join(root, 'target');
    const legacy = join(target, '.design-context', 'migration.json');
    await mkdir(join(target, '.design-context'), { recursive: true });
    await writeFile(legacy, `${JSON.stringify(emptyMigrationState())}\n`);
    const h = harness({ env: { DESIGN_CONTEXT_STATE_HOME: join(root, 'state'), DESIGN_CONTEXT_CACHE_HOME: join(root, 'cache') } });

    const exit = await main(['migration', 'import', target, '--from-repository', '--json'], h.dependencies);

    expect(exit).toBe(EXIT_OK);
    expect(JSON.parse(h.stdout())).toMatchObject({ command: 'migration.import', status: 'imported', diagnostics: [{ code: 'legacy_state_imported' }] });
    await access(legacy);
  });

  it('redacts URLs and credential query values from diagnostics', async () => {
    const h = harness({ validatePackage: async () => ({ status: 'partial', diagnostics: [{ code: 'asset', message: 'failed https://signed.invalid/x?token=private', retryable: true, nodeId: null }] }) });

    await main(['inspect', '/tmp/package', '--json'], h.dependencies);

    expect(h.stdout()).not.toMatch(/signed\.invalid|private/);
  });
});
