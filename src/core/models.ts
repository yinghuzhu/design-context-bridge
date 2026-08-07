export type PackageStatus = 'complete' | 'partial' | 'invalid';

export interface Diagnostic {
  code: string;
  message: string;
  retryable: boolean;
  nodeId: string | null;
}

export interface PackageValidation {
  status: PackageStatus;
  diagnostics: Diagnostic[];
}

export interface DesignTarget {
  provider: string;
  documentId: string;
  nodeId: string;
  sourceUrl: string;
  cacheKey: string;
}

export interface DesignBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignText {
  characters: string;
  style: Record<string, unknown>;
}

export interface DesignNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  bounds: DesignBounds | null;
  children: string[];
  style: Record<string, unknown>;
  text?: DesignText;
  assetRef?: string;
  componentRef?: string;
  componentProperties?: Record<string, unknown>;
}

export interface DesignDocument {
  provider: string;
  documentId: string;
  rootId: string;
  nodes: Record<string, DesignNode>;
}
