import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  emptyMigrationState,
  importRepositoryMigrationState,
  initializeMigrationState,
  loadMigrationState,
  MigrationStateConflictError,
  validateMigrationState,
} from '../src/core/migration.js';
import { resolveWorkspace } from '../src/core/workspace.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'design-context-migration-'));
  const target = join(root, 'target');
  const stateHome = join(root, 'state');
  const cacheHome = join(root, 'cache');
  await mkdir(target);
  return {
    root,
    target,
    options: {
      env: {
        DESIGN_CONTEXT_STATE_HOME: stateHome,
        DESIGN_CONTEXT_CACHE_HOME: cacheHome,
      },
      homeDirectory: join(root, 'home'),
    },
  };
}

describe('migration state', () => {
  it('creates and reloads the exact generic schema outside the target directory', async () => {
    const fixture = await setup();
    const initialized = await initializeMigrationState(fixture.target, fixture.options);

    expect(initialized.state).toEqual(emptyMigrationState());
    expect(initialized.workspace.storageScope).toBe('external');
    expect(initialized.workspace.stateFile.startsWith(`${fixture.target}/`)).toBe(false);
    expect(JSON.parse(await readFile(initialized.workspace.stateFile, 'utf8'))).toEqual(initialized.state);
    await expect(readdir(fixture.target)).resolves.toEqual([]);

    const loaded = await loadMigrationState(fixture.target, fixture.options);
    expect(loaded.state).toEqual(initialized.state);
    expect(loaded.workspace.stateFile).toBe(initialized.workspace.stateFile);
  });

  it('requires approved generic design references', () => {
    const state = emptyMigrationState();
    state.approvedReferences.push({ route: '/checkout', implementation: 'src/Checkout.tsx', designUrl: '', approvedByUser: true });

    expect(() => validateMigrationState(state)).toThrow(/designUrl/);
  });

  it('accepts a user-approved implementation reference without a design URL', () => {
    const state = emptyMigrationState();
    state.approvedReferences.push({ route: '/checkout', implementation: 'src/Checkout.tsx', approvedByUser: true });

    expect(validateMigrationState(state)).toEqual(state);
  });

  it.each(['visualEvidence', 'businessEvidence'])('requires %s for validated targets', (field) => {
    const state = emptyMigrationState();
    const target: Record<string, unknown> = { route: '/payment/result', designUrl: 'https://design.example/node', status: 'validated', visualEvidence: ['actual.png'], businessEvidence: ['test output'] };
    target[field] = [];
    state.targets.push(target);

    expect(() => validateMigrationState(state)).toThrow(new RegExp(field));
  });

  it.each(['password', 'TOKEN', 'Cookie', 'client_secret', 'Authorization'])('rejects credential key %s recursively', (key) => {
    const state = emptyMigrationState();
    state.protected.push({ metadata: [{ [key]: 'must-not-persist' }] });

    expect(() => validateMigrationState(state)).toThrow(/credential key/);
  });

  it.each([
    'https://assets.invalid/image?token=live-value',
    'https://assets.invalid/image?X-Amz-Signature=live-value',
    `Bearer ${'A'.repeat(24)}`,
    `figd_${'B'.repeat(24)}`,
  ])('rejects credential-shaped value %s', (value) => {
    const state = emptyMigrationState();
    state.protected.push({ note: value });

    expect(() => validateMigrationState(state)).toThrow(/credential value/i);
  });

  it.each(['../outside.png', '/tmp/outside.png', 'C:\\temp\\outside.png'])('rejects unsafe visual evidence path %s', (path) => {
    const state = emptyMigrationState();
    state.targets.push({
      route: '/payment/result',
      designUrl: 'https://design.example/node',
      status: 'validated',
      visualEvidence: [path],
      businessEvidence: ['npm test'],
    });

    expect(() => validateMigrationState(state)).toThrow(/visualEvidence.*relative/i);
  });

  it('imports validated repository state externally without deleting the legacy file', async () => {
    const fixture = await setup();
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    const state = { ...emptyMigrationState(), protected: ['payment polling'] };
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(state)}\n`);

    const result = await importRepositoryMigrationState(fixture.target, fixture.options);

    expect(result.state).toEqual(state);
    expect(result.diagnostics).toMatchObject([{ code: 'legacy_state_imported' }]);
    expect(JSON.parse(await readFile(result.workspace.stateFile, 'utf8'))).toEqual(state);
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(state);
  });

  it('automatically imports valid legacy state when external state is absent', async () => {
    const fixture = await setup();
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(emptyMigrationState())}\n`);

    const result = await initializeMigrationState(fixture.target, fixture.options);

    expect(result.diagnostics).toMatchObject([{ code: 'legacy_state_imported' }]);
    await access(result.workspace.stateFile);
    await access(legacyPath);
  });

  it('accepts equal dual state but reports the retained repository copy', async () => {
    const fixture = await setup();
    const first = await initializeMigrationState(fixture.target, fixture.options);
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(first.state, null, 2)}\n`);

    const loaded = await loadMigrationState(fixture.target, fixture.options);

    expect(loaded.state).toEqual(first.state);
    expect(loaded.diagnostics).toMatchObject([{ code: 'legacy_state_present' }]);
  });

  it('stops on divergent dual state without overwriting either file', async () => {
    const fixture = await setup();
    const external = await initializeMigrationState(fixture.target, fixture.options);
    const externalBytes = await readFile(external.workspace.stateFile, 'utf8');
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    const legacyState = { ...emptyMigrationState(), protected: ['different'] };
    const legacyBytes = `${JSON.stringify(legacyState)}\n`;
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, legacyBytes);

    await expect(loadMigrationState(fixture.target, fixture.options)).rejects.toBeInstanceOf(MigrationStateConflictError);
    expect(await readFile(external.workspace.stateFile, 'utf8')).toBe(externalBytes);
    expect(await readFile(legacyPath, 'utf8')).toBe(legacyBytes);
  });

  it('rejects credentials in legacy state before creating external state', async () => {
    const fixture = await setup();
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    const unsafe = { ...emptyMigrationState(), protected: [{ token: 'must-not-copy' }] };
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, JSON.stringify(unsafe));

    await expect(importRepositoryMigrationState(fixture.target, fixture.options)).rejects.toThrow(/credential key/);
  });

  it('preserves repository bytes and cleans temp file after failed atomic import', async () => {
    const fixture = await setup();
    const legacyPath = join(fixture.target, '.design-context', 'migration.json');
    const original = `${JSON.stringify(emptyMigrationState())}\n`;
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, original);
    const rename = vi.fn(async () => { throw Object.assign(new Error('replace failed'), { code: 'EIO' }); });

    await expect(importRepositoryMigrationState(fixture.target, { ...fixture.options, operations: { rename } })).rejects.toThrow(/replace failed/);

    expect(await readFile(legacyPath, 'utf8')).toBe(original);
    const workspace = await resolveWorkspace(fixture.target, fixture.options);
    expect(await readdir(dirname(workspace.stateFile))).toEqual(['workspace.json']);
  });
});
