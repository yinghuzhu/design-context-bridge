import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesignDocument, DesignNode } from './models.js';
import type { PackageManifestV1 } from './package.js';
import { validatePackage } from './package.js';

export interface GeneratedContextFiles {
  context: string;
  styles: string;
  components: string;
}

export async function generateContextFiles(packageDirectory: string): Promise<GeneratedContextFiles> {
  const validation = await validatePackage(packageDirectory);
  if (validation.status === 'invalid') throw new Error('Cannot generate context from an invalid package');
  const manifest = await readJson<PackageManifestV1>(join(packageDirectory, 'manifest.json'));
  const design = await readJson<DesignDocument>(join(packageDirectory, manifest.document));
  const root = design.nodes[design.rootId];
  if (root === undefined) throw new Error(`Design root is missing: ${design.rootId}`);
  const stylesValue = extractStyles(design);
  const componentsValue = extractComponents(design);
  const paths = {
    context: join(packageDirectory, 'AI_CONTEXT.md'),
    styles: join(packageDirectory, 'styles.json'),
    components: join(packageDirectory, 'components.json'),
  };
  await writeFile(paths.context, renderContext(manifest, design, root, componentsValue), 'utf8');
  await writeJson(paths.styles, stylesValue);
  await writeJson(paths.components, componentsValue);
  return paths;
}

export function extractStyles(design: DesignDocument): Record<string, unknown[]> {
  const colors = new Map<string, UsageEntry>();
  const typography = new Map<string, UsageEntry>();
  const spacing = new Map<string, UsageEntry>();
  const radii = new Map<string, UsageEntry>();
  const effects = new Map<string, UsageEntry>();
  for (const node of depthFirst(design)) {
    for (const source of ['fills', 'strokes'] as const) {
      const paints = node.style[source];
      if (Array.isArray(paints)) for (const paint of paints) addUsage(colors, { source, paint }, node.id);
    }
    if (node.text !== undefined && Object.keys(node.text.style).length > 0) addUsage(typography, node.text.style, node.id);
    for (const property of ['itemSpacing', 'padding'] as const) {
      if (node.style[property] !== undefined) addUsage(spacing, { property, value: node.style[property] }, node.id);
    }
    if (node.style.cornerRadius !== undefined || node.style.rectangleCornerRadii !== undefined) {
      addUsage(radii, node.style.cornerRadius ?? node.style.rectangleCornerRadii, node.id);
    }
    const nodeEffects = node.style.effects;
    if (Array.isArray(nodeEffects)) for (const effect of nodeEffects) addUsage(effects, effect, node.id);
  }
  return {
    colors: finalize(colors),
    typography: finalize(typography),
    spacing: finalize(spacing),
    radii: finalize(radii),
    effects: finalize(effects),
  };
}

export function extractComponents(design: DesignDocument): Record<string, unknown[]> {
  const components: Record<string, unknown>[] = [];
  const componentSets: Record<string, unknown>[] = [];
  const instances: Record<string, unknown>[] = [];
  const referenced = new Set<string>();
  for (const node of Object.values(design.nodes)) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      const entry = {
        id: node.id,
        name: node.name,
        type: node.type,
        ...(node.style.componentPropertyDefinitions === undefined ? {} : { componentPropertyDefinitions: node.style.componentPropertyDefinitions }),
      };
      (node.type === 'COMPONENT' ? components : componentSets).push(entry);
    } else if (node.type === 'INSTANCE') {
      instances.push({
        id: node.id,
        name: node.name,
        componentRef: node.componentRef ?? null,
        componentProperties: node.componentProperties ?? {},
      });
      if (node.componentRef !== undefined) referenced.add(node.componentRef);
    }
  }
  const byId = (left: Record<string, unknown>, right: Record<string, unknown>) => String(left.id).localeCompare(String(right.id));
  return {
    components: components.sort(byId),
    componentSets: componentSets.sort(byId),
    instances: instances.sort(byId),
    referencedComponentIds: [...referenced].sort(),
  };
}

interface UsageEntry { value: unknown; nodeIds: Set<string> }

function addUsage(target: Map<string, UsageEntry>, value: unknown, nodeId: string): void {
  const key = stableStringify(value);
  const entry = target.get(key) ?? { value: sortJson(value), nodeIds: new Set<string>() };
  entry.nodeIds.add(nodeId);
  target.set(key, entry);
}

