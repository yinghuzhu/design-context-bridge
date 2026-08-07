import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Diagnostic, PackageValidation } from './models.js';
import {
  buildFingerprint,
  publishStaging,
  type PackageManifestV1,
  validatePackage,
} from './package.js';
import type { SourceRegistry } from '../sources/registry.js';
import type { ExportFormat } from '../sources/types.js';

export interface PreparePackageOptions {
  outputRoot: string;
  provider?: string;
  format?: ExportFormat;
  scale?: number;
  force?: boolean;
}

export interface PreparePackageResult {
  packageDirectory: string;
  validation: PackageValidation;
  cacheHit: boolean;
  provider: string;
}

export async function preparePackage(
  sourceUrl: string,
  registry: SourceRegistry,
  options: PreparePackageOptions,
): Promise<PreparePackageResult> {
  const format = options.format ?? 'png';
  const scale = options.scale ?? 2;
  if (!['png', 'jpg', 'svg'].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  if (!Number.isInteger(scale) || scale < 1) throw new Error('Export scale must be a positive integer');
  const { adapter, target } = registry.resolve(sourceUrl, options.provider);
  const outputRoot = resolve(options.outputRoot);
  const destination = join(outputRoot, target.cacheKey);
  const fingerprint = buildFingerprint(target, format, scale);
  if (options.force !== true) {
    const cached = await matchingCache(destination, fingerprint);
    if (cached !== null) {
      return { packageDirectory: destination, validation: cached, cacheHit: true, provider: target.provider };
    }
  }

  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, `.${target.cacheKey}.staging-`));
  try {
    const prepared = await adapter.prepare(target, { format, scale });
    await mkdir(join(staging, 'source'), { recursive: true });
    await mkdir(join(staging, 'assets'), { recursive: true });
    await writeJson(join(staging, 'source', 'raw.json'), prepared.raw);
    await writeJson(join(staging, 'design.json'), prepared.design);

    const screenshot = `screenshot.${format}`;
    try {
      await adapter.download(prepared.screenshot, join(staging, screenshot));
    } catch {
      throw new Error(`Root screenshot download failed for node ${target.nodeId}`);
    }

    const diagnostics = prepared.diagnostics.map(sanitizeDiagnostic);
    const files: PackageManifestV1['files'] = {};
    for (const [index, asset] of prepared.assets.entries()) {
      const relativePath = `assets/${String(index + 1).padStart(3, '0')}_${safeName(asset.name)}_${safeName(asset.id.replaceAll(':', '-'))}.${format}`;
      try {
        await adapter.download(asset, join(staging, relativePath));
        files[asset.id] = { name: asset.name, type: asset.type, file: relativePath };
      } catch {
        diagnostics.push({
          code: 'asset_download_failed',
          message: `Failed to download exported asset for node ${asset.id}`,
          retryable: true,
          nodeId: asset.id,
        });
      }
    }

    const manifest: PackageManifestV1 = {
      schemaVersion: 1,
      source: {
        provider: target.provider,
        url: target.sourceUrl,
        documentId: target.documentId,
        nodeId: target.nodeId,
      },
      document: 'design.json',
      rawSource: 'source/raw.json',
      screenshot,
      export: { format, scale },
      fingerprint,
      status: diagnostics.length === 0 ? 'complete' : 'partial',
      files,
      diagnostics,
    };
    await writeJson(join(staging, 'manifest.json'), manifest);
    await writeFile(join(staging, 'README.md'), packageReadme(manifest), 'utf8');
    const validation = await publishStaging(staging, destination);
    return { packageDirectory: destination, validation, cacheHit: false, provider: target.provider };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function matchingCache(directory: string, fingerprint: string): Promise<PackageValidation | null> {
  const validation = await validatePackage(directory);
  if (validation.status === 'invalid') return null;
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as unknown;
    if (!isRecord(manifest) || manifest.fingerprint !== fingerprint) return null;
    return validation;
  } catch {
    return null;
  }
}

function packageReadme(manifest: PackageManifestV1): string {
  return `# Design context package\n\n- Provider: \`${manifest.source.provider}\`\n- Document: \`${manifest.source.documentId}\`\n- Node: \`${manifest.source.nodeId}\`\n- Source: ${manifest.source.url}\n- Screenshot: \`${manifest.screenshot}\`\n- Package status: \`${manifest.status}\`\n- Export: \`${manifest.export.format}\` at ${manifest.export.scale}x\n- Assets: ${Object.keys(manifest.files).length}\n- Diagnostics: ${manifest.diagnostics.length}\n\n## Agent usage\n\n1. Inspect the screenshot as the visual source of truth.\n2. Use \`design.json\` for normalized geometry, text, styles, and component relationships.\n3. Reuse local files under \`assets/\`; never depend on temporary provider URLs.\n`;
}

function sanitizeDiagnostic(value: Diagnostic): Diagnostic {
  return {
    ...value,
    message: value.message
      .replace(/https?:\/\/\S+/giu, '[REDACTED_URL]')
      .replace(/((?:access_)?token|authorization|secret)=([^&\s]+)/giu, '$1=[REDACTED]'),
  };
}

function safeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/gu, '').slice(0, 50) || 'untitled';
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(sortJson(value), null, 2)}\n`, 'utf8');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
