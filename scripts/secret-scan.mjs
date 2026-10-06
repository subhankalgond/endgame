import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.freebuff', 'data']);

const RULES = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'hardcoded admin password', re: /ADMIN_PASSWORD\s*[:=]\s*["'][^"']+["']/i, allowIn: ['.env.example', 'server/test/helpers.ts'] },
  { name: 'JWT/SESSION secret literal', re: /(JWT|SESSION|API)_SECRET\s*[:=]\s*["'][^"']{8,}["']/i, allowIn: ['.env.example'] },
  { name: 'database url with credentials', re: /(postgres|postgresql|mysql):\/\/[^:\s]+:[^@\s]+@/i, allowIn: ['.env.example'] },
  { name: 'console debug residue', re: /\bdebugger\b/ },
  { name: 'placeholder marker', re: /\b(TODO|FIXME|XXX|HACK)\b(?!\s*eslint)/ },
  { name: 'mock/fake marker', re: /\b(mockApi|fakeData|dummyData|sampleResult|test bypass|admin bypass)\b/i },
];

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.yml', '.yaml']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(entry)) || entry === '.env' || entry === '.env.example') out.push(full);
  }
  return out;
}

// Test fixtures are allowed to set an in-memory ADMIN_PASSWORD; everything else must use the environment.
let failures = 0;
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel === 'scripts/secret-scan.mjs') continue;
  const content = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    if (rule.allowIn && rule.allowIn.some((allowed) => rel.endsWith(allowed))) continue;
    const match = content.match(rule.re);
    if (match) {
      failures += 1;
      const line = content.slice(0, match.index).split('\n').length;
      console.error(`[secret-scan] ${rel}:${line} -> ${rule.name}: ${match[0].slice(0, 60)}`);
    }
  }
}

if (failures > 0) {
  console.error(`[secret-scan] ${failures} finding(s).`);
  process.exit(1);
}
console.log('[secret-scan] clean: no secrets, debug markers or placeholders found.');
