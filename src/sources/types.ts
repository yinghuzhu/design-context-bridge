import type {
  DesignDocument,
  DesignTarget,
  Diagnostic,
} from '../core/models.js';

export type ExportFormat = 'png' | 'jpg' | 'svg';

export interface SourcePrepareOptions {
  format: ExportFormat;
  scale: number;
}

export interface RemoteAsset {
  id: string;
  name: string;
  type: string;
  url: string;
  rootScreenshot: boolean;
}

export interface PreparedSource {
  raw: unknown;
  design: DesignDocument;
  screenshot: RemoteAsset;
  assets: RemoteAsset[];
  diagnostics: Diagnostic[];
}

export interface DesignSourceAdapter {
  readonly provider: string;
  supports(url: URL): boolean;
  parse(url: URL): DesignTarget;
  prepare(
    target: DesignTarget,
    options: SourcePrepareOptions,
  ): Promise<PreparedSource>;
  download(asset: RemoteAsset, destination: string): Promise<void>;
}
