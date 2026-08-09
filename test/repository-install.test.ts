import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('repository distribution', () => {
  it('is private and has no npm publication lifecycle', async () => {
    const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      private?: boolean;
      scripts?: Record<string, string>;
    };

    expect(packageJson.private).toBe(true);
    expect(packageJson.scripts?.prepack).toBeUndefined();
  });
});
