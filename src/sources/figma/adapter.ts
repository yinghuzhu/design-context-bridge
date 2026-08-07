import type { DesignTarget, Diagnostic } from '../../core/models.js';
import type {
  DesignSourceAdapter,
  PreparedSource,
  RemoteAsset,
  SourcePrepareOptions,
} from '../types.js';
import { FigmaClient } from './client.js';
import { normalizeFigmaDocument, safeFigmaRaw } from './normalize.js';
import { parseFigmaUrl, supportsFigmaUrl } from './url.js';

export interface FigmaClientContract {
  fetchNode(target: DesignTarget): Promise<unknown>;
  exportImageUrls(
    documentId: string,
    nodeIds: readonly string[],
    format: SourcePrepareOptions['format'],
    scale: number,
  ): Promise<{ urls: Record<string, string>; diagnostics: Diagnostic[] }>;
  download(url: string, destination: string): Promise<void>;
}

export class FigmaAdapter implements DesignSourceAdapter {
  readonly provider = 'figma';
  readonly #client: FigmaClientContract;

  constructor(client: FigmaClientContract | string) {
    this.#client = typeof client === 'string' ? new FigmaClient(client) : client;
  }

  supports(url: URL): boolean {
    return supportsFigmaUrl(url);
  }

  parse(url: URL): DesignTarget {
    return parseFigmaUrl(url);
  }

  async prepare(target: DesignTarget, options: SourcePrepareOptions): Promise<PreparedSource> {
    const raw = await this.#client.fetchNode(target);
    const design = normalizeFigmaDocument(raw, target);
    const assetIds = Object.values(design.nodes)
      .filter((node) => node.assetRef !== undefined && node.id !== target.nodeId)
      .map((node) => node.id);
    const requestedIds = [target.nodeId, ...assetIds];
    const exported = await this.#client.exportImageUrls(
      target.documentId,
      requestedIds,
      options.format,
      options.scale,
    );
    const screenshotUrl = exported.urls[target.nodeId];
    if (screenshotUrl === undefined) {
      throw new Error(`Figma root screenshot is unavailable for node ${target.nodeId}`);
    }
    const screenshot: RemoteAsset = {
      id: target.nodeId,
      name: design.nodes[target.nodeId]?.name ?? 'Design screenshot',
      type: design.nodes[target.nodeId]?.type ?? 'FRAME',
      url: screenshotUrl,
      rootScreenshot: true,
    };
    const assets: RemoteAsset[] = [];
    for (const id of assetIds) {
      const url = exported.urls[id];
      const node = design.nodes[id];
      if (url !== undefined && node !== undefined) {
        assets.push({ id, name: node.name, type: node.type, url, rootScreenshot: false });
      }
    }
    return {
      raw: safeFigmaRaw(raw),
      design,
      screenshot,
      assets,
      diagnostics: exported.diagnostics.filter(({ nodeId }) => nodeId !== target.nodeId),
    };
  }

  async download(asset: RemoteAsset, destination: string): Promise<void> {
    await this.#client.download(asset.url, destination);
  }
}
