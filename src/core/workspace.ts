import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export type StorageScope = 'external' | 'in-repo';
export type WorkspaceIdentitySource = 'git-metadata' | 'path-hash';

export interface WorkspacePaths {
  targetDirectory: string;
  gitRoot: string | null;
  workspaceId: string;
  identitySource: WorkspaceIdentitySource;
  workspaceIdFile: string | null;
  displayName: string;
  workspaceMetadataFile: string;
  stateFile: string;
  packagesDirectory: string;
  evidenceDirectory: string;
  storageScope: 'external';
}

export interface WorkspaceResolveOptions {
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
}

export interface OutputLocation {
  outputDirectory: string;
  gitRoot: string | null;
  storageScope: StorageScope;
}

interface GitContext {
  gitRoot: string;
  gitDirectory: string;
}

interface WorkspaceMetadata {
  schemaVersion: 1;
  workspaceId: string;
  displayName: string;
  currentPath: string;
  previousPaths: string[];
  identitySource: WorkspaceIdentitySource;
}

export async function resolveWorkspace(
  targetDirectory: string,
  options: WorkspaceResolveOptions = {},
): Promise<WorkspacePaths> {
  const canonicalTarget = await canonicalizePotentialPath(targetDirectory);
  const targetStats = await stat(canonicalTarget);
  if (!targetStats.isDirectory()) throw new Error('Target directory must be a directory');
  const git = await findGitContext(canonicalTarget);
  const identityRoot = git?.gitRoot ?? canonicalTarget;
  const pathHash = hashPath(identityRoot);
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const stateHome = await canonicalizePotentialPath(firstPath(env.DESIGN_CONTEXT_STATE_HOME, env.XDG_STATE_HOME, join(homeDirectory, '.local', 'state')));
  const cacheHome = await canonicalizePotentialPath(firstPath(env.DESIGN_CONTEXT_CACHE_HOME, env.XDG_CACHE_HOME, join(homeDirectory, '.cache')));
  const provisionalState = join(stateHome, 'design-context-bridge', 'workspaces', pathHash);
  const provisionalCache = join(cacheHome, 'design-context-bridge', 'workspaces', pathHash);
  if (containsPath(identityRoot, provisionalState) || containsPath(identityRoot, provisionalCache)) {
    throw new Error('State and cache homes must resolve outside the target repository');
  }

  const workspaceIdFile = git === null ? null : join(git.gitDirectory, 'design-context-bridge', 'workspace-id');
  const workspaceId = workspaceIdFile === null ? pathHash : await readOrCreateWorkspaceId(workspaceIdFile, pathHash);
  const identitySource: WorkspaceIdentitySource = workspaceIdFile === null ? 'path-hash' : 'git-metadata';
  const displayName = safeWorkspaceName(basename(identityRoot));
  const stateDirectory = await resolveReadableWorkspaceDirectory(
    join(stateHome, 'design-context-bridge', 'workspaces'),
    workspaceId,
    displayName,
  );
  const cacheDirectory = await resolveReadableWorkspaceDirectory(
    join(cacheHome, 'design-context-bridge', 'workspaces'),
    workspaceId,
    displayName,
  );
  const workspaceMetadataFile = join(stateDirectory, 'workspace.json');
  await Promise.all([
    mkdir(stateDirectory, { recursive: true }),
    mkdir(cacheDirectory, { recursive: true }),
  ]);
  await updateWorkspaceMetadata(workspaceMetadataFile, {
    workspaceId,
    displayName,
    currentPath: identityRoot,
    identitySource,
  });

  return {
    targetDirectory: canonicalTarget,
    gitRoot: git?.gitRoot ?? null,
    workspaceId,
    identitySource,
    workspaceIdFile,
    displayName,
    workspaceMetadataFile,
    stateFile: join(stateDirectory, 'migration.json'),
    packagesDirectory: join(cacheDirectory, 'packages'),
    evidenceDirectory: join(cacheDirectory, 'evidence'),
    storageScope: 'external',
  };
}

export async function resolveOutputLocation(outputDirectory: string): Promise<OutputLocation> {
  const canonicalOutput = await canonicalizePotentialPath(outputDirectory);
  const git = await findGitContext(canonicalOutput);
  return {
    outputDirectory: canonicalOutput,
    gitRoot: git?.gitRoot ?? null,
    storageScope: git !== null && containsPath(git.gitRoot, canonicalOutput) ? 'in-repo' : 'external',
  };
}

