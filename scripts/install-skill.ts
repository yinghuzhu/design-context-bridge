import { cp, lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type SkillClient = 'codex' | 'claude';

export interface InstallOperations {
  copy(source: string, destination: string): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  remove(destination: string): Promise<void>;
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
