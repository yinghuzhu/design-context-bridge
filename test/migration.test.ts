import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  emptyMigrationState,
  initializeMigrationState,
  loadMigrationState,
  validateMigrationState,
} from '../src/core/migration.js';

describe('migration state', () => {
  it('creates the exact generic schema under .design-context', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-migration-'));
    const state = await initializeMigrationState(target);

    expect(state).toEqual({
      schemaVersion: 1,
      targets: [],
      approvedReferences: [],
      legacyBehaviorSources: [],
      protected: [],
      validations: [],
    });
    expect(JSON.parse(await readFile(join(target, '.design-context', 'migration.json'), 'utf8'))).toEqual(state);
    await expect(loadMigrationState(target)).resolves.toEqual(state);
  });

  it('requires approved generic design references', () => {
    const state = emptyMigrationState();
    state.approvedReferences.push({ route: '/checkout', implementation: 'src/Checkout.tsx', designUrl: '', approvedByUser: true });

    expect(() => validateMigrationState(state)).toThrow(/designUrl/);
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

  it('ignores legacy product state', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-migration-'));
    const legacyDirectory = `.${['figma', 'context'].join('-')}`;
    await mkdir(join(target, legacyDirectory), { recursive: true });
    await writeFile(join(target, legacyDirectory, 'migration.json'), '{"secret":"legacy"}');

    const state = await initializeMigrationState(target);

    expect(state).toEqual(emptyMigrationState());
  });

  it('preserves prior bytes and cleans temp file after failed atomic replace', async () => {
    const target = await mkdtemp(join(tmpdir(), 'design-context-migration-'));
    const directory = join(target, '.design-context');
    await mkdir(directory, { recursive: true });
    const state = { ...emptyMigrationState(), protected: ['payment polling'] };
    const original = `${JSON.stringify(state)}\n`;
    await writeFile(join(directory, 'migration.json'), original);
    const rename = vi.fn(async () => { throw Object.assign(new Error('replace failed'), { code: 'EIO' }); });

    await expect(initializeMigrationState(target, { rename })).rejects.toThrow(/replace failed/);

    expect(await readFile(join(directory, 'migration.json'), 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['migration.json']);
  });
});
