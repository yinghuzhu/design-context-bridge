import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(process.argv[2] ?? '');
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const patterns = [
  /\bfigd_[A-Za-z0-9_-]{20,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
  /\bsk-[A-Za-z0-9]{20,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/giu,
  /\b(?:api[_-]?key|client[_-]?secret|private[_-]?key|password|access[_-]?token|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/giu,
  /https?:\/\/[^\s"'`]+[?&](?:access_?token|authorization|secret|signature|x-amz-credential|x-amz-signature)=[^\s&#"'`]+/giu,
  new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH )?${'PRIVATE'} KEY-----`, 'gu'),
];

const suspicious = new Set();
for (const path of tracked) {
  let buffer;
  try {
    buffer = readFileSync(resolve(repositoryRoot, path));
  } catch {
    continue;
  }
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!allowedFixture(match[0])) suspicious.add(path);
    }
  }
}

if (suspicious.size > 0) {
  process.stderr.write('Potential credentials found in tracked files:\n');
  for (const path of [...suspicious].sort()) process.stderr.write(`  ${path}\n`);
  process.stderr.write('Review and remove or replace the values before committing. Matched values are intentionally hidden.\n');
  process.exitCode = 1;
}

function allowedFixture(value) {
  const normalized = value.toLowerCase();
  if (/^figd_x+$/u.test(normalized)) return true;
  if (normalized.includes('.invalid/')) return true;
  return ['<your-token>', 'example-value', 'placeholder-value', 'test-token'].some((placeholder) => normalized.includes(placeholder));
}
