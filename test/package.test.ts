import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { DesignTarget } from '../src/core/models.js';
import {
  buildFingerprint,
  publishStaging,
  validatePackage,
} from '../src/core/package.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'minimal-package');
const TARGET: DesignTarget = {
  provider: 'figma',
  documentId: 'file123',
  nodeId: '1:2',
  sourceUrl: 'https://www.figma.com/design/file123/Page?node-id=1-2',
  cacheKey: 'figma_file123_1-2',
};

async function temporaryDirectory(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `design-context-${label}-`));
}

async function writePackage(
  root: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(join(root, 'source'), { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'screenshot.png'), 'screenshot');
  await writeFile(join(root, 'source', 'raw.json'), '{"provider":"fixture"}\n');
  await writeFile(
    join(root, 'design.json'),
    JSON.stringify({
      provider: 'figma',
      documentId: 'file123',
      rootId: '1:2',
      nodes: {
        '1:2': {
          id: '1:2',
          name: 'Minimal',
          type: 'FRAME',
          visible: true,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          children: [],
          style: {},
        },
      },
    }),
  );
  const manifest = {
    schemaVersion: 1,
    source: {
      provider: 'figma',
      url: TARGET.sourceUrl,
      documentId: TARGET.documentId,
      nodeId: TARGET.nodeId,
    },
    document: 'design.json',
    rawSource: 'source/raw.json',
    screenshot: 'screenshot.png',
    export: { format: 'png', scale: 2 },
    fingerprint: buildFingerprint(TARGET, 'png', 2),
    status: 'complete',
    files: {},
    diagnostics: [],
    ...overrides,
  };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
}

describe('buildFingerprint', () => {
  it('is deterministic and includes provider/export options', () => {
    const first = buildFingerprint(TARGET, 'png', 2);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(buildFingerprint(TARGET, 'png', 2)).toBe(first);
    expect(buildFingerprint(TARGET, 'svg', 2)).not.toBe(first);
    expect(
      buildFingerprint({ ...TARGET, provider: 'another' }, 'png', 2),
    ).not.toBe(first);
  });
});

