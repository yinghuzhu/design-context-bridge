import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: true,
    target: 'node20',
  },
  {
    entry: { 'install-skill': 'scripts/install-skill.ts' },
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    dts: true,
    sourcemap: true,
    target: 'node20',
  },
]);
