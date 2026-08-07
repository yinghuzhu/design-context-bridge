import { describe, expect, it } from 'vitest';

import type { DesignSourceAdapter } from '../src/sources/types.js';
import { SourceRegistry } from '../src/sources/registry.js';
import { parseFigmaUrl } from '../src/sources/figma/url.js';

function fakeAdapter(
  provider: string,
  supported: boolean,
): DesignSourceAdapter {
  return {
    provider,
    supports: () => supported,
    parse: () => {
      throw new Error('parse must not run for an unsupported URL');
    },
    prepare: async () => {
      throw new Error('prepare is not used by registry tests');
    },
    download: async () => {
      throw new Error('download is not used by registry tests');
    },
  };
}

describe('parseFigmaUrl', () => {
  it.each(['design', 'file', 'proto'])(
    'parses /%s/ URLs into a generic target',
    (kind) => {
      const target = parseFigmaUrl(
        `https://www.figma.com/${kind}/file123/Page?node-id=1-2`,
      );

      expect(target).toEqual({
        provider: 'figma',
        documentId: 'file123',
        nodeId: '1:2',
        sourceUrl: `https://www.figma.com/${kind}/file123/Page?node-id=1-2`,
        cacheKey: 'figma_file123_1-2',
      });
    },
  );

  it('requires a node-id query parameter', () => {
    expect(() =>
      parseFigmaUrl('https://www.figma.com/design/file123/Page'),
    ).toThrow(/node-id/);
  });

  it('removes sensitive query values from the persisted source URL', () => {
    const target = parseFigmaUrl(
      'https://www.figma.com/design/file123/Page?node-id=1-2&token=secret',
    );

    expect(target.sourceUrl).toBe(
      'https://www.figma.com/design/file123/Page?node-id=1-2',
    );
  });
});

describe('SourceRegistry', () => {
  it('auto-selects the only adapter that supports the URL', () => {
    const figma: DesignSourceAdapter = {
      ...fakeAdapter('figma', true),
      parse: parseFigmaUrl,
    };
    const registry = new SourceRegistry([figma]);

    const resolved = registry.resolve(
      'https://www.figma.com/design/file123/Page?node-id=1-2',
    );

    expect(resolved.adapter).toBe(figma);
    expect(resolved.target.provider).toBe('figma');
  });

  it('rejects an explicit provider that does not support the URL', () => {
    const registry = new SourceRegistry([fakeAdapter('figma', false)]);

    expect(() =>
      registry.resolve('https://example.invalid/design/1', 'figma'),
    ).toThrow(/does not support/);
  });

  it('rejects duplicate provider registrations', () => {
    expect(
      () =>
        new SourceRegistry([
          fakeAdapter('figma', true),
          fakeAdapter('figma', true),
        ]),
    ).toThrow(/Duplicate provider/);
  });
});
