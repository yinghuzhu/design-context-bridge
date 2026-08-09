import type { DesignTarget } from '../../core/models.js';

const FIGMA_PATH_KINDS = new Set(['design', 'file', 'proto']);

export function supportsFigmaUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'figma.com' && !hostname.endsWith('.figma.com')) {
    return false;
  }
  const [kind, documentId] = pathSegments(url);
  return FIGMA_PATH_KINDS.has(kind ?? '') && Boolean(documentId);
}

export function parseFigmaUrl(input: string | URL): DesignTarget {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.href);
  if (!supportsFigmaUrl(url)) {
    throw new Error('Unsupported Figma URL');
  }

  const [, documentId] = pathSegments(url);
  if (documentId === undefined || documentId.length === 0) {
    throw new Error('Figma URL is missing the document ID');
  }
  const rawNodeId = url.searchParams.get('node-id');
  if (rawNodeId === null || rawNodeId.length === 0) {
    throw new Error('Figma URL is missing the node-id query parameter');
  }
  const nodeId = rawNodeId.replaceAll('-', ':');
  const versionId = url.searchParams.get('version-id');
  url.search = '';
  url.searchParams.set('node-id', rawNodeId);
  if (versionId !== null && versionId.length > 0) url.searchParams.set('version-id', versionId);

  return {
    provider: 'figma',
    documentId,
    nodeId,
    sourceUrl: url.href,
    cacheKey: `figma_${safeKey(documentId)}_${safeKey(nodeId.replaceAll(':', '-'))}`,
  };
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

function safeKey(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/g, '_');
  if (safe.length === 0) {
    throw new Error('Design source identifier cannot produce an empty cache key');
  }
  return safe;
}
