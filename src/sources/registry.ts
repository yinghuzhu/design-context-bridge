import type { DesignTarget } from '../core/models.js';
import type { DesignSourceAdapter } from './types.js';

export interface ResolvedSource {
  adapter: DesignSourceAdapter;
  target: DesignTarget;
}

export class SourceRegistry {
  readonly #adapters: Map<string, DesignSourceAdapter>;

  constructor(adapters: readonly DesignSourceAdapter[]) {
    this.#adapters = new Map();
    for (const adapter of adapters) {
      if (this.#adapters.has(adapter.provider)) {
        throw new Error(`Duplicate provider registration: ${adapter.provider}`);
      }
      this.#adapters.set(adapter.provider, adapter);
    }
  }

  resolve(input: string, explicitProvider?: string): ResolvedSource {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error('Design source must be a valid absolute URL');
    }

    if (explicitProvider !== undefined) {
      const adapter = this.#adapters.get(explicitProvider);
      if (adapter === undefined) {
        throw new Error(`Unknown design source provider: ${explicitProvider}`);
      }
      if (!adapter.supports(url)) {
        throw new Error(
          `Provider ${explicitProvider} does not support the supplied URL`,
        );
      }
      return { adapter, target: adapter.parse(url) };
    }

    const matches = [...this.#adapters.values()].filter((adapter) =>
      adapter.supports(url),
    );
    if (matches.length === 0) {
      throw new Error('No registered design source supports the supplied URL');
    }
    if (matches.length > 1) {
      throw new Error('Multiple design sources support the URL; specify --provider');
    }

    const adapter = matches[0];
    if (adapter === undefined) {
      throw new Error('Design source registry resolution failed');
    }
    return { adapter, target: adapter.parse(url) };
  }
}
