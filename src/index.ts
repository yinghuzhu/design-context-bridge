export type {
  DesignBounds,
  DesignDocument,
  DesignNode,
  DesignTarget,
  Diagnostic,
  PackageStatus,
  PackageValidation,
} from './core/models.js';
export {
  buildFingerprint,
  publishStaging,
  SCHEMA_VERSION,
  validatePackage,
} from './core/package.js';
export type {
  PackageManifestV1,
  PublishOperations,
} from './core/package.js';
export { SourceRegistry } from './sources/registry.js';
export type {
  DesignSourceAdapter,
  ExportFormat,
  PreparedSource,
  RemoteAsset,
  SourcePrepareOptions,
} from './sources/types.js';
export { parseFigmaUrl, supportsFigmaUrl } from './sources/figma/url.js';
export {
  FigmaClient,
  FigmaHttpError,
  FigmaNetworkError,
} from './sources/figma/client.js';
export { normalizeFigmaDocument, safeFigmaRaw } from './sources/figma/normalize.js';
export { FigmaAdapter } from './sources/figma/adapter.js';
export type { FigmaClientContract } from './sources/figma/adapter.js';
export { preparePackage } from './core/downloader.js';
export type {
  PreparePackageOptions,
  PreparePackageResult,
} from './core/downloader.js';
export {
  extractComponents,
  extractStyles,
  generateContextFiles,
} from './core/context.js';
export type { GeneratedContextFiles } from './core/context.js';
export { PackageRenderError, renderPackage } from './core/renderer.js';
export type { RenderOptions, RenderResult } from './core/renderer.js';
export {
  emptyMigrationState,
  initializeMigrationState,
  loadMigrationState,
  MIGRATION_SCHEMA_VERSION,
  MIGRATION_STATE_DIRECTORY,
  MIGRATION_STATE_FILENAME,
  migrationStatePath,
  validateMigrationState,
} from './core/migration.js';
export type {
  ApprovedReference,
  MigrationState,
  MigrationWriteOperations,
} from './core/migration.js';
