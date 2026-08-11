import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  rename as renamePath,
  rm,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import type {
  DesignDocument,
  DesignTarget,
  Diagnostic,
  PackageStatus,
  PackageValidation,
} from './models.js';
import type { ExportFormat } from '../sources/types.js';

export const SCHEMA_VERSION = 1 as const;

const LOW_INFORMATION_PRIMITIVE_TYPES = new Set([
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'STAR',
]);

export interface PackageManifestV1 {
  schemaVersion: 1;
  source: {
    provider: string;
    url: string;
    documentId: string;
    nodeId: string;
  };
  document: string;
  rawSource: string;
  screenshot: string;
  export: { format: ExportFormat; scale: number };
  fingerprint: string;
  status: PackageStatus;
  files: Record<string, { name: string; type: string; file: string }>;
  diagnostics: Diagnostic[];
}

export interface PublishOperations {
  rename(source: string, destination: string): Promise<void>;
}

export function buildFingerprint(
  target: DesignTarget,
  format: ExportFormat,
  scale: number,
): string {
  const payload = JSON.stringify({
    documentId: target.documentId,
    format,
    nodeId: target.nodeId,
    provider: target.provider,
    scale,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function diagnoseDesignScope(document: DesignDocument): Diagnostic[] {
  const root = document.nodes[document.rootId];
  if (
    root === undefined ||
    !LOW_INFORMATION_PRIMITIVE_TYPES.has(root.type) ||
    root.children.length > 0 ||
    (root.text !== undefined && root.text.characters.trim().length > 0) ||
    root.assetRef !== undefined
  ) {
    return [];
  }
  return [{
    code: 'design_scope_suspicious',
    message: `Selected design root ${root.id} is a leaf ${root.type} with no child nodes, text, or exportable assets. Select a containing frame, group, section, or component, or explicitly confirm that a primitive-only design is intended.`,
    retryable: false,
    nodeId: root.id,
  }];
}

export async function validatePackage(
  packageDirectory: string,
): Promise<PackageValidation> {
  const root = resolve(packageDirectory);
  const structural: Diagnostic[] = [];
  const manifestPath = resolve(root, 'manifest.json');
  const manifestValue = await readJsonFile(
    manifestPath,
    structural,
    'missing_manifest',
    'malformed_manifest',
  );
  const manifest = parseManifest(manifestValue, structural);
  if (manifest === null) {
    return { status: 'invalid', diagnostics: structural };
  }

  const manifestDiagnostics = manifest.diagnostics.map((item) => ({
    ...item,
    message: sanitizeMessage(item.message),
  }));

  const documentPath = await requiredPackagePath(
    root,
    manifest.document,
    'document',
    structural,
  );
  const rawSourcePath = await requiredPackagePath(
    root,
    manifest.rawSource,
    'raw_source',
    structural,
  );
  await requiredPackagePath(
    root,
    manifest.screenshot,
    'screenshot',
    structural,
  );

  let design: DesignDocument | null = null;
  if (documentPath !== null) {
    design = parseDesignDocument(
      await readJsonFile(
        documentPath,
        structural,
        'missing_document',
        'malformed_document',
      ),
      structural,
    );
  }
  if (rawSourcePath !== null) {
    await readJsonFile(
      rawSourcePath,
      structural,
      'missing_raw_source',
      'malformed_raw_source',
    );
  }
  if (design !== null && !hasOwn(design.nodes, design.rootId)) {
    structural.push(
      diagnostic(
        'missing_root',
        `design document is missing root node ${design.rootId}`,
      ),
    );
  }
  if (
    design !== null &&
    (design.provider !== manifest.source.provider ||
      design.documentId !== manifest.source.documentId)
  ) {
    structural.push(
      diagnostic(
        'source_mismatch',
        'design document provider or documentId does not match the manifest',
      ),
    );
  }
  const scopeDiagnostics = design === null ? [] : diagnoseDesignScope(design);

  const assetDiagnostics: Diagnostic[] = [];
  for (const [nodeId, entry] of Object.entries(manifest.files)) {
    const result = await inspectPackagePath(root, entry.file);
    if (!result.safe) {
      structural.push(
        diagnostic('unsafe_path', `Unsafe asset path: ${entry.file}`, false, nodeId),
      );
    } else if (!result.exists) {
      assetDiagnostics.push(
        diagnostic(
          'asset_missing',
          `Declared asset is missing: ${entry.file}`,
          true,
          nodeId,
        ),
      );
    }
  }

  if (structural.length > 0 || manifest.status === 'invalid') {
    return {
      status: 'invalid',
      diagnostics: deduplicateDiagnostics([
        ...structural,
        ...manifestDiagnostics,
        ...scopeDiagnostics,
        ...assetDiagnostics,
      ]),
    };
  }
  return {
    status: assetDiagnostics.length > 0 || scopeDiagnostics.length > 0
      ? 'partial'
      : manifest.status,
    diagnostics: deduplicateDiagnostics([
      ...manifestDiagnostics,
      ...scopeDiagnostics,
      ...assetDiagnostics,
    ]),
  };
}

function deduplicateDiagnostics(values: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify([
      value.code,
      value.message,
      value.retryable,
      value.nodeId,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function publishStaging(
  stagingDirectory: string,
  destinationDirectory: string,
  operations: PublishOperations = { rename: renamePath },
): Promise<PackageValidation> {
  const staging = resolve(stagingDirectory);
  const destination = resolve(destinationDirectory);
  if (staging === destination) {
    throw new Error('Staging and destination directories must be different');
  }
  if (dirname(staging) !== dirname(destination)) {
    throw new Error('Staging must be a sibling of the destination');
  }

  const validation = await validatePackage(staging);
  if (validation.status === 'invalid') {
    throw new Error('Cannot publish an invalid design context package');
  }

  const backup = resolve(
    dirname(destination),
    `.${basename(destination)}.backup-${randomUUID()}`,
  );
  let backupCreated = false;
  try {
    if (await pathExists(destination)) {
      await operations.rename(destination, backup);
      backupCreated = true;
    }
    await operations.rename(staging, destination);
  } catch (error) {
    if (backupCreated) {
      await operations.rename(backup, destination);
    }
    throw error;
  }

  if (backupCreated) {
    await rm(backup, { recursive: true, force: false });
  }
  return validation;
}

async function requiredPackagePath(
  root: string,
  value: string,
  label: string,
  diagnostics: Diagnostic[],
): Promise<string | null> {
  const result = await inspectPackagePath(root, value);
  if (!result.safe) {
    diagnostics.push(diagnostic('unsafe_path', `Unsafe ${label} path: ${value}`));
    return null;
  }
  if (!result.exists) {
    diagnostics.push(
      diagnostic(`missing_${label}`, `Required ${label} file is missing: ${value}`),
    );
    return null;
  }
  return result.path;
}

async function inspectPackagePath(
  root: string,
  value: string,
): Promise<{ path: string; safe: boolean; exists: boolean }> {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    return { path: resolve(root, value), safe: false, exists: false };
  }
  const path = resolve(root, value);
  if (!isWithin(root, path) || path === root) {
    return { path, safe: false, exists: false };
  }

  const rootReal = await realpath(root).catch(() => root);
  try {
    const targetReal = await realpath(path);
    return { path, safe: isWithin(rootReal, targetReal), exists: true };
  } catch (error) {
    if (!isMissingError(error)) {
      return { path, safe: false, exists: false };
    }
    const parentReal = await nearestExistingRealPath(dirname(path));
    return {
      path,
      safe: parentReal !== null && isWithin(rootReal, parentReal),
      exists: false,
    };
  }
}

async function nearestExistingRealPath(path: string): Promise<string | null> {
  let candidate = path;
  for (;;) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (!isMissingError(error)) {
        return null;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        return null;
      }
      candidate = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const difference = relative(root, target);
  return (
    difference === '' ||
    (!difference.startsWith('..') && !isAbsolute(difference))
  );
}

async function readJsonFile(
  path: string,
  diagnostics: Diagnostic[],
  missingCode: string,
  malformedCode: string,
): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    diagnostics.push(
      diagnostic(
        isMissingError(error) ? missingCode : malformedCode,
        isMissingError(error)
          ? `Required file is missing: ${path.split('/').at(-1) ?? path}`
          : `Cannot read JSON file: ${path.split('/').at(-1) ?? path}`,
      ),
    );
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    diagnostics.push(
      diagnostic(
        malformedCode,
        `File is not valid JSON: ${path.split('/').at(-1) ?? path}`,
      ),
    );
    return null;
  }
}

function parseManifest(
  value: unknown,
  diagnostics: Diagnostic[],
): PackageManifestV1 | null {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('malformed_manifest', 'Manifest must be an object'));
    return null;
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic('unsupported_schema', `Manifest requires schemaVersion ${SCHEMA_VERSION}`),
    );
  }
  const source = value.source;
  if (
    !isRecord(source) ||
    !nonEmptyString(source.provider) ||
    !nonEmptyString(source.url) ||
    !nonEmptyString(source.documentId) ||
    !nonEmptyString(source.nodeId) ||
    !safeSourceUrl(source.url)
  ) {
    diagnostics.push(
      diagnostic('malformed_manifest', 'Manifest source is malformed or unsafe'),
    );
  }
  const exportOptions = value.export;
  if (
    !isRecord(exportOptions) ||
    !['png', 'jpg', 'svg'].includes(String(exportOptions.format)) ||
    !Number.isInteger(exportOptions.scale) ||
    Number(exportOptions.scale) < 1
  ) {
    diagnostics.push(diagnostic('malformed_manifest', 'Manifest export is malformed'));
  }
  if (
    !nonEmptyString(value.document) ||
    !nonEmptyString(value.rawSource) ||
    !nonEmptyString(value.screenshot) ||
    typeof value.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.fingerprint) ||
    !['complete', 'partial', 'invalid'].includes(String(value.status)) ||
    !isRecord(value.files) ||
    !Array.isArray(value.diagnostics)
  ) {
    diagnostics.push(diagnostic('malformed_manifest', 'Manifest fields are malformed'));
    return null;
  }

  const files: PackageManifestV1['files'] = {};
  for (const [nodeId, entry] of Object.entries(value.files)) {
    if (
      !isRecord(entry) ||
      !nonEmptyString(entry.name) ||
      !nonEmptyString(entry.type) ||
      !nonEmptyString(entry.file)
    ) {
      diagnostics.push(
        diagnostic('malformed_manifest', `Manifest asset entry is malformed: ${nodeId}`),
      );
      return null;
    }
    files[nodeId] = { name: entry.name, type: entry.type, file: entry.file };
  }

  const manifestDiagnostics: Diagnostic[] = [];
  for (const item of value.diagnostics) {
    if (
      !isRecord(item) ||
      !nonEmptyString(item.code) ||
      typeof item.message !== 'string' ||
      typeof item.retryable !== 'boolean' ||
      !(item.nodeId === null || typeof item.nodeId === 'string')
    ) {
      diagnostics.push(
        diagnostic('malformed_manifest', 'Manifest diagnostics are malformed'),
      );
      return null;
    }
    manifestDiagnostics.push({
      code: item.code,
      message: item.message,
      retryable: item.retryable,
      nodeId: item.nodeId,
    });
  }

  if (diagnostics.length > 0 || !isRecord(source) || !isRecord(exportOptions)) {
    return null;
  }
  return {
    schemaVersion: 1,
    source: {
      provider: String(source.provider),
      url: String(source.url),
      documentId: String(source.documentId),
      nodeId: String(source.nodeId),
    },
    document: String(value.document),
    rawSource: String(value.rawSource),
    screenshot: String(value.screenshot),
    export: {
      format: exportOptions.format as ExportFormat,
      scale: Number(exportOptions.scale),
    },
    fingerprint: value.fingerprint,
    status: value.status as PackageStatus,
    files,
    diagnostics: manifestDiagnostics,
  };
}

