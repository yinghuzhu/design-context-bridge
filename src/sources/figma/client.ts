import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DesignTarget, Diagnostic } from '../../core/models.js';
import type { ExportFormat } from '../types.js';

const FIGMA_API = 'https://api.figma.com';
const RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAXIMUM_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FigmaClientOptions {
  sleep?: (delayMs: number) => Promise<void>;
  maximumRetryDelayMs?: number;
  requestTimeoutMs?: number;
  maximumDownloadBytes?: number;
  now?: () => number;
}

export class FigmaHttpError extends Error {
  readonly status: number;
  readonly kind: 'auth' | 'source';

  constructor(status: number) {
    super(`Figma API request failed with HTTP ${status}`);
    this.name = 'FigmaHttpError';
    this.status = status;
    this.kind = status === 401 || status === 403 ? 'auth' : 'source';
  }
}

export class FigmaNetworkError extends Error {
  readonly kind = 'source' as const;

  constructor() {
    super('Figma API network request failed');
    this.name = 'FigmaNetworkError';
  }
}

export class FigmaDownloadSizeError extends Error {
  readonly kind = 'source' as const;

  constructor() {
    super('Figma asset exceeds the configured download size limit');
    this.name = 'FigmaDownloadSizeError';
  }
}

export interface ExportImagesResult {
  urls: Record<string, string>;
  diagnostics: Diagnostic[];
}

export class FigmaClient {
  readonly #token: string;
  readonly #fetch: FetchImplementation;
  readonly #sleep: (delayMs: number) => Promise<void>;
  readonly #maximumRetryDelayMs: number;
  readonly #requestTimeoutMs: number;
  readonly #maximumDownloadBytes: number;
  readonly #now: () => number;

  constructor(
    token: string,
    fetchImpl: FetchImplementation = globalThis.fetch,
    options: FigmaClientOptions = {},
  ) {
    if (token.length === 0) {
      throw new Error('Figma token required');
    }
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const maximumDownloadBytes = options.maximumDownloadBytes ?? DEFAULT_MAXIMUM_DOWNLOAD_BYTES;
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error('requestTimeoutMs must be positive');
    if (!Number.isSafeInteger(maximumDownloadBytes) || maximumDownloadBytes <= 0) throw new Error('maximumDownloadBytes must be a positive integer');
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    this.#maximumRetryDelayMs = options.maximumRetryDelayMs ?? 10_000;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#maximumDownloadBytes = maximumDownloadBytes;
    this.#now = options.now ?? Date.now;
  }

  async fetchNode(target: DesignTarget): Promise<unknown> {
    const url = new URL(`/v1/files/${encodeURIComponent(target.documentId)}/nodes`, FIGMA_API);
    url.searchParams.set('ids', target.nodeId);
    const response = await this.#requestApi(url);
    return response.json() as Promise<unknown>;
  }

  async exportImageUrls(
    documentId: string,
    nodeIds: readonly string[],
    format: ExportFormat,
    scale: number,
  ): Promise<ExportImagesResult> {
    const normalized = nodeIds.map(colonId);
    const urls: Record<string, string> = {};
    const diagnostics: Diagnostic[] = [];
    for (let start = 0; start < normalized.length; start += 40) {
      const batch = normalized.slice(start, start + 40);
      try {
        const images = await this.#exportBatch(documentId, batch, format, scale);
        collectImages(batch, images, urls, diagnostics);
      } catch (error) {
        if (!(error instanceof FigmaHttpError) || ![400, 404, 422].includes(error.status)) {
          throw error;
        }
        for (const nodeId of batch) {
          try {
            const images = await this.#exportBatch(documentId, [nodeId], format, scale);
            collectImages([nodeId], images, urls, diagnostics);
          } catch (individualError) {
            if (
              individualError instanceof FigmaHttpError &&
              [400, 404, 422].includes(individualError.status)
            ) {
              diagnostics.push(exportDiagnostic(nodeId));
              continue;
            }
            throw individualError;
          }
        }
      }
    }
    return { urls, diagnostics };
  }

  async download(url: string, destination: string): Promise<void> {
    let response: Response | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        response = await this.#fetchWithTimeout(url);
      } catch {
        if (attempt === RETRY_DELAYS_MS.length) throw new FigmaNetworkError();
        await this.#sleep(RETRY_DELAYS_MS[attempt] ?? 0);
        continue;
      }
      if (response.ok) break;
      if (!retryableStatus(response.status) || attempt === RETRY_DELAYS_MS.length) {
        throw new FigmaHttpError(response.status);
      }
      const fallback = RETRY_DELAYS_MS[attempt] ?? 0;
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), this.#now());
      await this.#sleep(Math.min(retryAfter ?? fallback, this.#maximumRetryDelayMs));
    }
    if (response === undefined || !response.ok) throw new FigmaNetworkError();
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.#maximumDownloadBytes) {
      throw new FigmaDownloadSizeError();
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.#maximumDownloadBytes) throw new FigmaDownloadSizeError();
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }

  async #exportBatch(
    documentId: string,
    nodeIds: readonly string[],
    format: ExportFormat,
    scale: number,
  ): Promise<Record<string, string>> {
    const url = new URL(`/v1/images/${encodeURIComponent(documentId)}`, FIGMA_API);
    url.searchParams.set('ids', nodeIds.map(dashId).join(','));
    url.searchParams.set('format', format);
    url.searchParams.set('scale', String(scale));
    const response = await this.#requestApi(url);
    const payload = await response.json() as unknown;
    if (!isRecord(payload) || !isRecord(payload.images)) return {};
    const result: Record<string, string> = {};
    for (const [id, value] of Object.entries(payload.images)) {
      if (typeof value === 'string' && value.length > 0) result[colonId(id)] = value;
    }
    return result;
  }

  async #requestApi(url: URL): Promise<Response> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetchWithTimeout(url, { headers: { 'X-Figma-Token': this.#token } });
      } catch {
        if (attempt === RETRY_DELAYS_MS.length) throw new FigmaNetworkError();
        await this.#sleep(RETRY_DELAYS_MS[attempt] ?? 0);
        continue;
      }
      if (response.ok) return response;
      if (!retryableStatus(response.status) || attempt === RETRY_DELAYS_MS.length) {
        throw new FigmaHttpError(response.status);
      }
      const fallback = RETRY_DELAYS_MS[attempt] ?? 0;
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), this.#now());
      await this.#sleep(Math.min(retryAfter ?? fallback, this.#maximumRetryDelayMs));
    }
    throw new FigmaNetworkError();
  }

  async #fetchWithTimeout(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      return await this.#fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function collectImages(
  ids: readonly string[],
  images: Record<string, string>,
  urls: Record<string, string>,
  diagnostics: Diagnostic[],
): void {
  for (const id of ids) {
    const url = images[id];
    if (url === undefined) diagnostics.push(exportDiagnostic(id));
    else urls[id] = url;
  }
}

function exportDiagnostic(nodeId: string): Diagnostic {
  return {
    code: 'asset_export_failed',
    message: `Figma did not export an image for node ${nodeId}`,
    retryable: true,
    nodeId,
  };
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

function colonId(value: string): string {
  return value.replaceAll('-', ':');
}

function dashId(value: string): string {
  return colonId(value).replaceAll(':', '-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
