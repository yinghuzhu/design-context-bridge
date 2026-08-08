import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FigmaClient, FigmaHttpError } from '../src/sources/figma/client.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(
    body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body),
    { status, headers },
  );
}

describe('FigmaClient', () => {
  it('requires a token', () => {
    expect(() => new FigmaClient('')).toThrow(/token required/i);
  });

  it('batches 41 export IDs as 40 plus 1 and normalizes IDs', async () => {
    const calls: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      const ids = url.searchParams.get('ids')?.split(',') ?? [];
      return response({ images: Object.fromEntries(ids.map((id) => [id, `https://assets.invalid/${id}`])) });
    });
    const client = new FigmaClient('secret-token', fetchImpl);

    const result = await client.exportImageUrls(
      'file-key',
      Array.from({ length: 41 }, (_, index) => `${index}:1`),
      'png',
      2,
    );

    expect(calls.map((url) => url.searchParams.get('ids')?.split(',').length)).toEqual([40, 1]);
    expect(result.urls['0:1']).toBe('https://assets.invalid/0-1');
    expect(result.diagnostics).toEqual([]);
    expect(String(calls[0])).not.toContain('secret-token');
  });

  it.each([400, 404, 422])('falls back to individual exports after HTTP %s', async (status) => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return response({}, status);
      if (call === 2) return response({ images: { '1-2': 'https://assets.invalid/ok' } });
      return response({}, status);
    });
    const client = new FigmaClient('token', fetchImpl);

    const result = await client.exportImageUrls('file', ['1:2', '2:3'], 'svg', 1);

    expect(result.urls).toEqual({ '1:2': 'https://assets.invalid/ok' });
    expect(result.diagnostics).toEqual([{
      code: 'asset_export_failed',
      message: 'Figma did not export an image for node 2:3',
      retryable: true,
      nodeId: '2:3',
    }]);
  });

  it.each([401, 403, 503])('propagates HTTP %s without exposing credentials', async (status) => {
    const fetchImpl = vi.fn(async () => response({ message: 'signed=https://secret.invalid/?token=bad' }, status));
    const client = new FigmaClient('top-secret', fetchImpl, { sleep: async () => undefined });

    const operation = status === 503
      ? client.fetchNode({ provider: 'figma', documentId: 'file', nodeId: '1:2', sourceUrl: 'https://figma.com/design/file/x?node-id=1-2', cacheKey: 'x' })
      : client.exportImageUrls('file', ['1:2'], 'png', 2);

    await expect(operation).rejects.toBeInstanceOf(FigmaHttpError);
    await expect(operation).rejects.not.toThrow(/top-secret|secret\.invalid|token=bad/);
    expect(fetchImpl).toHaveBeenCalledTimes(status === 503 ? 4 : 1);
  });

  it('honors bounded Retry-After and retries network errors', async () => {
    const delays: number[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('network URL https://signed.invalid/?token=secret');
      if (call === 2) return response({}, 429, { 'Retry-After': '99' });
      return response({ nodes: {} });
    });
    const client = new FigmaClient('token', fetchImpl, {
      sleep: async (delay) => { delays.push(delay); },
      maximumRetryDelayMs: 2_000,
    });

    await client.fetchNode({ provider: 'figma', documentId: 'file', nodeId: '1:2', sourceUrl: 'https://figma.com/design/file/x?node-id=1-2', cacheKey: 'x' });

    expect(delays).toEqual([500, 2_000]);
  });

  it('downloads without the Figma header', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return response(new Uint8Array([1, 2, 3]));
    });
    const client = new FigmaClient('secret-token', fetchImpl);
    const root = await mkdtemp(join(tmpdir(), 'design-context-client-'));
    const destination = join(root, 'nested', 'asset.png');
    try {
      await client.download('https://assets.invalid/signed?token=private', destination);

      expect(await readFile(destination)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retries transient CDN download failures', async () => {
    const delays: number[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('temporary network failure');
      if (call === 2) return response({}, 503);
      return response(new Uint8Array([4, 5, 6]));
    });
    const client = new FigmaClient('secret-token', fetchImpl, {
      sleep: async (delay) => { delays.push(delay); },
    });
    const root = await mkdtemp(join(tmpdir(), 'design-context-client-'));
    const destination = join(root, 'asset.png');
    try {
      await client.download('https://assets.invalid/signed?token=private', destination);

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(delays).toEqual([500, 1_000]);
      expect(await readFile(destination)).toEqual(Buffer.from([4, 5, 6]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
