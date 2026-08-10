import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename as renamePath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type { Diagnostic } from './models.js';
import { resolveWorkspace, type WorkspacePaths, type WorkspaceResolveOptions } from './workspace.js';

export const MIGRATION_SCHEMA_VERSION = 1 as const;
export const MIGRATION_STATE_DIRECTORY = '.design-context';
export const MIGRATION_STATE_FILENAME = 'migration.json';

export interface ApprovedReference {
  route: string;
  implementation: string;
  designUrl?: string;
  approvedByUser: true;
  [key: string]: unknown;
}

export interface MigrationState {
  schemaVersion: 1;
  targets: Array<Record<string, unknown>>;
  approvedReferences: ApprovedReference[];
  legacyBehaviorSources: unknown[];
  protected: unknown[];
  validations: unknown[];
}

export interface MigrationWriteOperations {
  rename(source: string, destination: string): Promise<void>;
}

export interface MigrationOptions extends WorkspaceResolveOptions {
  operations?: MigrationWriteOperations;
}

export interface MigrationOperationResult {
  state: MigrationState;
  workspace: WorkspacePaths;
  diagnostics: Diagnostic[];
}

export class MigrationStateConflictError extends Error {
  constructor() {
    super('External and repository migration states differ; resolve the conflict before continuing');
    this.name = 'MigrationStateConflictError';
  }
}

const TOP_LEVEL_KEYS = [
  'approvedReferences',
  'legacyBehaviorSources',
  'protected',
  'schemaVersion',
  'targets',
  'validations',
] as const;

export function emptyMigrationState(): MigrationState {
  return {
    schemaVersion: 1,
    targets: [],
    approvedReferences: [],
    legacyBehaviorSources: [],
    protected: [],
    validations: [],
  };
}

export function validateMigrationState(value: unknown): MigrationState {
  rejectCredentialData(value);
  if (!isRecord(value)) throw new Error('Migration state must be a JSON object');
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...TOP_LEVEL_KEYS])) {
    throw new Error('Migration state must contain exactly the schema v1 top-level keys');
  }
  if (value.schemaVersion !== MIGRATION_SCHEMA_VERSION) throw new Error('schemaVersion must be 1');
  for (const field of ['targets', 'approvedReferences', 'legacyBehaviorSources', 'protected', 'validations'] as const) {
    if (!Array.isArray(value[field])) throw new Error(`${field} must be an array`);
  }
  for (const [index, reference] of (value.approvedReferences as unknown[]).entries()) {
    if (!isRecord(reference)) throw new Error(`approvedReferences[${index}] must be an object`);
    for (const field of ['route', 'implementation'] as const) {
      if (!nonEmptyString(reference[field])) throw new Error(`approvedReferences[${index}].${field} must be a non-empty string`);
    }
    if (reference.designUrl !== undefined && !nonEmptyString(reference.designUrl)) {
      throw new Error(`approvedReferences[${index}].designUrl must be a non-empty string when provided`);
    }
    if (reference.approvedByUser !== true) throw new Error(`approvedReferences[${index}].approvedByUser must be true`);
  }
  for (const [index, target] of (value.targets as unknown[]).entries()) {
    if (!isRecord(target)) throw new Error(`targets[${index}] must be an object`);
    if (target.status !== 'validated') continue;
    for (const field of ['visualEvidence', 'businessEvidence'] as const) {
      if (!Array.isArray(target[field]) || target[field].length === 0) throw new Error(`targets[${index}].${field} must be a non-empty array`);
    }
    for (const [evidenceIndex, evidence] of (target.visualEvidence as unknown[]).entries()) {
      if (!safeRelativePath(evidence)) {
        throw new Error(`targets[${index}].visualEvidence[${evidenceIndex}] must be a safe relative path`);
      }
    }
    for (const [evidenceIndex, evidence] of (target.businessEvidence as unknown[]).entries()) {
      if (!nonEmptyString(evidence)) {
        throw new Error(`targets[${index}].businessEvidence[${evidenceIndex}] must be a non-empty string`);
      }
    }
  }
  return value as unknown as MigrationState;
}

export async function loadMigrationState(
  targetDirectory: string,
  options: MigrationOptions = {},
): Promise<MigrationOperationResult> {
  const workspace = await resolveWorkspace(targetDirectory, options);
  return reconcileMigrationState(workspace, false, options.operations ?? { rename: renamePath });
}

