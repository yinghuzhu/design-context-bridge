# Multi-Target Migration Core and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build schema-v2 migration batches whose independently validated units can target pages, modals, tabs, forms, sections, components, or flows, with safe approved references, atomic CLI state mutations, and partial batch completion.

**Architecture:** Keep package preparation single-source and deterministic, then add a typed migration schema layer, a locked external-state mutation layer, and bounded CLI commands for batch apply, unit updates, inspection, and explicit v1 upgrade. Preserve the existing workspace resolver and package manifest v1; every migration response remains in the existing JSON envelope under `data`.

**Tech Stack:** Node.js 20+, TypeScript 5.9, Vitest 3, Node filesystem/crypto APIs, existing provider registry and external workspace resolver.

## Global Constraints

- Implement the approved design in `docs/plans/2026-08-11-multi-target-replication-batches-design.md`.
- Do not modify a real business project; use only this repository and `mktemp`/Vitest temporary repositories.
- Do not commit or push without explicit authorization. Gated commit steps must be skipped when authorization is absent.
- Migration schema becomes version 2; package manifest schema remains version 1.
- Default execution must not create or modify `.design-context` or any generated file in a target repository.
- Never persist credentials, cookies, authorization values, sessions, signed URLs, or passwords.
- CLI must not perform image recognition, similarity scoring, or visual acceptance.
- Preserve existing provider, prepare, validate-package, package inspect, render, status, refresh, workspace resolution, installation, and external-storage behavior.
- Public CLI JSON values remain under `data`; diagnostics remain sanitized.

---

## File Structure

- Create `src/core/migration-schema.ts`: schema-v2 types, structural/semantic validation, batch summaries, canonical state fingerprints, dependency traversal, and safe-path/credential checks.
- Create `src/core/migration-mutations.ts`: typed batch/unit mutations, transition gates, reopen/history behavior, dependency invalidation, bounded inspection, and revision checks.
- Create `src/core/migration-lock.ts`: bounded cross-process lock acquisition, stale-lock recovery, and release.
- Modify `src/core/migration.ts`: external state I/O facade, schema-v1 parsing/upgrade, atomic persistence, legacy repository import, and exports used by CLI.
- Modify `src/core/package.ts`: add and verify an additive content fingerprint without changing manifest schemaVersion 1 or existing request/cache fingerprint semantics.
- Modify `src/core/downloader.ts`: return request/content fingerprints and canonical design source from both cache-hit and fresh-package paths.
- Modify `src/cli.ts`: parse and dispatch the new migration subcommands and expose additive prepare response fields.
- Modify `src/index.ts`: export public schema, mutation, summary, and upgrade types/functions.
- Create `test/migration-schema.test.ts`: isolated schema and summary tests.
- Create `test/migration-mutations.test.ts`: transition, dependency, history, revision, and lock tests.
- Modify `test/migration.test.ts`: external I/O and schema-v1 upgrade coverage.
- Modify `test/package.test.ts`: content fingerprint construction and tamper detection.
- Modify `test/downloader.test.ts`: prepare result dual-fingerprint/source contract.
- Modify `test/cli.test.ts`: black-box command/envelope/input-path contracts.
- Modify `test/repository-install.test.ts`: installed CLI multi-unit zero-pollution smoke test.

---

### Task 1: Define and validate migration schema v2

**Files:**
- Create: `src/core/migration-schema.ts`
- Create: `test/migration-schema.test.ts`
- Modify: `src/core/migration.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `MigrationStateV2`, `ApprovedReferenceV2`, `ExistingReferenceDefinition`, `ReplicationBatchDefinition`, `ReplicationUnitDefinition`, `ReplicationBatch`, `ReplicationUnit`, `UnitMutation`, `ReferenceMutation`, `BatchSummary`, `validateMigrationStateV2()`, `validateBatchDefinition()`, `summarizeBatch()`, `migrationStateFingerprint()`, `transitiveDependents()`.
- Preserves: `MIGRATION_SCHEMA_VERSION`, `emptyMigrationState()`, and `validateMigrationState()` facade names, now returning schema v2.

- [ ] **Step 1: Add the schema-v2 test factory and happy-path test**

```ts
import { describe, expect, it } from 'vitest';

import {
  emptyMigrationState,
  migrationStateFingerprint,
  summarizeBatch,
  validateMigrationState,
  type ReplicationBatch,
  type ReplicationUnit,
} from '../src/core/migration.js';

function unit(id = 'orders-page'): ReplicationUnit {
  return {
    id,
    name: 'Orders page',
    revision: 1,
    changeType: 'refactor',
    designSource: {
      provider: 'figma',
      url: 'https://www.figma.com/design/file/Page?node-id=1-2',
      documentId: 'file',
      nodeId: '1:2',
      packageRef: null,
      packageFingerprint: null,
    },
    implementationTarget: {
      type: 'page',
      name: 'Orders page',
      hostRoute: '/account/orders',
      activation: [],
      scope: 'Orders page presentation only',
      runtimeLocator: null,
      implementationFiles: [],
    },
    approvedReferenceIds: [],
    legacyBehaviorSources: [],
    protected: [],
    dependsOn: [],
    status: 'pending',
    blockers: [],
    visualEvidence: [],
    businessEvidence: [],
    validationHistory: [],
    acceptance: { status: 'pending', note: null },
  };
}

function batch(): ReplicationBatch {
  return { id: 'account-center', name: 'Account center', revision: 1, units: [unit()] };
}

