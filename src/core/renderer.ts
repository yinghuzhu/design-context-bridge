import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type { DesignBounds, DesignDocument, DesignNode } from './models.js';
import type { PackageManifestV1 } from './package.js';
import { validatePackage } from './package.js';

export class PackageRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PackageRenderError';
    this.code = code;
  }
}

export interface RenderOptions {
  output?: string;
  compare?: boolean;
}

export interface RenderResult {
  htmlPath: string;
  comparePath: string | null;
  width: number;
  height: number;
}

export async function renderPackage(
  packageDirectory: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const packageRoot = resolve(packageDirectory);
  const validation = await validatePackage(packageRoot);
  if (validation.status === 'invalid') {
    throw new PackageRenderError(
      validation.diagnostics[0]?.code ?? 'invalid_package',
      'context package validation failed',
    );
  }
  const manifest = await loadJson<PackageManifestV1>(join(packageRoot, 'manifest.json'));
  const design = await loadJson<DesignDocument>(join(packageRoot, manifest.document));
  const root = design.nodes[design.rootId];
  if (root === undefined) throw new PackageRenderError('missing_root', `design is missing root ${design.rootId}`);
  if (root.bounds === null) throw new PackageRenderError('missing_bounds', 'selected root is missing bounds');
  const htmlPath = resolve(options.output ?? join(packageRoot, 'reconstruct.html'));
  await mkdir(dirname(htmlPath), { recursive: true });
  const packagePrefix = webPath(relative(dirname(htmlPath), packageRoot));
  const body = renderNode(root, root.bounds, design, manifest, packagePrefix);
  const background = fillsBackground(root.style.fills) ?? '#fff';
  await writeFile(htmlPath, standaloneHtml(root.name, root.bounds, background, body), 'utf8');

  let comparePath: string | null = null;
  if (options.compare === true) {
    comparePath = join(dirname(htmlPath), 'compare.html');
    const screenshot = prefixed(packagePrefix, manifest.screenshot);
    await writeFile(
      comparePath,
      comparisonHtml(root.name, manifest.screenshot, screenshot, root.bounds, background, body),
      'utf8',
    );
  }
  return {
    htmlPath,
    comparePath,
    width: root.bounds.width,
    height: root.bounds.height,
  };
}

function renderNode(
  node: DesignNode,
  parentBounds: DesignBounds,
  design: DesignDocument,
  manifest: PackageManifestV1,
  packagePrefix: string,
): string {
  if (!node.visible || node.bounds === null || node.bounds.width <= 0 || node.bounds.height <= 0) return '';
  const left = nearZero(node.bounds.x - parentBounds.x);
  const top = nearZero(node.bounds.y - parentBounds.y);
  const geometry = `left:${number(left)}px;top:${number(top)}px;width:${number(node.bounds.width)}px;height:${number(node.bounds.height)}px`;
  const attributes = `data-id="${html(node.id)}" data-type="${html(node.type)}"`;
  const asset = manifest.files[node.assetRef ?? node.id];
  if (node.assetRef !== undefined && asset !== undefined) {
    return `<div class="abs" style="${geometry}" ${attributes}><img src="${html(prefixed(packagePrefix, asset.file))}" alt="" style="width:100%;height:100%;display:block;object-fit:fill"></div>`;
  }
  if (node.type === 'TEXT') {
    const text = html(node.text?.characters ?? '').replaceAll(/\r?\n/g, '<br>');
    const textCss = textStyle(node.text?.style ?? {});
    const color = firstSolidColor(node.style.fills) ?? '#000';
    return `<div class="abs" style="${geometry};${textCss}color:${color};white-space:pre-wrap" ${attributes}>${text}</div>`;
  }
  const style = [geometry];
  const background = fillsBackground(node.style.fills);
  if (background !== null) style.push(`background:${background}`);
  const radius = cornerRadius(node.style);
  if (radius !== null) style.push(`border-radius:${radius}`);
  const border = strokeBorder(node.style);
  if (border !== null) style.push(`border:${border}`);
  const shadow = effectsShadow(node.style.effects);
  if (shadow !== null) style.push(`box-shadow:${shadow}`);
  if (node.style.clipsContent === true) style.push('overflow:hidden');
  const opacity = finite(node.style.opacity);
  if (opacity !== null && opacity < 1) style.push(`opacity:${number(opacity)}`);
  const children = node.children
    .map((id) => design.nodes[id])
    .filter((child): child is DesignNode => child !== undefined)
    .map((child) => renderNode(child, node.bounds as DesignBounds, design, manifest, packagePrefix))
    .join('');
  return `<div class="abs" style="${style.join(';')}" ${attributes}>${children}</div>`;
}

function standaloneHtml(name: string, bounds: DesignBounds, background: string, body: string): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(name)}</title><style>*{box-sizing:border-box}html,body{margin:0;background:#ddd}.canvas{position:relative;overflow:hidden;margin:0 auto}.abs{position:absolute}</style></head><body><main class="canvas" style="width:${number(bounds.width)}px;height:${number(bounds.height)}px;background:${background}">${body}</main></body></html>\n`;
}