export async function initializeMigrationState(
  targetDirectory: string,
  options: MigrationOptions | MigrationWriteOperations = {},
): Promise<MigrationOperationResult> {
  const normalized = normalizeOptions(options);
  const workspace = await resolveWorkspace(targetDirectory, normalized);
  try {
    return await reconcileMigrationState(workspace, false, normalized.operations ?? { rename: renamePath });
  } catch (error) {
    if (!isMissingError(error)) throw error;
  }
  const state = emptyMigrationState();
  await mkdir(dirname(workspace.stateFile), { recursive: true });
  await writeMigrationState(workspace.stateFile, state, normalized.operations ?? { rename: renamePath });
  return { state, workspace, diagnostics: [] };
}

export async function importRepositoryMigrationState(
  targetDirectory: string,
  options: MigrationOptions = {},
): Promise<MigrationOperationResult> {
  const workspace = await resolveWorkspace(targetDirectory, options);
  return reconcileMigrationState(workspace, true, options.operations ?? { rename: renamePath });
}

export async function migrationStatePath(
  targetDirectory: string,
  options: WorkspaceResolveOptions = {},
): Promise<string> {
  return (await resolveWorkspace(targetDirectory, options)).stateFile;
}

export function repositoryMigrationStatePath(workspace: WorkspacePaths): string {
  return join(workspace.gitRoot ?? workspace.targetDirectory, MIGRATION_STATE_DIRECTORY, MIGRATION_STATE_FILENAME);
}

async function reconcileMigrationState(
  workspace: WorkspacePaths,
  requireRepositoryState: boolean,
  operations: MigrationWriteOperations,
): Promise<MigrationOperationResult> {
  const legacyPath = repositoryMigrationStatePath(workspace);
  const [external, legacy] = await Promise.all([readStateIfPresent(workspace.stateFile), readStateIfPresent(legacyPath)]);
  if (requireRepositoryState && legacy === null) throw new Error('No repository migration state exists to import');
  if (external !== null && legacy !== null && canonicalJson(external) !== canonicalJson(legacy)) {
    throw new MigrationStateConflictError();
  }
  if (external !== null) {
    return {
      state: external,
      workspace,
      diagnostics: legacy === null ? [] : [legacyStateDiagnostic('legacy_state_present')],
    };
  }
  if (legacy !== null) {
    await mkdir(dirname(workspace.stateFile), { recursive: true });
    await writeMigrationState(workspace.stateFile, legacy, operations);
    return { state: legacy, workspace, diagnostics: [legacyStateDiagnostic('legacy_state_imported')] };
  }
  throw Object.assign(new Error('Migration state does not exist'), { code: 'ENOENT' });
}

async function readStateIfPresent(path: string): Promise<MigrationState | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return validateMigrationState(value);
  } catch (error) {
    if (isMissingError(error)) return null;
    if (error instanceof SyntaxError) throw new Error('Invalid migration state JSON');
    throw error;
  }
}

async function writeMigrationState(
  destination: string,
  state: MigrationState,
  operations: MigrationWriteOperations,
): Promise<void> {
  validateMigrationState(state);
  const temporary = join(dirname(destination), `.${MIGRATION_STATE_FILENAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await operations.rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function legacyStateDiagnostic(code: 'legacy_state_imported' | 'legacy_state_present'): Diagnostic {
  return {
    code,
    message: code === 'legacy_state_imported'
      ? 'Validated repository migration state was copied to external storage; review and remove the retained .design-context directory manually.'
      : 'A matching repository migration state is still present; review and remove the retained .design-context directory manually.',
    retryable: false,
    nodeId: null,
  };
}

function normalizeOptions(options: MigrationOptions | MigrationWriteOperations): MigrationOptions {
  return 'rename' in options ? { operations: options } : options;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function rejectCredentialData(value: unknown): void {
  if (typeof value === 'string') {
    if (credentialShapedValue(value)) throw new Error('Sensitive credential value is forbidden in migration state');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectCredentialData(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, '');
    if (['password', 'token', 'cookie', 'secret', 'authorization'].some((word) => normalized.includes(word))) {
      throw new Error(`Sensitive credential key is forbidden: ${key}`);
    }
    rejectCredentialData(item);
  }
}

function credentialShapedValue(value: string): boolean {
  if (/\bfigd_[A-Za-z0-9_-]{20,}\b/u.test(value)) return true;
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu.test(value)) return true;
  if (!/^https?:\/\//iu.test(value)) return false;
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      const normalized = key.toLowerCase().replaceAll(/[^a-z]/gu, '');
      if (['token', 'authorization', 'secret', 'signature', 'credential'].some((word) => normalized.includes(word))) return true;
      if (normalized === 'expires') return true;
    }
  } catch {
    return true;
  }
  return false;
}

function safeRelativePath(value: unknown): value is string {
  if (!nonEmptyString(value) || isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || /^[/\\]{2}/u.test(value)) return false;
  return !value.split(/[\\/]/u).includes('..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