function finalize(values: Map<string, UsageEntry>): unknown[] {
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => ({
    value: entry.value,
    usageCount: entry.nodeIds.size,
    nodeIds: [...entry.nodeIds].sort(),
  }));
}

function renderContext(
  manifest: PackageManifestV1,
  design: DesignDocument,
  root: DesignNode,
  components: Record<string, unknown[]>,
): string {
  const dimensions = root.bounds === null ? 'not available' : `${display(root.bounds.width)} × ${display(root.bounds.height)}`;
  const lines = [
    `# Design Context: ${markdown(root.name)}`,
    '',
    'Deterministic navigation summary for a multimodal AI Agent.',
    '',
    '## Source-of-truth priority',
    '',
    `1. \`${manifest.screenshot}\` — visual source of truth.`,
    `2. \`${manifest.document}\` — normalized geometry, text, style, component, and asset references.`,
    '3. `assets/` — downloaded media and vectors.',
    '4. `AI_CONTEXT.md`, `styles.json`, and `components.json` — bounded navigation and reuse aids.',
    '5. Renderer output — auxiliary observation only; never visual acceptance evidence.',
    '',
    '## Page summary',
    '',
    `- Provider: \`${markdown(manifest.source.provider)}\``,
    `- Root: **${markdown(root.name)}** (\`${markdown(root.id)}\`)`,
    `- Type: \`${markdown(root.type)}\``,
    `- Dimensions: **${dimensions}**`,
    '',
    '## Top-level regions',
    '',
  ];
  const regions = root.children.map((id) => design.nodes[id]).filter((node): node is DesignNode => node !== undefined && node.visible);
  if (regions.length === 0) lines.push('- No visible top-level regions.');
  else for (const node of regions) lines.push(`- \`${markdown(node.id)}\` **${markdown(node.name)}** (${markdown(node.type)})${node.bounds === null ? '' : ` — ${display(node.bounds.width)} × ${display(node.bounds.height)}`}`);
  lines.push('', '## Visible text', '');
  const visibleText = effectivelyVisible(design).filter((node) => node.text?.characters);
  if (visibleText.length === 0) lines.push('- No visible text nodes.');
  else for (const node of visibleText.sort((a, b) => a.id.localeCompare(b.id))) lines.push(`- \`${markdown(node.id)}\` **${markdown(node.name)}**: ${markdown(node.text?.characters ?? '')}`);
  lines.push('', '## Components', '');
  lines.push(`- Definitions: ${(components.components?.length ?? 0) + (components.componentSets?.length ?? 0)}; instances: ${components.instances?.length ?? 0}.`);
  for (const value of [...(components.components ?? []), ...(components.componentSets ?? [])] as Record<string, unknown>[]) lines.push(`- ${markdown(String(value.type))} \`${markdown(String(value.id))}\`: ${markdown(String(value.name))}`);
  for (const value of components.instances as Record<string, unknown>[]) lines.push(`- Instance \`${markdown(String(value.id))}\` → \`${markdown(String(value.componentRef ?? 'unresolved'))}\``);
  lines.push('', '## Assets', '');
  const assets = Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right));
  if (assets.length === 0) lines.push('- No exported assets.');
  else for (const [id, asset] of assets) lines.push(`- \`${markdown(id)}\` ${markdown(asset.name)}: \`${markdown(asset.file)}\``);
  lines.push('', '## Implementation boundary', '', '- Inspect the screenshot first, then read only relevant normalized nodes.', '- Use local assets; never persist or reuse temporary provider URLs.', '- Preserve target routes, APIs, data flow, interactions, validation, and error behavior.', '');
  return lines.join('\n');
}

function depthFirst(design: DesignDocument): DesignNode[] {
  const result: DesignNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = design.nodes[id];
    if (node === undefined) return;
    result.push(node);
    for (const child of node.children) visit(child);
  };
  visit(design.rootId);
  return result;
}

function effectivelyVisible(design: DesignDocument): DesignNode[] {
  const result: DesignNode[] = [];
  const visit = (id: string, parentVisible: boolean) => {
    const node = design.nodes[id];
    if (node === undefined) return;
    const visible = parentVisible && node.visible;
    if (visible) result.push(node);
    for (const child of node.children) visit(child, visible);
  };
  visit(design.rootId, true);
  return result;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${stableStringify(value, 2)}\n`, 'utf8');
}

function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortJson(value), null, space);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
}

function markdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function display(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
