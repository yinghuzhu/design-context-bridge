import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateContextFiles as generateContextFilesDefault } from './core/context.js';
import { preparePackage as preparePackageDefault } from './core/downloader.js';
import {
  initializeMigrationState as initializeMigrationStateDefault,
  loadMigrationState as loadMigrationStateDefault,
  migrationStatePath,
} from './core/migration.js';
import type { Diagnostic, PackageValidation } from './core/models.js';
import { validatePackage as validatePackageDefault } from './core/package.js';
import { PackageRenderError, renderPackage as renderPackageDefault } from './core/renderer.js';
import { FigmaAdapter, type FigmaClientContract } from './sources/figma/adapter.js';
import { FigmaDownloadSizeError, FigmaHttpError, FigmaNetworkError } from './sources/figma/client.js';
import { SourceRegistry } from './sources/registry.js';
import { VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_INVALID_PACKAGE = 20;
export const EXIT_INVALID_INPUT = 30;
export const EXIT_AUTH = 40;
export const EXIT_SOURCE = 50;
export const EXIT_FILESYSTEM = 60;

const HELP = `design-context

Prepare deterministic design-platform context packages for multimodal Agents.

Usage:
  design-context prepare URL --output DIR [--provider NAME] [--format png|jpg|svg] [--scale N] [--force|--refresh] [--json]
  design-context inspect PACKAGE [--json]
  design-context validate-package PACKAGE [--json]
  design-context render PACKAGE [--output FILE] [--compare] [--json]
  design-context status PACKAGE [--json]
  design-context migration init TARGET_DIR [--json]
  design-context migration validate TARGET_DIR [--json]
`;

export class MissingTokenError extends Error {
  constructor() {
    super('A provider credential is required when no matching cache is available');
    this.name = 'MissingTokenError';
  }
}

export interface CliDependencies {
  env: Record<string, string | undefined>;
  stdout(value: string): void;
  stderr(value: string): void;
  preparePackage?: typeof preparePackageDefault;
  generateContextFiles?: typeof generateContextFilesDefault;
  validatePackage?: typeof validatePackageDefault;
  renderPackage?: typeof renderPackageDefault;
  initializeMigrationState?: typeof initializeMigrationStateDefault;
  loadMigrationState?: typeof loadMigrationStateDefault;
  registry?: SourceRegistry;
}

interface Envelope {
  ok: boolean;
  command: string;
  status: string;
  data: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

interface ParsedOptions {
  positional: string[];
  values: Record<string, string>;
  flags: Set<string>;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  supplied: Partial<CliDependencies> = {},
): Promise<number> {
  const dependencies: CliDependencies = {
    env: process.env,
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    ...supplied,
  };
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) {
    dependencies.stdout(`${VERSION}\n`);
    return EXIT_OK;
  }
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    dependencies.stderr(HELP);
    return EXIT_OK;
  }
  const jsonMode = argv.includes('--json');
  const argumentsWithoutJson = argv.filter((value) => value !== '--json');
  const commandHint = commandName(argumentsWithoutJson);
  let envelope: Envelope;
  let exitCode: number;
  try {
    [envelope, exitCode] = await dispatch(argumentsWithoutJson, dependencies);
  } catch (error) {
    [envelope, exitCode] = errorEnvelope(commandHint, error);
  }
  emit(envelope, jsonMode, dependencies);
  return exitCode;
}