describe('migration schema v2', () => {
  it('validates a mixed-target batch and returns a deterministic fingerprint', () => {
    const state = emptyMigrationState();
    state.batches.push(batch());

    expect(validateMigrationState(state)).toEqual(state);
    expect(migrationStateFingerprint(state)).toMatch(/^[a-f0-9]{64}$/u);
    expect(summarizeBatch(state.batches[0])).toMatchObject({
      executionStatus: 'pending',
      acceptanceStatus: 'pending',
      counts: { total: 1, pending: 1, validated: 0, blocked: 0, accepted: 0 },
    });
  });
});
```

- [ ] **Step 2: Add failing table tests for every target and change type**

```ts
it.each(['page', 'modal', 'drawer', 'tab', 'form', 'section', 'component', 'flow'] as const)(
  'accepts implementation target type %s',
  (type) => {
    const value = unit(type);
    value.implementationTarget.type = type;
    expect(validateMigrationState({ schemaVersion: 2, batches: [{ ...batch(), units: [value] }], approvedReferences: [] })).toBeTruthy();
  },
);

it.each(['new', 'refactor'] as const)('accepts change type %s', (changeType) => {
  const value = unit(changeType);
  value.changeType = changeType;
  expect(validateMigrationState({ schemaVersion: 2, batches: [{ ...batch(), units: [value] }], approvedReferences: [] })).toBeTruthy();
});
```

- [ ] **Step 3: Add failing semantic validation tests**

Cover exact diagnostic/error cases with separate tests:

```ts
it.each([
  ['duplicate unit', (value: ReplicationBatch) => { value.units.push(unit('orders-page')); }, /duplicate unit/i],
  ['unknown dependency', (value: ReplicationBatch) => { value.units[0].dependsOn = ['missing']; }, /unknown dependency/i],
  ['cycle', (value: ReplicationBatch) => {
    value.units.push(unit('modal'));
    value.units[0].dependsOn = ['modal'];
    value.units[1].dependsOn = ['orders-page'];
  }, /cycle/i],
] as const)('rejects %s', (_name, mutate, expected) => {
  const value = batch();
  mutate(value);
  expect(() => validateMigrationState({ schemaVersion: 2, batches: [value], approvedReferences: [] })).toThrow(expected);
});
```

Also add explicit tests for empty batches, duplicate batch IDs, empty names/slugs, revision below 1, duplicate/unknown approved reference IDs, active unit references to a missing/unaccepted/revision-mismatched source unit, invalid target type, missing host route/runtime entry, empty scope, unsafe package/evidence paths, blocked without blockers, non-blocked with active blockers, implemented/validated without implementation files, non-page implemented/validated without a runtime locator, validated without both evidence arrays, accepted before validated, rejected acceptance outside an in-progress/implemented/blocked rework unit, rejected batch-summary precedence, and recursive credential/signed-URL rejection. A revoked reference ID is valid only on a blocked unit containing blocker code `approved_reference_revoked`. Add a definition test proving `validateBatchDefinition()` rejects revision, status, blockers, evidence, history, acceptance, runtimeLocator, or implementationFiles keys.

- [ ] **Step 4: Run the focused tests and confirm the red state**

Run:

```bash
npx vitest run test/migration-schema.test.ts
```

Expected: FAIL because schema-v2 exports and `batches` do not exist.

- [ ] **Step 5: Implement the public schema types**

Add these exact public discriminants and interfaces to `src/core/migration-schema.ts`:

```ts
export const MIGRATION_SCHEMA_VERSION = 2 as const;

export type ChangeType = 'new' | 'refactor';
export type ImplementationTargetType =
  | 'page' | 'modal' | 'drawer' | 'tab'
  | 'form' | 'section' | 'component' | 'flow';
export type UnitStatus = 'pending' | 'in_progress' | 'implemented' | 'validated' | 'blocked';
export type AcceptanceStatus = 'pending' | 'accepted' | 'rejected';

export interface DesignSourceBinding {
  provider: string;
  url: string;
  documentId: string;
  nodeId: string;
  packageRef: string | null;
  packageFingerprint: string | null;
}

export interface ImplementationTargetDefinition {
  type: ImplementationTargetType;
  name: string;
  hostRoute: string;
  activation: string[];
  scope: string;
}

export interface ImplementationTarget extends ImplementationTargetDefinition {
  runtimeLocator: string | null;
  implementationFiles: string[];
}