function comparisonHtml(
  name: string,
  screenshotName: string,
  screenshotSource: string,
  bounds: DesignBounds,
  background: string,
  body: string,
): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>Compare ${html(name)}</title><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif;background:#ddd}.grid{display:flex;gap:24px;padding:24px;align-items:flex-start}.panel h2{margin:0 0 8px}.canvas{position:relative;overflow:hidden}.abs{position:absolute}img.original{display:block;width:${number(bounds.width)}px;height:${number(bounds.height)}px;object-fit:contain}</style></head><body><div class="grid"><section class="panel"><h2>Original ${html(screenshotName)}</h2><img class="original" src="${html(screenshotSource)}" alt="Original design"></section><section class="panel"><h2>Auxiliary render</h2><main class="canvas" style="width:${number(bounds.width)}px;height:${number(bounds.height)}px;background:${background}">${body}</main></section></div></body></html>\n`;
}

function fillsBackground(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const layers: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.visible === false) continue;
    if (item.type === 'SOLID' && isRecord(item.color)) {
      layers.push(color(item.color, finite(item.opacity) ?? 1));
    } else if ((item.type === 'GRADIENT_LINEAR' || item.type === 'GRADIENT_RADIAL') && Array.isArray(item.gradientStops)) {
      const stops = item.gradientStops.filter(isRecord).map((stop) => `${isRecord(stop.color) ? color(stop.color) : '#000'} ${number((finite(stop.position) ?? 0) * 100)}%`).join(', ');
      layers.push(item.type === 'GRADIENT_LINEAR' ? `linear-gradient(90deg, ${stops})` : `radial-gradient(circle, ${stops})`);
    }
  }
  return layers.length === 0 ? null : layers.reverse().join(', ');
}

function firstSolidColor(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const paint = value.find((item) => isRecord(item) && item.type === 'SOLID' && item.visible !== false && isRecord(item.color));
  return isRecord(paint) && isRecord(paint.color) ? color(paint.color, finite(paint.opacity) ?? 1) : null;
}

function color(value: Record<string, unknown>, opacity = 1): string {
  const red = Math.round((finite(value.r) ?? 0) * 255);
  const green = Math.round((finite(value.g) ?? 0) * 255);
  const blue = Math.round((finite(value.b) ?? 0) * 255);
  const alpha = (finite(value.a) ?? 1) * opacity;
  return alpha >= 1 ? `rgb(${red},${green},${blue})` : `rgba(${red},${green},${blue},${number(alpha)})`;
}

function cornerRadius(style: Record<string, unknown>): string | null {
  if (Array.isArray(style.rectangleCornerRadii)) {
    const radii = style.rectangleCornerRadii.map(finite);
    if (radii.every((value) => value !== null)) return radii.map((value) => `${number(value ?? 0)}px`).join(' ');
  }
  const radius = finite(style.cornerRadius);
  return radius === null ? null : `${number(radius)}px`;
}

function strokeBorder(style: Record<string, unknown>): string | null {
  if (!Array.isArray(style.strokes)) return null;
  const stroke = style.strokes.find((item) => isRecord(item) && item.visible !== false && isRecord(item.color));
  if (!isRecord(stroke) || !isRecord(stroke.color)) return null;
  return `${number(finite(style.strokeWeight) ?? 1)}px solid ${color(stroke.color, finite(stroke.opacity) ?? 1)}`;
}

function effectsShadow(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const shadows: string[] = [];
  for (const effect of value) {
    if (!isRecord(effect) || effect.visible === false || !['DROP_SHADOW', 'INNER_SHADOW'].includes(String(effect.type))) continue;
    const offset = isRecord(effect.offset) ? effect.offset : {};
    const prefix = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
    shadows.push(`${prefix}${number(finite(offset.x) ?? 0)}px ${number(finite(offset.y) ?? 0)}px ${number(finite(effect.radius) ?? 0)}px ${number(finite(effect.spread) ?? 0)}px ${isRecord(effect.color) ? color(effect.color) : '#000'}`);
  }
  return shadows.length === 0 ? null : shadows.join(', ');
}

function textStyle(style: Record<string, unknown>): string {
  const family = typeof style.fontFamily === 'string' ? style.fontFamily.replaceAll('\\', '\\\\').replaceAll("'", "\\'") : 'sans-serif';
  const size = finite(style.fontSize) ?? 14;
  const lineHeight = finite(style.lineHeightPx) ?? size * 1.2;
  const align = typeof style.textAlignHorizontal === 'string' ? style.textAlignHorizontal.toLowerCase() : 'left';
  return `font-family:'${family}',sans-serif;font-size:${number(size)}px;font-weight:${number(finite(style.fontWeight) ?? 400)};line-height:${number(lineHeight)}px;letter-spacing:${number(finite(style.letterSpacing) ?? 0)}px;text-align:${html(align)};`;
}

async function loadJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    throw new PackageRenderError('invalid_json', `cannot read ${path.split('/').at(-1) ?? path}`);
  }
}

function prefixed(prefix: string, path: string): string {
  return prefix.length === 0 ? webPath(path) : `${prefix}/${webPath(path)}`;
}

function webPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function html(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function number(value: number): string {
  return String(Number(value.toFixed(3)));
}

function nearZero(value: number): number {
  return Math.abs(value) < 0.0005 ? 0 : value;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
