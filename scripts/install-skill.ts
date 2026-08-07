import { realpathSync } from 'node:fs';
import { cp, lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillClient = 'codex' | 'claude';

export interface InstallOperations {
  copy(source: string, destination: string): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  remove(destination: string): Promise<void>;
}

export interface InstallerCliDependencies {
  env?: Record<string, string | undefined>;
  stderr?(value: string): void;
}

export async function installSkill(
  sourceDirectory: string,
  homeDirectory: string,
  clients: readonly SkillClient[],
  copy: boolean,
  supplied: Partial<InstallOperations> = {},
): Promise<string[]> {
  const source = resolve(sourceDirectory);
  if (!(await exists(join(source, 'SKILL.md')))) throw new Error(`Missing SKILL.md in ${source}`);
  if (clients.length === 0) throw new Error('Select at least one client');
  if (new Set(clients).size !== clients.length) throw new Error('Duplicate clients are not allowed');
  const destinations = clients.map((client) => destinationFor(resolve(homeDirectory), client));
  for (const destination of destinations) {
    if (await exists(destination)) throw new Error(`Skill destination already exists: ${destination}`);
  }
  const operations: InstallOperations = {
    copy: async (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false }),
    link: async (from, to) => symlink(from, to, 'dir'),
    remove: async (destination) => rm(destination, { recursive: true, force: true }),
    ...supplied,
  };
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

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: InstallerCliDependencies = {},
): Promise<number> {
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  if (argv.includes('--help') || argv.includes('-h')) {
    stderr('Usage: design-replicate-install [--client codex|claude|both] [--copy] [--home DIR] [--source DIR]\n');
    return 0;
  }
  const values: Record<string, string> = {};
  let copy = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--copy') {
      copy = true;
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
  const installed = await installSkill(source, home, clients, copy);
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
