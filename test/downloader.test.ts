import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DesignDocument, DesignTarget, Diagnostic } from '../src/core/models.js';
import { preparePackage } from '../src/core/downloader.js';
import { SourceRegistry } from '../src/sources/registry.js';
import type { DesignSourceAdapter, PreparedSource, RemoteAsset } from '../src/sources/types.js';

const SOURCE_URL = 'https://design.example/document/file123?node=1-2&token=remove-me';
const TARGET: DesignTarget = {
  provider: 'fixture',
  documentId: 'file123',
  nodeId: '1:2',
  sourceUrl: 'https://design.example/document/file123?node=1-2',
  cacheKey: 'fixture_file123_1-2',
};

function design(includeSecond = true): DesignDocument {
  return {
    provider: 'fixture',
    documentId: 'file123',
    rootId: '1:2',
    nodes: {
      '1:2': { id: '1:2', name: 'Checkout', type: 'FRAME', visible: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, children: includeSecond ? ['2:3', '3:4'] : ['2:3'], style: {} },
      '2:3': { id: '2:3', name: 'Hero image', type: 'RECTANGLE', visible: true, bounds: { x: 0, y: 0, width: 100, height: 100 }, children: [], style: {}, assetRef: '2:3' },
      ...(includeSecond ? { '3:4': { id: '3:4', name: 'Logo / Mark', type: 'VECTOR', visible: true, bounds: null, children: [], style: {}, assetRef: '3:4' } } : {}),
    },
  };
}

function lowInformationDesign(): DesignDocument {
  return {
    provider: 'fixture',
    documentId: 'file123',
    rootId: '1:2',
    nodes: {
      '1:2': {
        id: '1:2',
        name: 'Background',
        type: 'RECTANGLE',
        visible: true,
        bounds: { x: 0, y: 0, width: 500, height: 650 },
        children: [],
        style: { fills: [{ type: 'SOLID' }] },
      },
    },
  };
}

class FakeAdapter implements DesignSourceAdapter {
  readonly provider = 'fixture';
  prepareCalls = 0;
  downloads: string[] = [];
  failRoot = false;
  failAssets = new Set<string>();
  includeSecond = true;
  lowInformationRoot = false;
  diagnostics: Diagnostic[] = [];

  supports(url: URL): boolean { return url.hostname === 'design.example'; }
  parse(): DesignTarget { return TARGET; }
  async prepare(): Promise<PreparedSource> {
    this.prepareCalls += 1;
    const document = this.lowInformationRoot
      ? lowInformationDesign()
      : design(this.includeSecond);
    return {
      raw: { provider: 'fixture', token: undefined },
      design: document,
      screenshot: { id: '1:2', name: 'Checkout', type: 'FRAME', url: 'https://signed.invalid/root?token=secret', rootScreenshot: true },
      assets: Object.values(document.nodes).filter(({ assetRef }) => assetRef !== undefined).map((node) => ({ id: node.id, name: node.name, type: node.type, url: `https://signed.invalid/${node.id}?token=secret`, rootScreenshot: false })),
      diagnostics: this.diagnostics,
    };
  }
  async download(asset: RemoteAsset, destination: string): Promise<void> {
    this.downloads.push(asset.id);
    if ((asset.rootScreenshot && this.failRoot) || this.failAssets.has(asset.id)) throw new Error(`download failed ${asset.url}`);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, `bytes:${asset.id}`);
  }
}

describe('preparePackage', () => {
  it('publishes a generic complete package with safe metadata', async () => {
    const adapter = new FakeAdapter();
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));
    const result = await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot, format: 'jpg', scale: 2 });
    const manifest = JSON.parse(await readFile(join(result.packageDirectory, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const readme = await readFile(join(result.packageDirectory, 'README.md'), 'utf8');

    expect(result).toMatchObject({ cacheHit: false, provider: 'fixture', validation: { status: 'complete' } });
    expect(manifest).toMatchObject({ schemaVersion: 1, screenshot: 'screenshot.jpg', status: 'complete', document: 'design.json', rawSource: 'source/raw.json' });
    expect(JSON.stringify(manifest) + readme).not.toMatch(/signed\.invalid|remove-me|token=secret/);
  });

  it('publishes partial when a non-root asset download fails', async () => {
    const adapter = new FakeAdapter();
    adapter.failAssets.add('3:4');
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));
    const result = await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot });

    expect(result.validation.status).toBe('partial');
    expect(result.validation.diagnostics.some(({ code, nodeId }) => code === 'asset_download_failed' && nodeId === '3:4')).toBe(true);
  });

  it('publishes and revalidates a low-information primitive root as partial', async () => {
    const adapter = new FakeAdapter();
    adapter.lowInformationRoot = true;
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));

    const first = await preparePackage(
      SOURCE_URL,
      new SourceRegistry([adapter]),
      { outputRoot },
    );
    const manifest = JSON.parse(
      await readFile(join(first.packageDirectory, 'manifest.json'), 'utf8'),
    ) as { status: string; diagnostics: Diagnostic[] };

    expect(first.validation.status).toBe('partial');
    expect(first.validation.diagnostics).toHaveLength(1);
    expect(first.validation.diagnostics[0]).toMatchObject({
      code: 'design_scope_suspicious',
      retryable: false,
      nodeId: '1:2',
    });
    expect(manifest.status).toBe('partial');
    expect(manifest.diagnostics).toHaveLength(1);

    adapter.prepareCalls = 0;
    const cached = await preparePackage(
      SOURCE_URL,
      new SourceRegistry([adapter]),
      { outputRoot },
    );

    expect(cached.cacheHit).toBe(true);
    expect(cached.validation.status).toBe('partial');
    expect(cached.validation.diagnostics).toHaveLength(1);
    expect(adapter.prepareCalls).toBe(0);
  });

  it('preserves an existing destination when the root screenshot fails', async () => {
    const adapter = new FakeAdapter();
    adapter.failRoot = true;
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));
    const destination = join(outputRoot, TARGET.cacheKey);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'sentinel.txt'), 'original');

    await expect(preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot })).rejects.toThrow(/root screenshot/i);
    await expect(readFile(join(destination, 'sentinel.txt'), 'utf8')).resolves.toBe('original');
  });

  it('uses a matching valid cache without calling the adapter', async () => {
    const adapter = new FakeAdapter();
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));
    await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot });
    adapter.prepareCalls = 0;

    const result = await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot });

    expect(result.cacheHit).toBe(true);
    expect(adapter.prepareCalls).toBe(0);
  });

  it('force replacement removes stale assets', async () => {
    const adapter = new FakeAdapter();
    const outputRoot = await mkdtemp(join(tmpdir(), 'design-context-download-'));
    const first = await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot });
    await writeFile(join(first.packageDirectory, 'assets', 'stale.png'), 'stale');
    adapter.includeSecond = false;

    const result = await preparePackage(SOURCE_URL, new SourceRegistry([adapter]), { outputRoot, force: true });

    await expect(readFile(join(result.packageDirectory, 'assets', 'stale.png'))).rejects.toThrow();
  });
});