async function dispatch(argv: readonly string[], dependencies: CliDependencies): Promise<[Envelope, number]> {
  const command = argv[0];
  if (command === 'prepare') return prepareCommand(argv.slice(1), dependencies);
  if (['inspect', 'validate-package', 'status'].includes(command ?? '')) {
    const parsed = parseOptions(argv.slice(1), new Set(), new Set());
    requireCount(parsed.positional, 1, `${command} requires one package directory`);
    const packageDirectory = resolve(parsed.positional[0] ?? '');
    const validation = await (dependencies.validatePackage ?? validatePackageDefault)(packageDirectory);
    return validationEnvelope(command ?? 'unknown', validation, { packageDirectory });
  }
  if (command === 'render') {
    const parsed = parseOptions(argv.slice(1), new Set(['--output']), new Set(['--compare']));
    requireCount(parsed.positional, 1, 'render requires one package directory');
    const packageDirectory = resolve(parsed.positional[0] ?? '');
    const validation = await (dependencies.validatePackage ?? validatePackageDefault)(packageDirectory);
    if (validation.status === 'invalid') return validationEnvelope('render', validation, { packageDirectory });
    const result = await (dependencies.renderPackage ?? renderPackageDefault)(packageDirectory, {
      ...(parsed.values['--output'] === undefined ? {} : { output: parsed.values['--output'] }),
      compare: parsed.flags.has('--compare'),
    });
    return validationEnvelope('render', validation, { packageDirectory, ...result });
  }
  if (command === 'migration') return migrationCommand(argv.slice(1), dependencies);
  throw new Error(`Unknown command: ${command ?? ''}`);
}

