#!/usr/bin/env node
/**
 * Pre-commit / CI scan for accidental secrets in DeepSight repo.
 * Exits 1 if suspicious patterns found in tracked source paths.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = ['src', 'assets', 'scripts'];
const SCAN_FILES = ['package.json', 'start-web.mjs', 'README.md'];

const SKIP_EXT = new Set(['.map', '.png', '.jpg', '.svg', '.woff', '.woff2']);

const RULES = [
  { name: 'AWS key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'GitLab PAT', re: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { name: 'OpenAI key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Hardcoded bearer', re: /Bearer\s+[A-Za-z0-9_\-.]{30,}/ },
];

const ALLOWLIST = [
  /DEEPSIGHT_LLM_API_KEY/,
  /your-api-key/,
  /example\.com/,
  /localhost/,
  /password-input/,
  /password field/i,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'docs') continue;
      walk(fp, out);
    } else {
      const ext = path.extname(name);
      if (!SKIP_EXT.has(ext)) out.push(fp);
    }
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(root, d), files);
  for (const f of SCAN_FILES) {
    const fp = path.join(root, f);
    if (fs.existsSync(fp)) files.push(fp);
  }
  return files;
}

const hits = [];
for (const fp of collectFiles()) {
  const rel = path.relative(root, fp);
  const text = fs.readFileSync(fp, 'utf-8');
  for (const { name, re } of RULES) {
    const m = text.match(re);
    if (!m) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const context = text.split('\n')[line - 1]?.trim() ?? '';
    if (ALLOWLIST.some((a) => a.test(context))) continue;
    hits.push({ rel, line, rule: name, snippet: context.slice(0, 120) });
  }
}

if (hits.length) {
  console.error('security-check: FAILED — possible secrets:\n');
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.line} [${h.rule}] ${h.snippet}`);
  }
  process.exit(1);
}

console.log('security-check: ok (no secret patterns in source)');