describe('validatePackage', () => {
  it('accepts the checked-in generic fixture', async () => {
    await expect(validatePackage(FIXTURE)).resolves.toEqual({
      status: 'complete',
      diagnostics: [],
    });
  });

  it('downgrades a missing declared non-root asset to partial', async () => {
    const root = await temporaryDirectory('missing-asset');
    await writePackage(root, {
      files: {
        '2:3': { name: 'Photo', type: 'RECTANGLE', file: 'assets/photo.png' },
      },
    });

    const result = await validatePackage(root);

    expect(result.status).toBe('partial');
    expect(result.diagnostics).toContainEqual({
      code: 'asset_missing',
      message: 'Declared asset is missing: assets/photo.png',
      retryable: true,
      nodeId: '2:3',
    });
  });

  it('downgrades a cached complete package with a low-information primitive root', async () => {
    const root = await temporaryDirectory('suspicious-scope');
    await writePackage(root);
    const design = JSON.parse(
      await readFile(join(root, 'design.json'), 'utf8'),
    ) as { nodes: Record<string, Record<string, unknown>> };
    design.nodes['1:2'] = {
      ...design.nodes['1:2'],
      type: 'RECTANGLE',
      children: [],
      style: {
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      },
    };
    await writeFile(join(root, 'design.json'), JSON.stringify(design));

    const result = await validatePackage(root);

    expect(result).toEqual({
      status: 'partial',
      diagnostics: [{
        code: 'design_scope_suspicious',
        message: 'Selected design root 1:2 is a leaf RECTANGLE with no child nodes, text, or exportable assets. Select a containing frame, group, section, or component, or explicitly confirm that a primitive-only design is intended.',
        retryable: false,
        nodeId: '1:2',
      }],
    });
  });

  it('keeps an exportable leaf primitive complete', async () => {
    const root = await temporaryDirectory('exportable-root');
    await writePackage(root);
    const design = JSON.parse(
      await readFile(join(root, 'design.json'), 'utf8'),
    ) as { nodes: Record<string, Record<string, unknown>> };
    design.nodes['1:2'] = {
      ...design.nodes['1:2'],
      type: 'RECTANGLE',
      children: [],
      assetRef: '1:2',
      style: { fills: [{ type: 'IMAGE' }] },
    };
    await writeFile(join(root, 'design.json'), JSON.stringify(design));

    await expect(validatePackage(root)).resolves.toEqual({
      status: 'complete',
      diagnostics: [],
    });
  });

  it('keeps a leaf slice complete because it defines an export region', async () => {
    const root = await temporaryDirectory('slice-root');
    await writePackage(root);
    const design = JSON.parse(
      await readFile(join(root, 'design.json'), 'utf8'),
    ) as { nodes: Record<string, Record<string, unknown>> };
    design.nodes['1:2'] = {
      ...design.nodes['1:2'],
      type: 'SLICE',
      children: [],
      style: {},
    };
    await writeFile(join(root, 'design.json'), JSON.stringify(design));

    await expect(validatePackage(root)).resolves.toEqual({
      status: 'complete',
      diagnostics: [],
    });
  });

  it('rejects relative paths that escape the package', async () => {
    const root = await temporaryDirectory('escape');
    await writePackage(root, { screenshot: '../outside.png' });

    const result = await validatePackage(root);

    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(({ code }) => code === 'unsafe_path')).toBe(
      true,
    );
  });

  it('rejects a symlink that resolves outside the package', async () => {
    const root = await temporaryDirectory('symlink');
    await writePackage(root);
    const outside = join(await temporaryDirectory('outside'), 'outside.png');
    await writeFile(outside, 'outside');
    await symlink(outside, join(root, 'assets', 'linked.png'));
    const manifest = JSON.parse(
      await readFile(join(root, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    manifest.files = {
      linked: { name: 'Linked', type: 'IMAGE', file: 'assets/linked.png' },
    };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));

    const result = await validatePackage(root);

    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(({ code }) => code === 'unsafe_path')).toBe(
      true,
    );
  });

  it('requires the selected root node in design.json', async () => {
    const root = await temporaryDirectory('root');
    await writePackage(root);
    await writeFile(
      join(root, 'design.json'),
      JSON.stringify({
        provider: 'figma',
        documentId: 'file123',
        rootId: 'missing',
        nodes: {},
      }),
    );

    const result = await validatePackage(root);

    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(({ code }) => code === 'missing_root')).toBe(
      true,
    );
  });

  it('requires manifest and design provider identity to match', async () => {
    const root = await temporaryDirectory('source-mismatch');
    await writePackage(root);
    const design = JSON.parse(
      await readFile(join(root, 'design.json'), 'utf8'),
    ) as Record<string, unknown>;
    design.provider = 'another-provider';
    await writeFile(join(root, 'design.json'), JSON.stringify(design));

    const result = await validatePackage(root);

    expect(result.status).toBe('invalid');
    expect(
      result.diagnostics.some(({ code }) => code === 'source_mismatch'),
    ).toBe(true);
  });
});

describe('publishStaging', () => {
  it('restores the previous destination when the publish rename fails', async () => {
    const parent = await temporaryDirectory('publish');
    const destination = join(parent, 'package');
    const staging = join(parent, 'staging');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'sentinel.txt'), 'original');
    await writePackage(staging);
    let renameCalls = 0;
    const renameWithFailure = vi.fn(async (source: string, target: string) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error('publish failed');
      }
      await rename(source, target);
    });

    await expect(
      publishStaging(staging, destination, { rename: renameWithFailure }),
    ).rejects.toThrow('publish failed');

    await expect(readFile(join(destination, 'sentinel.txt'), 'utf8')).resolves.toBe(
      'original',
    );
    expect(renameWithFailure).toHaveBeenCalledTimes(3);
  });
});