async function prepareCommand(argv: readonly string[], dependencies: CliDependencies): Promise<[Envelope, number]> {
  const parsed = parseOptions(
    argv,
    new Set(['--output', '--provider', '--format', '--scale']),
    new Set(['--force', '--refresh']),
  );
  requireCount(parsed.positional, 1, 'prepare requires one design URL');
  const outputRoot = parsed.values['--output'];
  if (outputRoot === undefined) throw new Error('prepare requires --output DIR');
  const format = parsed.values['--format'] ?? 'png';
  if (!['png', 'jpg', 'svg'].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  const scale = Number(parsed.values['--scale'] ?? '2');
  if (!Number.isInteger(scale) || scale < 1) throw new Error('Scale must be a positive integer');
  const registry = dependencies.registry ?? defaultRegistry(dependencies.env);
  const result = await (dependencies.preparePackage ?? preparePackageDefault)(
    parsed.positional[0] ?? '',
    registry,
    {
      outputRoot,
      ...(parsed.values['--provider'] === undefined ? {} : { provider: parsed.values['--provider'] }),
      format: format as 'png' | 'jpg' | 'svg',
      scale,
      force: parsed.flags.has('--force') || parsed.flags.has('--refresh'),
    },
  );
  const context = await (dependencies.generateContextFiles ?? generateContextFilesDefault)(result.packageDirectory);
  return validationEnvelope('prepare', result.validation, {
    packageDirectory: result.packageDirectory,
    cacheHit: result.cacheHit,
    provider: result.provider,
    contextFiles: [context.context, context.styles, context.components],
  });
}

async function migrationCommand(argv: readonly string[], dependencies: CliDependencies): Promise<[Envelope, number]> {
  const operation = argv[0];
  const parsed = parseOptions(argv.slice(1), new Set(), new Set());
  requireCount(parsed.positional, 1, 'migration command requires one target directory');
  const targetDirectory = resolve(parsed.positional[0] ?? '');
  if (operation === 'init') {
    const state = await (dependencies.initializeMigrationState ?? initializeMigrationStateDefault)(targetDirectory);
    return [successEnvelope('migration.init', 'initialized', { targetDirectory, stateFile: migrationStatePath(targetDirectory), schemaVersion: state.schemaVersion }), EXIT_OK];
  }
  if (operation === 'validate') {
    const state = await (dependencies.loadMigrationState ?? loadMigrationStateDefault)(targetDirectory);
    return [successEnvelope('migration.validate', 'valid', { targetDirectory, stateFile: migrationStatePath(targetDirectory), schemaVersion: state.schemaVersion }), EXIT_OK];
  }
  throw new Error(`Unknown migration command: ${operation ?? ''}`);
}

function defaultRegistry(env: Record<string, string | undefined>): SourceRegistry {
  const token = env.FIGMA_TOKEN;
  const client = token === undefined || token.length === 0 ? new MissingTokenClient() : token;
  return new SourceRegistry([new FigmaAdapter(client)]);
}

class MissingTokenClient implements FigmaClientContract {
  async fetchNode(): Promise<unknown> { throw new MissingTokenError(); }
  async exportImageUrls(): Promise<{ urls: Record<string, string>; diagnostics: Diagnostic[] }> { throw new MissingTokenError(); }
  async download(): Promise<void> { throw new MissingTokenError(); }
}

function parseOptions(
  argv: readonly string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>,
): ParsedOptions {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    if (booleanOptions.has(token)) {
      flags.add(token);
      continue;
    }
    if (valueOptions.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${token} requires a value`);
      values[token] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }
  return { positional, values, flags };
}

function requireCount(values: readonly string[], expected: number, message: string): void {
  if (values.length !== expected) throw new Error(message);
}

function validationEnvelope(command: string, validation: PackageValidation, data: Record<string, unknown>): [Envelope, number] {
  const ok = validation.status !== 'invalid';
  return [{ ok, command, status: validation.status, data, diagnostics: validation.diagnostics.map(sanitizeDiagnostic) }, ok ? EXIT_OK : EXIT_INVALID_PACKAGE];
}

function successEnvelope(command: string, status: string, data: Record<string, unknown>): Envelope {
  return { ok: true, command, status, data, diagnostics: [] };
}

function errorEnvelope(command: string, error: unknown): [Envelope, number] {
  let code = 'invalid_input';
  let message = 'The command input is invalid.';
  let retryable = false;
  let exitCode = EXIT_INVALID_INPUT;
  let status = 'invalid';
  if (error instanceof MissingTokenError) {
    code = 'missing_token';
    message = 'FIGMA_TOKEN is required when no matching package is available in cache.';
    exitCode = EXIT_AUTH;
    status = 'error';
  } else if (error instanceof FigmaHttpError) {
    code = error.kind === 'auth' ? 'source_auth_failed' : 'source_api_failed';
    message = error.kind === 'auth' ? 'The design source rejected its configured credential.' : 'The design source API request failed.';
    retryable = error.kind !== 'auth';
    exitCode = error.kind === 'auth' ? EXIT_AUTH : EXIT_SOURCE;
    status = 'error';
  } else if (error instanceof FigmaNetworkError) {
    code = 'source_api_failed';
    message = 'The design source API request failed.';
    retryable = true;
    exitCode = EXIT_SOURCE;
    status = 'error';
  } else if (error instanceof FigmaDownloadSizeError) {
    code = 'source_asset_too_large';
    message = 'A design source asset exceeds the configured download size limit.';
    exitCode = EXIT_SOURCE;
    status = 'error';
  } else if (error instanceof PackageRenderError) {
    code = error.code;
    message = 'The context package cannot be rendered.';
    exitCode = EXIT_INVALID_PACKAGE;
  } else if (isErrno(error) && error.code === 'ENOENT') {
    code = 'missing_input';
    message = 'A required input file or directory does not exist.';
  } else if (isErrno(error)) {
    code = 'filesystem_error';
    message = 'A filesystem operation failed.';
    exitCode = EXIT_FILESYSTEM;
    status = 'error';
  } else if (error instanceof Error) {
    message = error.message;
  }
  return [{ ok: false, command, status, data: {}, diagnostics: [sanitizeDiagnostic({ code, message, retryable, nodeId: null })] }, exitCode];
}

function emit(envelope: Envelope, jsonMode: boolean, dependencies: CliDependencies): void {
  if (jsonMode) {
    dependencies.stdout(`${JSON.stringify(envelope)}\n`);
    return;
  }
  dependencies.stderr(`[${envelope.command}] ${envelope.status}\n`);
  for (const diagnostic of envelope.diagnostics) dependencies.stderr(`  - ${diagnostic.code}: ${diagnostic.message}\n`);
  for (const [key, value] of Object.entries(envelope.data)) dependencies.stderr(`  ${key}: ${String(value)}\n`);
}

function sanitizeDiagnostic(value: Diagnostic): Diagnostic {
  return {
    ...value,
    message: value.message
      .replace(/https?:\/\/\S+/giu, '[REDACTED_URL]')
      .replace(/((?:access_)?token|authorization|secret)=([^&\s]+)/giu, '$1=[REDACTED]'),
  };
}

function commandName(argv: readonly string[]): string {
  if (argv[0] === 'migration') return `migration.${argv[1] ?? 'unknown'}`;
  return argv[0] ?? 'unknown';
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string';
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
  main().then((exitCode) => { process.exitCode = exitCode; }).catch(() => { process.exitCode = EXIT_FILESYSTEM; });
}
