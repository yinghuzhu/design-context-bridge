import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillClient = 'codex' | 'claude';

export interface InstallOperations {
  copy(source: string, destination: string): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(destination: string): Promise<void>;
}

export interface InstallerCliDependencies {
  env?: Record<string, string | undefined>;
  stderr?(value: string): void;
}

const OWNERSHIP_MARKER = '.design-context-bridge-owned.json';
const OWNERSHIP = {
  schemaVersion: 1,
  tool: 'design-context-bridge',
  skill: 'design-replicate',
} as const;

export async function installSkill(
  sourceDirectory: string,
  homeDirectory: string,
  clients: readonly SkillClient[],
  copy: boolean,
  supplied: Partial<InstallOperations> = {},
  updateOwned = false,
): Promise<string[]> {
  const source = resolve(sourceDirectory);
  if (!(await exists(join(source, 'SKILL.md')))) throw new Error(`Missing SKILL.md in ${source}`);
  if (clients.length === 0) throw new Error('Select at least one client');
  if (new Set(clients).size !== clients.length) throw new Error('Duplicate clients are not allowed');
  if (updateOwned && !copy) throw new Error('Owned Skill updates require --copy');
  const destinations = clients.map((client) => destinationFor(resolve(homeDirectory), client));
  const destinationExists = new Map<string, boolean>();
  for (const destination of destinations) {
    const present = await exists(destination);
    destinationExists.set(destination, present);
    if (!present) continue;
    if (!updateOwned) throw new Error(`Skill destination already exists: ${destination}`);
    if (!(await isOwnedCopy(destination))) throw new Error(`Skill destination is not owned by design-context-bridge: ${destination}`);
  }
  const operations: InstallOperations = {
    copy: async (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false }),
    link: async (from, to) => symlink(from, to, 'dir'),
    rename,
    remove: async (destination) => rm(destination, { recursive: true, force: true }),
    ...supplied,
  };

  if (copy) {
    return installCopiedSkills(source, destinations, destinationExists, operations);
  }

  const created: string[] = [];
  try {
    for (const destination of destinations) {
      await mkdir(resolve(destination, '..'), { recursive: true });
      if (copy) await operations.copy(source, destination);
      else await operations.link(source, destination);
      created.push(destination);
    }
  } catch (error) {
    await Promise.allSettled(created.map((destination) => operations.remove(destination)));
    throw error;
  }
  return destinations;
}

async function installCopiedSkills(
  source: string,
  destinations: readonly string[],
  destinationExists: ReadonlyMap<string, boolean>,
  operations: InstallOperations,
): Promise<string[]> {
  const staged: Array<{ destination: string; staging: string; backup: string | null }> = [];
  const swapped: Array<{ destination: string; backup: string | null }> = [];
  try {
    for (const destination of destinations) {
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true });
      const staging = join(parent, `.${basename(destination)}.staging-${randomUUID()}`);
      await operations.copy(source, staging);
      await writeFile(join(staging, OWNERSHIP_MARKER), `${JSON.stringify(OWNERSHIP, null, 2)}\n`, 'utf8');
      const backup = destinationExists.get(destination) === true
        ? join(parent, `.${basename(destination)}.backup-${randomUUID()}`)
        : null;
      staged.push({ destination, staging, backup });
    }

    for (const item of staged) {
      if (item.backup !== null) await operations.rename(item.destination, item.backup);
      swapped.push({ destination: item.destination, backup: item.backup });
      await operations.rename(item.staging, item.destination);
    }
  } catch (error) {
    for (const item of [...swapped].reverse()) {
      await operations.remove(item.destination).catch(() => undefined);
      if (item.backup !== null) await operations.rename(item.backup, item.destination).catch(() => undefined);
    }
    await Promise.allSettled(staged.map(({ staging }) => operations.remove(staging)));
    throw error;
  }

  await Promise.all(staged.flatMap(({ backup, staging }) => [
    operations.remove(staging),
    ...(backup === null ? [] : [operations.remove(backup)]),
  ]));
  return [...destinations];
}

function destinationFor(home: string, client: SkillClient): string {
  return client === 'codex'
    ? join(home, '.agents', 'skills', 'design-replicate')
    : join(home, '.claude', 'skills', 'design-replicate');
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isOwnedCopy(destination: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(destination, OWNERSHIP_MARKER), 'utf8')) as Record<string, unknown>;
    return value.schemaVersion === OWNERSHIP.schemaVersion
      && value.tool === OWNERSHIP.tool
      && value.skill === OWNERSHIP.skill;
  } catch {
    return false;
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: InstallerCliDependencies = {},
): Promise<number> {
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  if (argv.includes('--help') || argv.includes('-h')) {
    stderr('Usage: design-replicate-install [--client codex|claude|both] [--copy] [--update-owned] [--home DIR] [--source DIR]\n');
    return 0;
  }
  const values: Record<string, string> = {};
  let copy = false;
  let updateOwned = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--copy') {
      copy = true;
      continue;
    }
    if (token === '--update-owned') {
      updateOwned = true;
      continue;
    }
    if (token === '--client' || token === '--home' || token === '--source') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${token} requires a value`);
      values[token] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token ?? ''}`);
  }
  const selected = values['--client'] ?? 'both';
  if (!['codex', 'claude', 'both'].includes(selected)) throw new Error(`Unsupported client: ${selected}`);
  const clients: SkillClient[] = selected === 'both' ? ['codex', 'claude'] : [selected as SkillClient];
  const env = dependencies.env ?? process.env;
  const home = values['--home'] ?? env.HOME;
  if (home === undefined || home.length === 0) throw new Error('A home directory is required');
  const source = values['--source'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'design-replicate');
  const installed = await installSkill(source, home, clients, copy, {}, updateOwned);
  for (const destination of installed) stderr(`Installed design-replicate: ${destination}\n`);
  return 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    process.stderr.write(`design-replicate-install failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
