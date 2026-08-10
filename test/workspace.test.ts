import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { canonicalizePotentialPath, resolveOutputLocation, resolveWorkspace } from '../src/core/workspace.js';

const execute = promisify(execFile);

async function gitRepository(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await execute('git', ['init', '--quiet', directory]);
  return directory;
}

function roots(base: string) {
  return {
    env: {
      DESIGN_CONTEXT_STATE_HOME: join(base, 'state'),
      DESIGN_CONTEXT_CACHE_HOME: join(base, 'cache'),
    },
    homeDirectory: join(base, 'home'),
  };
}

describe('workspace resolution', () => {
  it('uses one Git root for relative, absolute, nested, and symlink access', async () => {
    const repository = await gitRepository('design-context-workspace-');
    const nested = join(repository, 'src', 'pages');
    const linkRoot = await mkdtemp(join(tmpdir(), 'design-context-link-'));
    const link = join(linkRoot, 'repository');
    await mkdir(nested, { recursive: true });
    await symlink(repository, link, 'dir');
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-roots-')));

    const absolute = await resolveWorkspace(repository, options);
    const relativePath = relative(process.cwd(), nested);
    const nestedRelative = await resolveWorkspace(relativePath, options);
    const throughLink = await resolveWorkspace(link, options);

    expect(nestedRelative.workspaceId).toBe(absolute.workspaceId);
    expect(throughLink.workspaceId).toBe(absolute.workspaceId);
    expect(absolute.gitRoot).toBe(await canonicalizePotentialPath(repository));
    expect(throughLink.targetDirectory).toBe(await canonicalizePotentialPath(repository));
    expect(absolute.workspaceId).toMatch(/^[a-f0-9]{64}$/u);
    expect(absolute.identitySource).toBe('git-metadata');
    expect(absolute.workspaceIdFile).toBe(join(await canonicalizePotentialPath(join(repository, '.git')), 'design-context-bridge', 'workspace-id'));
    expect(await readFile(absolute.workspaceIdFile ?? '', 'utf8')).toBe(`${absolute.workspaceId}\n`);
    expect(basename(dirname(absolute.stateFile))).toBe(`${absolute.workspaceId}--${basename(repository)}`);
    expect(basename(dirname(absolute.packagesDirectory))).toBe(`${absolute.workspaceId}--${basename(repository)}`);
    expect((await execute('git', ['-C', repository, 'status', '--porcelain'])).stdout).toBe('');
  });

  it('uses realpath for non-Git projects and separates different repositories', async () => {
    const first = await gitRepository('design-context-first-');
    const second = await gitRepository('design-context-second-');
    const nonGit = await mkdtemp(join(tmpdir(), 'design-context-non-git-'));
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-roots-')));

    const firstWorkspace = await resolveWorkspace(first, options);
    const secondWorkspace = await resolveWorkspace(second, options);
    const nonGitWorkspace = await resolveWorkspace(nonGit, options);

    expect(firstWorkspace.workspaceId).not.toBe(secondWorkspace.workspaceId);
    expect(firstWorkspace.stateFile).not.toBe(secondWorkspace.stateFile);
    expect(firstWorkspace.packagesDirectory).not.toBe(secondWorkspace.packagesDirectory);
    expect(firstWorkspace.evidenceDirectory).not.toBe(secondWorkspace.evidenceDirectory);
    expect(nonGitWorkspace.gitRoot).toBeNull();
    expect(nonGitWorkspace.targetDirectory).toBe(await canonicalizePotentialPath(nonGit));
    expect(nonGitWorkspace.identitySource).toBe('path-hash');
    expect(nonGitWorkspace.workspaceIdFile).toBeNull();
  });

  it('keeps the pinned workspace after a Git repository directory rename', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'design-context-rename-parent-'));
    const original = join(parent, 'old-repository-name');
    const renamed = join(parent, 'new-repository-name');
    await mkdir(original);
    await execute('git', ['init', '--quiet', original]);
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-rename-roots-')));

    const first = await resolveWorkspace(original, options);
    await rename(original, renamed);
    const second = await resolveWorkspace(renamed, options);
    const metadata = JSON.parse(await readFile(second.workspaceMetadataFile, 'utf8')) as Record<string, unknown>;

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.stateFile).toBe(first.stateFile);
    expect(second.packagesDirectory).toBe(first.packagesDirectory);
    expect(second.identitySource).toBe('git-metadata');
    expect(metadata).toMatchObject({ displayName: 'new-repository-name', currentPath: await canonicalizePotentialPath(renamed) });
    expect(metadata.previousPaths).toContain(await canonicalizePotentialPath(original));
    expect((await execute('git', ['-C', renamed, 'status', '--porcelain'])).stdout).toBe('');
  });

  it('falls back to the original path hash when .git disappears without a rename', async () => {
    const repository = await gitRepository('design-context-missing-git-');
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-missing-git-roots-')));
    const first = await resolveWorkspace(repository, options);
    const removedGit = join(await mkdtemp(join(tmpdir(), 'design-context-removed-git-')), 'git-metadata');

    await rename(join(repository, '.git'), removedGit);
    const fallback = await resolveWorkspace(repository, options);

    expect(fallback.identitySource).toBe('path-hash');
    expect(fallback.workspaceIdFile).toBeNull();
    expect(fallback.workspaceId).toBe(first.workspaceId);
    expect(fallback.stateFile).toBe(first.stateFile);
    expect(fallback.packagesDirectory).toBe(first.packagesDirectory);
  });

  it('cannot preserve a non-Git workspace identity after a directory rename', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'design-context-non-git-rename-'));
    const original = join(parent, 'old-name');
    const renamed = join(parent, 'new-name');
    await mkdir(original);
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-non-git-roots-')));

    const first = await resolveWorkspace(original, options);
    await rename(original, renamed);
    const second = await resolveWorkspace(renamed, options);

    expect(first.identitySource).toBe('path-hash');
    expect(second.identitySource).toBe('path-hash');
    expect(second.workspaceId).not.toBe(first.workspaceId);
  });

  it('rejects a corrupt Git-local workspace identity instead of replacing it', async () => {
    const repository = await gitRepository('design-context-corrupt-id-');
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-corrupt-id-roots-')));
    const first = await resolveWorkspace(repository, options);
    await writeFile(first.workspaceIdFile ?? '', 'not-a-valid-workspace-id\n');

    await expect(resolveWorkspace(repository, options)).rejects.toThrow(/workspace identity/i);
    expect(await readFile(first.workspaceIdFile ?? '', 'utf8')).toBe('not-a-valid-workspace-id\n');
  });

  it('migrates a former plain hash directory to the readable name', async () => {
    const repository = await gitRepository('design-context-readable-migration-');
    const base = await mkdtemp(join(tmpdir(), 'design-context-readable-roots-'));
    const options = roots(base);
    const canonical = await canonicalizePotentialPath(repository);
    const workspaceId = createHash('sha256').update(canonical).digest('hex');
    const oldState = join(base, 'state', 'design-context-bridge', 'workspaces', workspaceId);
    await mkdir(oldState, { recursive: true });
    await writeFile(join(oldState, 'sentinel'), 'preserved');

    const workspace = await resolveWorkspace(repository, options);

    expect(basename(dirname(workspace.stateFile))).toBe(`${workspaceId}--${basename(repository)}`);
    await expect(readFile(join(dirname(workspace.stateFile), 'sentinel'), 'utf8')).resolves.toBe('preserved');
    await expect(access(oldState)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses dedicated homes before XDG homes and user-local defaults', async () => {
    const repository = await gitRepository('design-context-precedence-');
    const base = await mkdtemp(join(tmpdir(), 'design-context-precedence-roots-'));
    const dedicated = await resolveWorkspace(repository, {
      env: {
        DESIGN_CONTEXT_STATE_HOME: join(base, 'dedicated-state'),
        XDG_STATE_HOME: join(base, 'xdg-state'),
        DESIGN_CONTEXT_CACHE_HOME: join(base, 'dedicated-cache'),
        XDG_CACHE_HOME: join(base, 'xdg-cache'),
      },
      homeDirectory: join(base, 'home'),
    });
    const xdg = await resolveWorkspace(repository, {
      env: { XDG_STATE_HOME: join(base, 'xdg-state'), XDG_CACHE_HOME: join(base, 'xdg-cache') },
      homeDirectory: join(base, 'home'),
    });
    const fallback = await resolveWorkspace(repository, { env: {}, homeDirectory: join(base, 'home') });

    expect(dedicated.stateFile).toContain(join(base, 'dedicated-state', 'design-context-bridge'));
    expect(dedicated.packagesDirectory).toContain(join(base, 'dedicated-cache', 'design-context-bridge'));
    expect(xdg.stateFile).toContain(join(base, 'xdg-state', 'design-context-bridge'));
    expect(xdg.packagesDirectory).toContain(join(base, 'xdg-cache', 'design-context-bridge'));
    expect(fallback.stateFile).toContain(join(base, 'home', '.local', 'state', 'design-context-bridge'));
    expect(fallback.packagesDirectory).toContain(join(base, 'home', '.cache', 'design-context-bridge'));
  });

  it('detects repository output through missing segments, dot segments, and symlinks', async () => {
    const repository = await gitRepository('design-context-output-');
    const linkRoot = await mkdtemp(join(tmpdir(), 'design-context-output-link-'));
    const link = join(linkRoot, 'inside');
    await symlink(repository, link, 'dir');

    const direct = await resolveOutputLocation(join(repository, 'generated', '..', 'packages'));
    const linked = await resolveOutputLocation(join(link, 'packages'));
    const external = await resolveOutputLocation(join(linkRoot, 'external', 'packages'));

    expect(direct.storageScope).toBe('in-repo');
    expect(linked.storageScope).toBe('in-repo');
    expect(direct.gitRoot).toBe(await canonicalizePotentialPath(repository));
    expect(linked.outputDirectory).toBe(await canonicalizePotentialPath(resolve(repository, 'packages')));
    expect(external.storageScope).toBe('external');
    expect(external.gitRoot).toBeNull();
  });

  it('refuses configured state or cache homes that resolve inside the target', async () => {
    const repository = await gitRepository('design-context-unsafe-home-');
    const outside = await mkdtemp(join(tmpdir(), 'design-context-safe-home-'));

    await expect(resolveWorkspace(repository, {
      env: {
        DESIGN_CONTEXT_STATE_HOME: join(repository, 'state'),
        DESIGN_CONTEXT_CACHE_HOME: join(outside, 'cache'),
      },
      homeDirectory: outside,
    })).rejects.toThrow(/outside the target repository/i);

    const link = join(outside, 'linked-cache');
    await symlink(repository, link, 'dir');
    await expect(resolveWorkspace(repository, {
      env: {
        DESIGN_CONTEXT_STATE_HOME: join(outside, 'state'),
        DESIGN_CONTEXT_CACHE_HOME: link,
      },
      homeDirectory: outside,
    })).rejects.toThrow(/outside the target repository/i);
  });

  it('detects output inside a Git worktree whose .git entry is a file', async () => {
    const repository = await gitRepository('design-context-worktree-source-');
    await writeFile(join(repository, 'README.md'), 'fixture\n');
    await execute('git', ['-C', repository, 'add', 'README.md']);
    await execute('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    const parent = await mkdtemp(join(tmpdir(), 'design-context-worktree-parent-'));
    const worktree = join(parent, 'checkout');
    await execute('git', ['-C', repository, 'worktree', 'add', '--quiet', worktree]);

    const output = await resolveOutputLocation(join(worktree, 'generated', 'packages'));

    expect(output.storageScope).toBe('in-repo');
    expect(output.gitRoot).toBe(await canonicalizePotentialPath(worktree));
  });

  it('stores a worktree identity in its resolved Git directory without dirtying the worktree', async () => {
    const repository = await gitRepository('design-context-worktree-identity-source-');
    await writeFile(join(repository, 'README.md'), 'fixture\n');
    await execute('git', ['-C', repository, 'add', 'README.md']);
    await execute('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    const parent = await mkdtemp(join(tmpdir(), 'design-context-worktree-identity-parent-'));
    const worktree = join(parent, 'checkout');
    await execute('git', ['-C', repository, 'worktree', 'add', '--quiet', worktree]);
    const options = roots(await mkdtemp(join(tmpdir(), 'design-context-worktree-identity-roots-')));

    const workspace = await resolveWorkspace(worktree, options);
    const { stdout: gitDirectory } = await execute('git', ['-C', worktree, 'rev-parse', '--absolute-git-dir']);

    expect(workspace.identitySource).toBe('git-metadata');
    expect(workspace.workspaceIdFile).toBe(join(gitDirectory.trim(), 'design-context-bridge', 'workspace-id'));
    await access(workspace.workspaceIdFile ?? '');
    expect((await execute('git', ['-C', worktree, 'status', '--porcelain'])).stdout).toBe('');
  });
});
