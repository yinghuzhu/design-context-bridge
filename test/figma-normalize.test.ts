import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DesignTarget } from '../src/core/models.js';
import { FigmaAdapter } from '../src/sources/figma/adapter.js';
import { normalizeFigmaDocument } from '../src/sources/figma/normalize.js';

const target: DesignTarget = {
  provider: 'figma',
  documentId: 'payment-file',
  nodeId: '10:20',
  sourceUrl: 'https://www.figma.com/design/payment-file/Page?node-id=10-20',
  cacheKey: 'figma_payment-file_10-20',
};

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'figma-payment-node.json'), 'utf8')) as unknown;
}

describe('normalizeFigmaDocument', () => {
  it('normalizes layout, paint, text, components, variants, assets, and visibility', async () => {
    const design = normalizeFigmaDocument(await fixture(), target);

    expect(design.rootId).toBe('10:20');
    expect(design.nodes['10:20']).toMatchObject({
      type: 'FRAME',
      visible: true,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      children: ['10:21', '10:30', '10:31', '10:40', '10:41', '10:50'],
      style: {
        layoutMode: 'VERTICAL',
        itemSpacing: 24,
        padding: { left: 32, right: 32, top: 24, bottom: 24 },
        cornerRadius: 12,
      },
    });
    expect(design.nodes['10:22']?.text).toMatchObject({
      characters: 'Payment successful',
      style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 600 },
    });
    expect(design.nodes['10:31']).toMatchObject({
      componentRef: '10:30',
      componentProperties: { State: { type: 'VARIANT', value: 'Success' } },
    });
    expect(design.nodes['10:30']?.style.componentPropertyDefinitions).toBeDefined();
    expect(design.nodes['10:40']?.assetRef).toBe('10:40');
    expect(design.nodes['10:41']?.style).toMatchObject({ strokeWeight: 2 });
    expect(design.nodes['10:50']?.visible).toBe(false);
    expect(JSON.stringify(normalizeFigmaDocument(await fixture(), target))).toBe(JSON.stringify(design));
  });

  it('rejects a response without the selected node', async () => {
    expect(() => normalizeFigmaDocument({ nodes: {} }, target)).toThrow(/selected node/i);
  });

  it('does not export effectively hidden or paintless visual nodes', () => {
    const raw = {
      nodes: {
        '10:20': {
          document: {
            id: '10:20',
            name: 'Page',
            type: 'FRAME',
            children: [
              {
                id: '10:60',
                name: 'Hidden instance',
                type: 'INSTANCE',
                visible: false,
                children: [{
                  id: '10:61',
                  name: 'Hidden child vector',
                  type: 'VECTOR',
                  strokes: [{ type: 'SOLID', visible: true }],
                }],
              },
              {
                id: '10:62',
                name: 'Transparent vector',
                type: 'VECTOR',
                opacity: 0,
                fills: [{ type: 'SOLID', visible: true }],
              },
              {
                id: '10:63',
                name: 'Paintless vector',
                type: 'VECTOR',
                fills: [],
                strokes: [],
                effects: [],
              },
              {
                id: '10:64',
                name: 'Visible vector',
                type: 'VECTOR',
                fills: [{ type: 'SOLID', visible: true }],
              },
            ],
          },
        },
      },
    };

    const design = normalizeFigmaDocument(raw, target);

    expect(design.nodes['10:60']?.visible).toBe(false);
    expect(design.nodes['10:60']?.assetRef).toBeUndefined();
    expect(design.nodes['10:61']?.visible).toBe(false);
    expect(design.nodes['10:61']?.assetRef).toBeUndefined();
    expect(design.nodes['10:62']?.visible).toBe(false);
    expect(design.nodes['10:62']?.assetRef).toBeUndefined();
    expect(design.nodes['10:63']?.assetRef).toBeUndefined();
    expect(design.nodes['10:64']?.assetRef).toBe('10:64');
  });
});

describe('FigmaAdapter', () => {
  it('keeps signed URLs only in ephemeral remote asset handles', async () => {
    const raw = await fixture();
    const client = {
      fetchNode: async () => raw,
      exportImageUrls: async () => ({
        urls: {
          '10:20': 'https://signed.invalid/root?token=secret',
          '10:30': 'https://signed.invalid/component?token=secret',
          '10:31': 'https://signed.invalid/instance?token=secret',
          '10:40': 'https://signed.invalid/image?token=secret',
          '10:41': 'https://signed.invalid/vector?token=secret',
        },
        diagnostics: [],
      }),
      download: async () => undefined,
    };
    const prepared = await new FigmaAdapter(client).prepare(target, { format: 'png', scale: 2 });

    expect(prepared.screenshot.rootScreenshot).toBe(true);
    expect(prepared.assets.map(({ id }) => id)).toEqual(['10:30', '10:31', '10:40', '10:41']);
    expect(JSON.stringify(prepared.raw)).not.toContain('signed.invalid');
    expect(JSON.stringify(prepared.design)).not.toContain('signed.invalid');
    expect(JSON.stringify(prepared.assets)).toContain('signed.invalid');
  });
});
