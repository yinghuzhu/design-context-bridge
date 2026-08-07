import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateContextFiles } from '../src/core/context.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'minimal-package');

async function packageWithContextDesign(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'design-context-context-'));
  await cp(FIXTURE, root, { recursive: true });
  const color = { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } };
  const typography = { fontFamily: 'Inter', fontSize: 20, fontWeight: 600 };
  const design = {
    provider: 'figma', documentId: 'file123', rootId: '1:2', nodes: {
      '1:2': { id: '1:2', name: 'Payment Result', type: 'FRAME', visible: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, children: ['10:21', '10:30', '10:31', '10:40', '10:50'], style: { fills: [color], itemSpacing: 24, padding: { left: 32 }, cornerRadius: 12, effects: [{ type: 'DROP_SHADOW', radius: 16 }] } },
      '10:21': { id: '10:21', name: 'Header', type: 'FRAME', visible: true, bounds: { x: 32, y: 24, width: 1376, height: 80 }, children: ['10:22', '10:23'], style: {} },
      '10:22': { id: '10:22', name: 'Title', type: 'TEXT', visible: true, bounds: null, children: [], text: { characters: 'Payment successful', style: typography }, style: { fills: [color] } },
      '10:23': { id: '10:23', name: 'Subtitle', type: 'TEXT', visible: true, bounds: null, children: [], text: { characters: 'Your order is confirmed', style: typography }, style: { fills: [color] } },
      '10:30': { id: '10:30', name: 'Payment card', type: 'COMPONENT', visible: true, bounds: null, children: [], style: { componentPropertyDefinitions: { State: { type: 'VARIANT', variantOptions: ['Success', 'Failure'] } } } },
      '10:31': { id: '10:31', name: 'Payment card / Success', type: 'INSTANCE', visible: true, bounds: null, children: [], componentRef: '10:30', componentProperties: { State: { type: 'VARIANT', value: 'Success' } }, style: {} },
      '10:40': { id: '10:40', name: 'Receipt preview', type: 'RECTANGLE', visible: true, bounds: null, children: [], assetRef: '10:40', style: {} },
      '10:50': { id: '10:50', name: 'Hidden note', type: 'TEXT', visible: false, bounds: null, children: [], text: { characters: 'Do not show', style: {} }, style: {} },
    },
  };
  await writeFile(join(root, 'design.json'), JSON.stringify(design));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  manifest.files = { '10:40': { name: 'Receipt preview', type: 'RECTANGLE', file: 'assets/receipt.png' } };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'receipt.png'), 'asset');
  return root;
}

describe('generateContextFiles', () => {
  it('writes bounded source-priority context without hidden or sensitive content', async () => {
    const root = await packageWithContextDesign();
    const result = await generateContextFiles(root);
    const markdown = await readFile(result.context, 'utf8');

    expect(markdown).toMatch(/Provider: `figma`/);
    expect(markdown).toMatch(/Payment Result/);
    expect(markdown).toMatch(/1440 × 900/);
    expect(markdown).toMatch(/Header/);
    expect(markdown).toMatch(/Payment successful/);
    expect(markdown).not.toMatch(/Do not show|signed\.invalid/);
    expect(markdown).toMatch(/assets\/receipt\.png/);
    expect(markdown.indexOf('screenshot.png')).toBeLessThan(markdown.indexOf('design.json'));
  });

  it('deduplicates styles with usage counts and captures component variants', async () => {
    const root = await packageWithContextDesign();
    const result = await generateContextFiles(root);
    const styles = JSON.parse(await readFile(result.styles, 'utf8')) as Record<string, Array<Record<string, unknown>>>;
    const components = JSON.parse(await readFile(result.components, 'utf8')) as Record<string, unknown[]>;

    expect(styles.colors?.some(({ usageCount }) => usageCount === 3)).toBe(true);
    expect(styles.typography).toHaveLength(1);
    expect(styles.typography?.[0]?.usageCount).toBe(2);
    expect(styles.spacing).not.toHaveLength(0);
    expect(styles.radii).not.toHaveLength(0);
    expect(styles.effects).not.toHaveLength(0);
    expect(components.components?.[0]).toMatchObject({ id: '10:30', name: 'Payment card' });
    expect(components.instances?.[0]).toMatchObject({ id: '10:31', componentRef: '10:30' });
  });

  it('is byte deterministic', async () => {
    const root = await packageWithContextDesign();
    const firstPaths = await generateContextFiles(root);
    const first = await Promise.all(Object.values(firstPaths).map((path) => readFile(path)));
    const secondPaths = await generateContextFiles(root);
    const second = await Promise.all(Object.values(secondPaths).map((path) => readFile(path)));

    expect(second).toEqual(first);
  });
});
