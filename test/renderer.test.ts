import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DesignTarget } from '../src/core/models.js';
import { buildFingerprint } from '../src/core/package.js';
import { renderPackage } from '../src/core/renderer.js';

async function makePackage(screenshot = 'screenshot.jpg', rootBounds: unknown = { x: 100, y: 200, width: 640, height: 480 }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'design-context-renderer-'));
  await mkdir(join(root, 'source'), { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, screenshot), 'screenshot');
  await writeFile(join(root, 'source', 'raw.json'), '{}');
  await writeFile(join(root, 'assets', 'photo.png'), 'photo');
  await writeFile(join(root, 'assets', 'icon.svg'), '<svg/>');
  const design = {
    provider: 'figma', documentId: 'file', rootId: '10:20', nodes: {
      '10:20': { id: '10:20', name: 'Payment <Result> & "Receipt"', type: 'FRAME', visible: true, bounds: rootBounds, children: ['10:21', '10:24', '10:25'], style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
      '10:21': { id: '10:21', name: 'Panel', type: 'FRAME', visible: true, bounds: { x: 120, y: 230, width: 300, height: 200 }, children: ['10:22', '10:23'], style: { cornerRadius: 8, strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }], strokeWeight: 2, effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 1, y: 2 }, radius: 3 }] } },
      '10:22': { id: '10:22', name: 'Text', type: 'TEXT', visible: true, bounds: { x: 130, y: 240, width: 180, height: 24 }, children: [], text: { characters: '<Pay & "continue">\nNow', style: { fontSize: 16, lineHeightPx: 20, fontFamily: "A'B" } }, style: { fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }] } },
      '10:23': { id: '10:23', name: 'Photo', type: 'RECTANGLE', visible: true, bounds: { x: 140, y: 270, width: 80, height: 60 }, children: [], assetRef: '10:23', style: {} },
      '10:24': { id: '10:24', name: 'Icon', type: 'VECTOR', visible: true, bounds: { x: 500, y: 220, width: 24, height: 24 }, children: [], assetRef: '10:24', style: {} },
      '10:25': { id: '10:25', name: 'Hidden', type: 'TEXT', visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 }, children: [], text: { characters: 'DO NOT RENDER', style: {} }, style: {} },
    },
  };
  const target: DesignTarget = { provider: 'figma', documentId: 'file', nodeId: '10:20', sourceUrl: 'https://www.figma.com/design/file/Page?node-id=10-20', cacheKey: 'figma_file_10-20' };
  const manifest = {
    schemaVersion: 1, source: { provider: 'figma', url: target.sourceUrl, documentId: 'file', nodeId: '10:20' }, document: 'design.json', rawSource: 'source/raw.json', screenshot,
    export: { format: screenshot.endsWith('.svg') ? 'svg' : screenshot.endsWith('.jpg') ? 'jpg' : 'png', scale: 2 }, fingerprint: buildFingerprint(target, screenshot.endsWith('.svg') ? 'svg' : screenshot.endsWith('.jpg') ? 'jpg' : 'png', 2), status: 'complete',
    files: { '10:23': { name: 'Photo', type: 'RECTANGLE', file: 'assets/photo.png' }, '10:24': { name: 'Icon', type: 'VECTOR', file: 'assets/icon.svg' } }, diagnostics: [],
  };
  await writeFile(join(root, 'design.json'), JSON.stringify(design));
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

describe('renderPackage', () => {
  it('renders relative coordinates, styles, escaped text, and local assets', async () => {
    const root = await makePackage();
    const result = await renderPackage(root);
    const html = await readFile(result.htmlPath, 'utf8');

    expect(result).toMatchObject({ width: 640, height: 480, comparePath: null });
    expect(html).toContain('left:20px;top:30px;width:300px;height:200px');
    expect(html).toContain('left:10px;top:10px;width:180px;height:24px');
    expect(html).toContain('&lt;Pay &amp; &quot;continue&quot;&gt;<br>Now');
    expect(html).toContain('<title>Payment &lt;Result&gt; &amp; &quot;Receipt&quot;</title>');
    expect(html).toContain('border-radius:8px');
    expect(html).toContain('border:2px solid rgb(0,0,0)');
    expect(html).toContain('box-shadow:1px 2px 3px 0px rgba(0,0,0,0.2)');
    expect(html).toContain('<img src="assets/photo.png"');
    expect(html).toContain('<img src="assets/icon.svg"');
    expect(html).not.toContain('DO NOT RENDER');
  });

  it.each(['screenshot.jpg', 'screenshot.svg'])('uses manifest screenshot %s in comparison HTML', async (screenshot) => {
    const root = await makePackage(screenshot);
    const result = await renderPackage(root, { compare: true });
    const comparison = await readFile(result.comparePath ?? '', 'utf8');

    expect(comparison).toContain(`src="${screenshot}"`);
    expect(comparison).toContain(`Original ${screenshot}`);
  });

  it('raises a typed error for a root without bounds', async () => {
    const root = await makePackage('screenshot.png', null);

    await expect(renderPackage(root)).rejects.toMatchObject({ code: 'missing_bounds' });
  });
});

it('keeps all Core modules independent from Figma implementation imports', async () => {
  const core = join(import.meta.dirname, '..', 'src', 'core');
  for (const filename of await readdir(core)) {
    const source = await readFile(join(core, filename), 'utf8');
    expect(source, filename).not.toMatch(/sources\/figma/);
  }
});