export async function canonicalizePotentialPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      const canonical = await realpath(cursor);
      return resolve(canonical, ...missing);
    } catch (error) {
      if (!isMissingError(error)) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

export function containsPath(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function findGitContext(path: string): Promise<GitContext | null> {
  const probe = await nearestExistingDirectory(path);
  try {
    const [{ stdout: rootOutput }, { stdout: directoryOutput }] = await Promise.all([
      execute('git', ['-C', probe, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }),
      execute('git', ['-C', probe, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }),
    ]);
    const root = rootOutput.trim();
    const directory = directoryOutput.trim();
    if (root.length === 0 || directory.length === 0) return null;
    return {
      gitRoot: await canonicalizePotentialPath(root),
      gitDirectory: await canonicalizePotentialPath(directory),
    };
  } catch {
    return null;
  }
}

async function readOrCreateWorkspaceId(path: string, initialId: string): Promise<string> {
  try {
    return parseWorkspaceId(await readFile(path, 'utf8'));
  } catch (error) {
    if (!isMissingError(error)) throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, `${initialId}\n`);
  return initialId;
}

function parseWorkspaceId(value: string): string {
  if (!/^[a-f0-9]{64}\n?$/u.test(value)) {
    throw new Error('Git-local workspace identity must be a 64-character lowercase SHA-256 value');
  }
  return value.trim();
}

async function resolveReadableWorkspaceDirectory(root: string, workspaceId: string, displayName: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && (entry.name === workspaceId || entry.name.startsWith(`${workspaceId}--`)))
    .map((entry) => entry.name);
  if (matches.length > 1) throw new Error(`Multiple external workspace directories exist for workspace ${workspaceId}`);
  const desiredName = `${workspaceId}--${displayName}`;
  const existing = matches[0];
  if (existing === undefined) return join(root, desiredName);
  if (existing !== workspaceId) return join(root, existing);
  const oldPath = join(root, existing);
  const desiredPath = join(root, desiredName);
  await rename(oldPath, desiredPath);
  return desiredPath;
}

async function updateWorkspaceMetadata(
  path: string,
  current: Pick<WorkspaceMetadata, 'workspaceId' | 'displayName' | 'currentPath' | 'identitySource'>,
): Promise<void> {
  let previousPaths: string[] = [];
  try {
    const existing = parseWorkspaceMetadata(JSON.parse(await readFile(path, 'utf8')) as unknown);
    if (existing.workspaceId !== current.workspaceId) throw new Error('External workspace metadata ID does not match its directory');
    previousPaths = existing.previousPaths;
    if (existing.currentPath !== current.currentPath && !previousPaths.includes(existing.currentPath)) {
      previousPaths = [...previousPaths, existing.currentPath];
    }
  } catch (error) {
    if (!isMissingError(error)) {
      if (error instanceof SyntaxError) throw new Error('Invalid external workspace metadata JSON');
      throw error;
    }
  }
  const metadata: WorkspaceMetadata = { schemaVersion: 1, ...current, previousPaths };
  await writeAtomic(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

function parseWorkspaceMetadata(value: unknown): WorkspaceMetadata {
  if (!isRecord(value) || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(String(value.workspaceId))) {
    throw new Error('Invalid external workspace metadata');
  }
  if (
    typeof value.displayName !== 'string' ||
    typeof value.currentPath !== 'string' ||
    !Array.isArray(value.previousPaths) ||
    !value.previousPaths.every((path) => typeof path === 'string') ||
    !['git-metadata', 'path-hash'].includes(String(value.identitySource))
  ) {
    throw new Error('Invalid external workspace metadata');
  }
  return value as unknown as WorkspaceMetadata;
}

async function writeAtomic(destination: string, contents: string): Promise<void> {
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let cursor = path;
  for (;;) {
    try {
      const info = await stat(cursor);
      const canonical = await realpath(cursor);
      return info.isDirectory() ? canonical : dirname(canonical);
    } catch (error) {
      if (!isMissingError(error)) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

function safeWorkspaceName(value: string): string {
  const safe = value.normalize('NFKC').replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/gu, '').slice(0, 80);
  return safe.length === 0 ? 'workspace' : safe;
}

function hashPath(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

function firstPath(...values: Array<string | undefined>): string {
  const selected = values.find((value) => value !== undefined && value.trim().length > 0);
  if (selected === undefined) throw new Error('Unable to resolve storage home');
  return resolve(selected.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