export interface UnitBlocker {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ValidationHistoryEntry {
  unitRevision: number;
  reason: string;
  designSource: DesignSourceBinding;
  implementationTarget: ImplementationTarget;
  packageFingerprint: string;
  visualEvidence: string[];
  businessEvidence: string[];
  acceptance: UnitAcceptance;
}

export interface UnitAcceptance {
  status: AcceptanceStatus;
  note: string | null;
}

export interface ReplicationUnitDefinition {
  id: string;
  name: string;
  changeType: ChangeType;
  designSource: DesignSourceBinding;
  implementationTarget: ImplementationTargetDefinition;
  approvedReferenceIds: string[];
  legacyBehaviorSources: unknown[];
  protected: unknown[];
  dependsOn: string[];
}

export interface ReplicationUnit extends Omit<ReplicationUnitDefinition, 'implementationTarget'> {
  revision: number;
  implementationTarget: ImplementationTarget;
  status: UnitStatus;
  blockers: UnitBlocker[];
  visualEvidence: string[];
  businessEvidence: string[];
  validationHistory: ValidationHistoryEntry[];
  acceptance: UnitAcceptance;
}

export interface ReplicationBatchDefinition {
  id: string;
  name: string;
  units: ReplicationUnitDefinition[];
}

export interface ReplicationBatch extends Omit<ReplicationBatchDefinition, 'units'> {
  revision: number;
  units: ReplicationUnit[];
}

export type ApprovedReferenceSource =
  | {
      kind: 'unit';
      batchId: string;
      unitId: string;
      unitRevision: number;
      designSource: DesignSourceBinding;
      implementationTarget: ImplementationTarget;
    }
  | {
      kind: 'existing';
      implementationTarget: ImplementationTarget;
      designSource: DesignSourceBinding | null;
    };

export interface ApprovedReferenceV2 {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  revokedReason: string | null;
  source: ApprovedReferenceSource;
  approvedByUser: true;
}

export interface ExistingReferenceDefinition {
  id: string;
  name: string;
  implementationTarget: ImplementationTarget;
  designSource: DesignSourceBinding | null;
}

export interface MigrationStateV2 {
  schemaVersion: 2;
  batches: ReplicationBatch[];
  approvedReferences: ApprovedReferenceV2[];
}

export interface BatchCounts {
  total: number;
  pending: number;
  inProgress: number;
  implemented: number;
  validated: number;
  blocked: number;
  accepted: number;
  rejected: number;
}

export interface BatchSummary {
  batchId: string;
  executionStatus: 'pending' | 'in_progress' | 'partial' | 'complete' | 'blocked';
  acceptanceStatus: 'pending' | 'partial' | 'accepted' | 'rejected';
  counts: BatchCounts;
}
```

- [ ] **Step 6: Implement strict parsing, canonical hashing, summaries, and graph validation**

Implement `validateMigrationStateV2(value: unknown): MigrationStateV2` with exact top-level key checking, strict required keys for batch/unit/source/target/acceptance, stable error messages, credential rejection, and safe relative paths. Implement canonical key sorting before SHA-256:

```ts
export function migrationStateFingerprint(state: MigrationStateV2): string {
  const canonical = canonicalJson(validateMigrationStateV2(state));
  return createHash('sha256').update(canonical).digest('hex');
}

export function summarizeBatch(batch: ReplicationBatch): BatchSummary {
  const counts: BatchCounts = {
    total: batch.units.length,
    pending: batch.units.filter(({ status }) => status === 'pending').length,
    inProgress: batch.units.filter(({ status }) => status === 'in_progress').length,
    implemented: batch.units.filter(({ status }) => status === 'implemented').length,
    validated: batch.units.filter(({ status }) => status === 'validated').length,
    blocked: batch.units.filter(({ status }) => status === 'blocked').length,
    accepted: batch.units.filter(({ acceptance }) => acceptance.status === 'accepted').length,
    rejected: batch.units.filter(({ acceptance }) => acceptance.status === 'rejected').length,
  };
  const executionStatus = counts.total > 0 && counts.validated === counts.total
    ? 'complete'
    : counts.validated > 0
      ? 'partial'
      : counts.total > 0 && counts.blocked === counts.total
        ? 'blocked'
        : counts.pending === counts.total
          ? 'pending'
          : 'in_progress';
  const acceptanceStatus = counts.rejected > 0
    ? 'rejected'
    : counts.total > 0 && counts.accepted === counts.total
      ? 'accepted'
      : counts.accepted > 0
        ? 'partial'
        : 'pending';
  return { batchId: batch.id, executionStatus, acceptanceStatus, counts };
}
```

Implement `transitiveDependents(batch, unitId)` with a visited set and deterministic sorted output. Reject cycles before state persistence.

- [ ] **Step 7: Re-export the schema through the existing facade**

`src/core/migration.ts` must export schema-v2 aliases and keep these facade names:

```ts
export type MigrationState = MigrationStateV2;

export function emptyMigrationState(): MigrationStateV2 {
  return { schemaVersion: 2, batches: [], approvedReferences: [] };
}

export function validateMigrationState(value: unknown): MigrationStateV2 {
  return validateMigrationStateV2(value);
}
```

Export the public types/functions from `src/index.ts`.

- [ ] **Step 8: Run schema tests and current migration tests**

Run:

```bash
npx vitest run test/migration-schema.test.ts test/migration.test.ts
```

Expected: schema tests PASS; existing migration tests fail only where their schema-v1 fixtures now need intentional upgrade coverage.

- [ ] **Step 9: Gated checkpoint**

Run `git diff --check`. If explicit commit authorization exists, stage only Task 1 files and commit `feat: define multi-target migration schema`; otherwise leave changes uncommitted.

---

### Task 2: Add typed unit mutations and dependency invalidation

**Files:**
- Create: `src/core/migration-mutations.ts`
- Create: `test/migration-mutations.test.ts`
- Modify: `src/core/migration.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: schema types, batch summary, canonical state fingerprint, dependency and approved-reference consumer traversal.
- Produces: `applyBatchDefinition()`, `inspectMigrationState()`, `applyUnitMutation()`, `applyReferenceMutation()`, `UnitMutation`, `ReferenceMutation`, `UnitRevisionConflictError`, `ApprovedReferenceConflictError`, and immutable mutation results.

- [ ] **Step 1: Write failing transition tests**

Use the Task 1 factory and test these exact actions:

```ts
it('advances one unit without changing a sibling unit', () => {
  const state = stateWithUnits(['page', 'modal']);
  const result = applyUnitMutation(state, 'account-center', 'page', 1, { action: 'start' }, false);

  expect(result.unit).toMatchObject({ id: 'page', status: 'in_progress', revision: 2 });
  expect(result.state.batches[0].units.find(({ id }) => id === 'modal')).toMatchObject({ status: 'pending', revision: 1 });
  expect(state.batches[0].units.find(({ id }) => id === 'page')).toMatchObject({ status: 'pending', revision: 1 });
});

it('requires current evidence to mark a unit validated', () => {
  const state = stateWithImplementedUnit();
  expect(() => applyUnitMutation(state, 'account-center', 'page', 2, {
    action: 'mark-validated',
    packageFingerprint: 'a'.repeat(64),
    visualEvidence: [],
    businessEvidence: ['npm test: passed'],
  }, false)).toThrow(/visual evidence/i);
});
```

Add separate tests for pending→implemented rejection, blocked→validated rejection, block requiring blockers, blocked→start recovery, accept requiring validated plus confirmation, reject reopening, revision mismatch, and immutable input state.

Add reference tests for approve-unit requiring validated+accepted, approve-existing requiring explicit implementation target/files, all reference actions requiring user confirmation, revoke retaining its reason and historical record, and source-unit reopen/reject invalidating consumers across batches. Prove exact duplicate approval is idempotent, same-ID/different-definition approval returns `approved_reference_conflict`, a revoked ID cannot be reactivated, and replacement requires a newly confirmed ID.

- [ ] **Step 2: Write failing reopen and dependency tests**

```ts
it('archives evidence and reopens transitive dependents', () => {
  const state = stateWithValidatedDependencyChain();
  const result = applyUnitMutation(state, 'account-center', 'shared-component', 4, {
    action: 'reopen',
    reason: 'design_changed',
  }, false);

  expect(result.unit).toMatchObject({ status: 'in_progress', visualEvidence: [], businessEvidence: [] });
  expect(result.unit.validationHistory).toHaveLength(1);
  expect(result.invalidatedUnitIds).toEqual(['orders-modal', 'orders-page']);
  for (const id of result.invalidatedUnitIds) {
    expect(findUnit(result.state, id)).toMatchObject({ status: 'in_progress', acceptance: { status: 'pending' } });
  }
});
```

- [ ] **Step 3: Write failing batch apply and bounded inspect tests**

Test create, exact idempotence, stale state fingerprint rejection, upsert without deletion, changed definition reopening the unit/dependents, and `inspectMigrationState(state, batchId, unitId)` returning only the requested object.

- [ ] **Step 4: Run the mutation tests and confirm the red state**

```bash
npx vitest run test/migration-mutations.test.ts
```

Expected: FAIL because mutation functions do not exist.

- [ ] **Step 5: Implement the mutation union and result types**

```ts
export type UnitMutation =
  | { action: 'start' }
  | { action: 'mark-implemented'; implementationFiles: string[]; runtimeLocator: string | null }
  | { action: 'block'; blockers: UnitBlocker[] }
  | { action: 'mark-validated'; packageFingerprint: string; visualEvidence: string[]; businessEvidence: string[] }
  | { action: 'reopen'; reason: string }
  | { action: 'accept'; note: string | null }
  | { action: 'reject'; reason: string }
  | { action: 'update-definition'; changes: UnitDefinitionChanges };

export type ReferenceMutation =
  | { action: 'approve-unit'; id: string; name: string; batchId: string; unitId: string }
  | { action: 'approve-existing'; reference: ExistingReferenceDefinition }
  | { action: 'revoke'; referenceId: string; reason: string };

export interface UnitMutationResult {
  state: MigrationStateV2;
  batch: ReplicationBatch;
  unit: ReplicationUnit;
  summary: BatchSummary;
  invalidatedUnitIds: string[];
}

export class UnitRevisionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`Unit revision conflict: expected ${expected}, actual ${actual}`);
    this.name = 'UnitRevisionConflictError';
  }
}
```

- [ ] **Step 6: Implement immutable state transitions**

Deep-clone validated JSON state before mutation. Enforce the explicit transition matrix in one function:

```ts
const ALLOWED: Record<UnitMutation['action'], readonly UnitStatus[]> = {
  start: ['pending', 'blocked'],
  'mark-implemented': ['in_progress'],
  block: ['pending', 'in_progress', 'implemented'],
  'mark-validated': ['implemented'],
  reopen: ['validated'],
  accept: ['validated'],
  reject: ['validated'],
  'update-definition': ['pending', 'in_progress', 'implemented', 'blocked', 'validated'],
};
```

`mark-validated` must bind the supplied fingerprint to `designSource.packageFingerprint`; mismatch is `package_changed`. `reopen`, `reject`, or definition change archives a full revision/source/target/evidence/acceptance snapshot when current validation evidence exists, clears active evidence/blockers, increments revisions, automatically revokes active references sourced from that unit, and invalidates transitive dependents. `reopen` and definition changes reset acceptance to pending; `reject` moves the unit to in-progress with `acceptance.status: 'rejected'` and the reason as its note; the next successful `mark-validated` resets acceptance to pending. Pending/in-progress definition edits with no validation snapshot do not create empty history entries. Consumers of revoked references archive evidence and become blocked with `approved_reference_revoked` while retaining the reference ID. Revalidation never auto-reactivates a revoked reference.

`applyReferenceMutation` requires `confirmedByUser=true`. `approve-unit` resolves an existing validated+accepted unit and snapshots its current revision, design source, runtime locator, and implementation files into the immutable reference; active unit references must still match that accepted revision. `approve-existing` accepts only an `ExistingReferenceDefinition`, validates the complete target/files, and creates runtime `status: 'active'`, `revokedReason: null`, and `approvedByUser: true` itself. Approved definitions are immutable: exact duplicate approval is idempotent, while same ID with different canonical content throws `ApprovedReferenceConflictError`; a revoked ID can never be reactivated. `revoke` sets `status: 'revoked'` and records the reason rather than deleting. Revocation archives evidence and blocks every direct/transitive consumer with `approved_reference_revoked`; it does not silently reopen them.

- [ ] **Step 7: Implement batch apply and bounded inspection**

`applyBatchDefinition` must accept a validated `ReplicationBatchDefinition`, create revision/status/blockers/evidence/history/acceptance itself, and extend each new target definition with `runtimeLocator: null` plus `implementationFiles: []`. Compare only canonical definition projections, require an expected state fingerprint for any changed existing batch, upsert units by ID, never remove omitted units, and return the new state plus summary. A changed existing definition increments revisions, archives current evidence, resets acceptance, clears runtime locator/files, and reopens the unit/dependents; exact idempotent input preserves runtime fields and revisions. `inspectMigrationState` must return state summaries, one batch, or one unit without returning unrelated validation history.

- [ ] **Step 8: Run schema and mutation tests**

```bash
npx vitest run test/migration-schema.test.ts test/migration-mutations.test.ts
```

Expected: PASS.

- [ ] **Step 9: Gated checkpoint**

Run `git diff --check`. If explicit commit authorization exists, stage only Task 2 files and commit `feat: add typed migration unit mutations`; otherwise leave changes uncommitted.

---

### Task 3: Add cross-process locking and atomic mutation persistence

**Files:**
- Create: `src/core/migration-lock.ts`
- Modify: `src/core/migration.ts`
- Modify: `src/core/migration-mutations.ts`
- Modify: `test/migration-mutations.test.ts`

**Interfaces:**
- Produces: `withMigrationLock<T>(stateFile, operation, options?)`, `applyBatch()`, `updateMigrationUnit()`, and `inspectMigration()` asynchronous external-workspace operations.
- Preserves: atomic sibling temporary file plus rename publication semantics.

- [ ] **Step 1: Add failing lock behavior tests**

Test serialization of two delayed updates to different units, revision conflict for two updates to the same unit, release after thrown operation, a dead-owner stale lock takeover, a stale-looking but live-owner lock that is never stolen, malformed/uncertain lock metadata timing out safely, active lock timeout, and no `.lock`/`.tmp` residue after completion.

```ts
it('serializes different-unit updates without losing either result', async () => {
  const fixture = await setupStateWithTwoUnits();
  await Promise.all([
    updateMigrationUnit(fixture.target, 'batch', 'page', 1, { action: 'start' }, false, fixture.options),
    updateMigrationUnit(fixture.target, 'batch', 'modal', 1, { action: 'start' }, false, fixture.options),
  ]);

  const loaded = await loadMigrationState(fixture.target, fixture.options);
  expect(findUnit(loaded.state, 'page').status).toBe('in_progress');
  expect(findUnit(loaded.state, 'modal').status).toBe('in_progress');
});
```

- [ ] **Step 2: Run the lock tests and confirm failure**

```bash
npx vitest run test/migration-mutations.test.ts -t 'serializes|lock|revision'
```

Expected: FAIL because mutations are not persisted under a lock.

- [ ] **Step 3: Implement the bounded lock**

Create a sibling `migration.json.lock` with `open(path, 'wx')`, store non-sensitive `{ pid, acquiredAt, ownerNonce }`, and retry with a short bounded delay. Age alone must never authorize deletion. A stale lock may be reclaimed only after its metadata is parsed, its owner process is proven absent, the same nonce is observed again immediately before reclamation, and the implementation's compare/reclaim operation cannot remove a replacement lock. If liveness, ownership, or atomic replacement safety is uncertain, preserve the lock and return a bounded timeout diagnostic instead of stealing it. Release only the caller's own nonce in `finally`; a long-running live owner must not be reclaimed merely because `staleMs` elapsed.

```ts
export interface MigrationLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  now?: () => number;
}

export class MigrationLockTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the migration state lock');
    this.name = 'MigrationLockTimeoutError';
  }
}

export async function withMigrationLock<T>(
  stateFile: string,
  operation: () => Promise<T>,
  options: MigrationLockOptions = {},
): Promise<T>;
```

Defaults: `timeoutMs=5000`, `staleMs=30000`, `retryMs=25`. Tests inject shorter deterministic values.

- [ ] **Step 4: Implement locked external operations**

In `src/core/migration.ts`, add:

```ts
export async function applyBatch(
  targetDirectory: string,
  definition: ReplicationBatchDefinition,
  expectedStateFingerprint: string | undefined,
  options: MigrationOptions = {},
): Promise<MigrationBatchOperationResult>;

export async function updateMigrationUnit(
  targetDirectory: string,
  batchId: string,
  unitId: string,
  expectedRevision: number,
  mutation: UnitMutation,
  confirmedByUser: boolean,
  options: MigrationOptions = {},
): Promise<MigrationUnitOperationResult>;

export async function updateApprovedReference(
  targetDirectory: string,
  expectedStateFingerprint: string,
  mutation: ReferenceMutation,
  confirmedByUser: boolean,
  options: MigrationOptions = {},
): Promise<MigrationReferenceOperationResult>;

export async function inspectMigration(
  targetDirectory: string,
  batchId: string | undefined,
  unitId: string | undefined,
  options: MigrationOptions = {},
): Promise<MigrationInspectResult>;
```

Each mutation resolves the workspace, acquires the lock, rereads and validates current bytes, applies the pure mutation, writes a sibling UUID temporary file, renames it atomically, and removes temporary/lock files in `finally`.

- [ ] **Step 5: Run migration mutation and I/O tests**

```bash
npx vitest run test/migration-mutations.test.ts test/migration.test.ts
```

Expected: PASS except intentional schema-v1 upgrade tests added in Task 4.

- [ ] **Step 6: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 3 as `feat: serialize migration state mutations`; otherwise do not commit.

---

### Task 4: Preserve schema-v1 state through explicit upgrade

**Files:**
- Modify: `src/core/migration.ts`
- Modify: `test/migration.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `MigrationStateV1`, `ReadableMigrationState`, `MigrationReadResult`, `validateMigrationStateV1()`, `upgradeMigrationState()`, `LegacyMigrationMappingRequiredError`, and external `migration.v1.backup.json`.
- Preserves: safe legacy repository import and divergent dual-state refusal.

- [ ] **Step 1: Replace old generic-schema tests with explicit v1 fixtures**

Add a local `MigrationStateV1` fixture matching the former exact keys. Test:

1. `migration validate` recognizes v1 without mutating bytes.
2. Empty v1 upgrades on the first v2 batch apply.
3. Non-empty v1 targets throw `LegacyMigrationMappingRequiredError`.
4. Explicit definition/index mapping upgrades every target into a pending unit and preserves approved references.
5. A validated external backup is written before replacement.
6. Failed upgrade preserves original and backup bytes.
7. Existing repository `.design-context/migration.json` import remains non-destructive.

- [ ] **Step 2: Run migration tests and verify the upgrade cases fail**

```bash
npx vitest run test/migration.test.ts
```

Expected: FAIL because current code only understands one schema.

- [ ] **Step 3: Implement the discriminated read result**

Use explicit read types so callers cannot treat v1 as v2:

```ts
export interface ApprovedReferenceV1 {
  route: string;
  implementation: string;
  designUrl?: string;
  approvedByUser: true;
}

export interface MigrationStateV1 {
  schemaVersion: 1;
  targets: Array<Record<string, unknown>>;
  approvedReferences: ApprovedReferenceV1[];
  legacyBehaviorSources: unknown[];
  protected: unknown[];
  validations: unknown[];
}

export type ReadableMigrationState = MigrationStateV1 | MigrationStateV2;

export interface MigrationReadResult {
  state: ReadableMigrationState;
  workspace: WorkspacePaths;
  diagnostics: Diagnostic[];
  schemaStatus: 'current' | 'upgrade_required';
}
```

`loadMigrationState()`, `initializeMigrationState()`, and repository import return `MigrationReadResult`: initialization creates v2 when no state exists, but a validated imported/existing v1 remains explicitly `upgrade_required`. `applyBatch()`, `updateMigrationUnit()`, and `upgradeMigrationState()` return v2 operation results. Add a private `requireWritableMigrationState()` that converts an empty v1 during a v2 mutation and throws `LegacyMigrationMappingRequiredError` for a non-empty v1.

- [ ] **Step 4: Implement read-only v1 recognition and safe conversion**

Define a private strict v1 parser with former top-level keys. Public v2 mutations refuse non-empty v1 unless an explicit mapping is provided. Empty v1 converts to `{ schemaVersion: 2, batches: [], approvedReferences }`; each validated v1 reference converts to an active `existing` v2 reference with ID `legacy-${sha256(canonicalReference).slice(0, 12)}`, its route as name and `hostRoute`, target type `page`, its implementation as the single implementation file, `revokedReason: null`, and `approvedByUser: true`. Reject the upgrade if generated IDs collide.

Add:

```ts
export interface MigrationUpgradeMapping {
  batches: ReplicationBatchDefinition[];
  targetMappings: Array<{
    legacyTargetIndex: number;
    batchId: string;
    unitId: string;
  }>;
}

export async function upgradeMigrationState(
  targetDirectory: string,
  mapping: MigrationUpgradeMapping,
  options: MigrationOptions = {},
): Promise<MigrationOperationResult>;
```

Require every v1 target index exactly once, reject duplicate/out-of-range mappings and unknown batch/unit IDs, and reject all runtime fields through `validateBatchDefinition()`. Build runtime units inside the upgrader with revision 1, pending status, empty blockers/evidence/history, pending acceptance, null runtime locator, and empty implementation files. Do not promote legacy validation bytes into current evidence because they cannot satisfy the schema-v2 content-fingerprint and target-locator gates; return a sanitized `legacy_revalidation_required` diagnostic and preserve the complete v1 bytes in the backup.

Before atomic replacement, write and validate `migration.v1.backup.json` using exclusive creation. If a different backup already exists, stop with conflict rather than overwrite.

- [ ] **Step 5: Reconcile legacy repository import with both schemas**

Repository imports must validate v1 or v2 before copying. Equal external/repository canonical states remain readable; divergent states still throw `MigrationStateConflictError`. Never delete repository `.design-context`.

- [ ] **Step 6: Run migration suites**

```bash
npx vitest run test/migration-schema.test.ts test/migration-mutations.test.ts test/migration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 4 as `feat: add explicit migration v1 upgrade`; otherwise leave uncommitted.

---

### Task 5: Add content fingerprints and return canonical source from prepare

**Files:**
- Modify: `src/core/package.ts`
- Modify: `src/core/downloader.ts`
- Modify: `test/package.test.ts`
- Modify: `test/downloader.test.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Preserves: existing manifest `fingerprint` as request/cache identity and package manifest `schemaVersion: 1`.
- Produces: additive manifest `contentFingerprint`, `buildContentFingerprint()`, `PreparePackageResult.requestFingerprint`, `PreparePackageResult.contentFingerprint`, `PreparePackageResult.source`, and CLI `data.requestFingerprint`, `data.packageFingerprint`, `data.canonicalDesignSource`.

- [ ] **Step 1: Add failing content-fingerprint tests**

In `test/package.test.ts`, construct two otherwise identical packages whose root screenshot bytes differ and assert request fingerprints remain equal while content fingerprints differ. Also assert changing sorted asset bytes or normalized `design.json` changes content fingerprint, changing `source/raw.json` alone does not, and a declared fingerprint mismatch makes package validation invalid with `content_fingerprint_mismatch`.

```ts
const first = await buildContentFingerprint(firstPackage);
const second = await buildContentFingerprint(secondPackage);
expect(first).toMatch(/^[a-f0-9]{64}$/u);
expect(second).toMatch(/^[a-f0-9]{64}$/u);
expect(first).not.toBe(second);
expect(buildFingerprint(TARGET, 'png', 2)).toBe(buildFingerprint(TARGET, 'png', 2));
```

- [ ] **Step 2: Add failing cache-hit and fresh-package result tests**

```ts
expect(result).toMatchObject({
  requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
  contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
  source: {
    provider: 'fixture',
    documentId: 'document',
    nodeId: '1:2',
    sourceUrl: 'https://design.example/page?node=1-2',
  },
});
```

Run the same assertion for a fresh package and a matching cache hit. Add a refresh test whose adapter returns changed screenshot bytes: destination and request fingerprint remain the same, while content fingerprint changes.

- [ ] **Step 3: Run package/downloader tests and verify failure**

```bash
npx vitest run test/package.test.ts test/downloader.test.ts
```

Expected: FAIL because content hashing and dual-fingerprint result fields do not exist.

- [ ] **Step 4: Implement additive package content hashing**

Extend `PackageManifestV1` with optional `contentFingerprint?: string` so existing schema-v1 packages remain readable. New packages must write it. Compute SHA-256 from:

1. provider/documentId/nodeId and export format/scale;
2. canonical normalized `design.json` bytes;
3. root screenshot bytes;
4. each successfully declared asset, ordered by node ID, including node ID, relative path, and bytes;
5. sanitized package status and diagnostic code/retryable/nodeId fields.

Do not include `source/raw.json`, absolute paths, diagnostic messages, timestamps, or the content fingerprint itself. `validatePackage` recomputes and rejects a mismatch when the field is present. Old packages without it remain valid and compute the value on demand during prepare.

```ts
export async function buildContentFingerprint(packageDirectory: string): Promise<string>;
```

- [ ] **Step 5: Extend prepare results without changing cache identity**

```ts
export interface PreparePackageResult {
  packageDirectory: string;
  validation: PackageValidation;
  cacheHit: boolean;
  provider: string;
  requestFingerprint: string;
  contentFingerprint: string;
  source: DesignTarget;
}
```

Return the same `target`, request fingerprint, and computed content fingerprint from both branches. Do not change `buildFingerprint`, cache keys, package directories, or manifest schemaVersion 1.

- [ ] **Step 6: Add the fields to the CLI prepare envelope**

```ts
requestFingerprint: result.requestFingerprint,
packageFingerprint: result.contentFingerprint,
canonicalDesignSource: {
  provider: result.source.provider,
  documentId: result.source.documentId,
  nodeId: result.source.nodeId,
  url: result.source.sourceUrl,
},
```

Update all test dependency doubles to return the new fields.

- [ ] **Step 7: Run package, downloader, and CLI prepare tests**

```bash
npx vitest run test/package.test.ts test/downloader.test.ts test/cli.test.ts -t 'prepare|refresh|package|fingerprint'
```

Expected: PASS.

- [ ] **Step 8: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 5 as `feat: expose prepared design fingerprints`; otherwise do not commit.

---

### Task 6: Expose batch, unit, reference, inspect, and upgrade CLI commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: async operations from Tasks 3–5.
- Produces: `migration batch apply`, `migration unit update`, `migration reference update`, `migration inspect`, and `migration upgrade` JSON contracts.

- [ ] **Step 1: Add failing CLI contract tests for every new command**

Create temporary input files outside the target repository and assert:

```ts
expect(JSON.parse(stdout)).toMatchObject({
  ok: true,
  command: 'migration.batch.apply',
  status: 'applied',
  data: {
    stateFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    batch: { id: 'account-center', revision: 1 },
    summary: { executionStatus: 'pending' },
  },
});
```

Add tests for bounded inspect, start mutation, validated evidence gates, accept without/with `--confirmed-by-user`, approve-unit/approve-existing/revoke reference actions, immutable-reference conflicts, reference consumer invalidation, unit revision conflict, state fingerprint conflict, dependency cycle, v1 definition/index upgrade, legacy revalidation diagnostics, and sanitized diagnostics.

- [ ] **Step 2: Add failing input-path safety tests**

Test a batch input inside a real Git worktree with no `--allow-in-repo`: exit 30, diagnostic `in_repo_input_refused`, no state mutation, and no provider call. Test explicit manual `--allow-in-repo` returns a risk diagnostic. Test a symlink and `../` path cannot bypass containment.

- [ ] **Step 3: Run CLI tests and verify the red state**

```bash
npx vitest run test/cli.test.ts
```

Expected: FAIL with unknown migration commands/options.

- [ ] **Step 4: Extend help and nested dispatch**

Add exact usage lines:

```text
design-context migration batch apply TARGET_DIR --input FILE [--expected-state-fingerprint HASH] [--allow-in-repo] [--json]
design-context migration unit update TARGET_DIR --batch ID --unit ID --expected-revision N --input FILE [--confirmed-by-user] [--allow-in-repo] [--json]
design-context migration reference update TARGET_DIR --expected-state-fingerprint HASH --input FILE --confirmed-by-user [--allow-in-repo] [--json]
design-context migration inspect TARGET_DIR [--batch ID] [--unit ID] [--json]
design-context migration upgrade TARGET_DIR --input FILE [--allow-in-repo] [--json]
```

Implement nested parsing without weakening unknown-option rejection. `--unit` requires `--batch`; unit `accept` and every reference mutation require `--confirmed-by-user`; `--confirmed-by-user` is invalid for unrelated unit actions.

- [ ] **Step 5: Implement safe JSON input loading**

Resolve input realpath, locate the target Git worktree using existing workspace containment helpers, reject in-repository input before reading/mutating unless explicitly allowed, parse UTF-8 JSON with a stable `invalid_input_json` diagnostic, and never echo input content in errors.

- [ ] **Step 6: Return bounded envelopes and typed conflicts**

Add error mapping:

- `UnitRevisionConflictError` -> `unit_revision_conflict`;
- state fingerprint mismatch -> `migration_state_conflict`;
- `MigrationLockTimeoutError` -> `migration_lock_timeout`;
- v1 mapping gate -> `legacy_mapping_required`;
- invalid/revoked approved reference -> `approved_reference_invalid` / `approved_reference_revoked`;
- same-ID/different approved reference -> `approved_reference_conflict`;
- successful non-empty v1 conversion -> non-fatal `legacy_revalidation_required` diagnostic;
- missing evidence -> `evidence_missing`;
- unconfirmed accept -> `user_confirmation_required`.

Keep top-level command status about command success; put batch execution and acceptance status under `data.summary`.

- [ ] **Step 7: Run all CLI and migration tests**

```bash
npx vitest run test/cli.test.ts test/migration-schema.test.ts test/migration-mutations.test.ts test/migration.test.ts test/downloader.test.ts
```

Expected: PASS.

- [ ] **Step 8: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 6 as `feat: add migration batch CLI workflow`; otherwise do not commit.

---

### Task 7: Core regression and zero-pollution acceptance

**Files:**
- Modify: `test/repository-install.test.ts`
- Modify only implementation/test files required by failures caused by this plan.

**Interfaces:**
- Consumes: all Core/CLI tasks.
- Produces: installed-runtime and real temporary repository acceptance evidence.

- [ ] **Step 1: Extend the installed CLI smoke test**

After installer setup, create an external batch input file with one page unit and one modal unit, run `migration batch apply`, update the page through implemented/validated, block the modal, and assert the batch summary is partial. Finish with:

```ts
expect((await execute('git', ['-C', target, 'status', '--porcelain'])).stdout).toBe('');
await expect(access(join(target, '.design-context'))).rejects.toThrow();
```

- [ ] **Step 2: Run the installed-runtime test**

```bash
npx vitest run test/repository-install.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full project gate**

```bash
npm run check
```

Expected: secret scan, typecheck, lint, all tests, and build PASS.

- [ ] **Step 4: Perform a real `mktemp` Git smoke test**

Use an explicit temporary root and isolated environment variables:

```bash
SMOKE_ROOT="$(mktemp -d)"
TARGET_DIR="$SMOKE_ROOT/target"
STATE_DIR="$SMOKE_ROOT/state"
CACHE_DIR="$SMOKE_ROOT/cache"
mkdir -p "$TARGET_DIR"
git -C "$TARGET_DIR" init --quiet
DESIGN_CONTEXT_STATE_HOME="$STATE_DIR" DESIGN_CONTEXT_CACHE_HOME="$CACHE_DIR" node dist/cli.js migration init "$TARGET_DIR" --json
git -C "$TARGET_DIR" status --porcelain
```

Then create batch/mutation input under `$SMOKE_ROOT/input`, exercise page validated plus modal blocked, inspect each unit, and rerun `git status --porcelain`.

Expected: both status outputs are empty; every returned state/package/evidence path is outside `$TARGET_DIR`; batch execution status is `partial`.

- [ ] **Step 5: Self-review against the design**

Map each core design requirement to a passing test, search plan implementation for inconsistent type/property names, and run:

```bash
rg -n "T[B]D|T[O]DO|implement[ ]later|add[ ]appropriate|similar[ ]to" docs/superpowers/plans/2026-08-11-multi-target-migration-core-cli.md
git diff --check
git status --short
```

Expected: no plan placeholders, clean whitespace, and only intended uncommitted files.

- [ ] **Step 6: Gated delivery**

Do not commit or push without explicit authorization. If authorization is later provided, inspect `git diff --cached --name-only`, stage only Core/CLI plan implementation files, run `npm run check` again, and commit with a reviewed message.