function parseDesignDocument(
  value: unknown,
  diagnostics: Diagnostic[],
): DesignDocument | null {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.provider) ||
    !nonEmptyString(value.documentId) ||
    !nonEmptyString(value.rootId) ||
    !isRecord(value.nodes)
  ) {
    diagnostics.push(
      diagnostic('malformed_document', 'design.json has an invalid root structure'),
    );
    return null;
  }
  for (const [nodeId, node] of Object.entries(value.nodes)) {
    if (!validDesignNode(nodeId, node)) {
      diagnostics.push(
        diagnostic('malformed_document', `design node is malformed: ${nodeId}`),
      );
      return null;
    }
  }
  return value as unknown as DesignDocument;
}

function validDesignNode(nodeId: string, value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.id !== nodeId ||
    !nonEmptyString(value.name) ||
    !nonEmptyString(value.type) ||
    typeof value.visible !== 'boolean' ||
    !Array.isArray(value.children) ||
    !value.children.every((child) => typeof child === 'string') ||
    !isRecord(value.style)
  ) {
    return false;
  }
  if (value.bounds === null) {
    return true;
  }
  if (!isRecord(value.bounds)) {
    return false;
  }
  const bounds = value.bounds;
  return ['x', 'y', 'width', 'height'].every((key) => {
    const number = bounds[key];
    return typeof number === 'number' && Number.isFinite(number);
  });
}

function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const forbidden = new Set([
      'access_token',
      'authorization',
      'figma_token',
      'secret',
      'token',
    ]);
    return [...url.searchParams.keys()].every(
      (key) => !forbidden.has(key.toLowerCase()),
    );
  } catch {
    return false;
  }
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/giu, '[REDACTED_URL]')
    .replace(
      /((?:access_)?token|authorization|secret)=([^&\s]+)/giu,
      '$1=[REDACTED]',
    );
}

function diagnostic(
  code: string,
  message: string,
  retryable = false,
  nodeId: string | null = null,
): Diagnostic {
  return { code, message, retryable, nodeId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
