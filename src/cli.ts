const HELP = `design-context

Prepare deterministic design-platform context packages for multimodal agents.

Usage:
  design-context --help
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  process.stderr.write('No commands are available in the foundation build.\n');
  return 30;
}

if (isMainModule()) {
  process.exitCode = main();
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
