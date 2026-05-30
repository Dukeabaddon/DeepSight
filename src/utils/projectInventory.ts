import fs from 'fs';
import path from 'path';
import type { AnalysisDepth, FileInventory, PackageInfo, TsConfigSummary } from '../types/analysis.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'deepsight_tests',
  '.deepsight',
  '.turbo',
  'out',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function maxDepthFor(depth: AnalysisDepth): number {
  if (depth === 'surface') return 2;
  if (depth === 'deep') return 12;
  return 32;
}

function maxFilesFor(depth: AnalysisDepth): number {
  if (depth === 'surface') return 500;
  if (depth === 'deep') return 5000;
  return 15000;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

export function readPackageInfo(projectPath: string): PackageInfo | null {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      name?: string;
      version?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    return {
      name: pkg.name,
      version: pkg.version,
      scripts: Object.keys(pkg.scripts ?? {}),
      dependencyCount: Object.keys(deps).length,
    };
  } catch {
    return null;
  }
}

export function readTsConfigSummary(projectPath: string): TsConfigSummary | null {
  const candidates = ['tsconfig.json', 'jsconfig.json'];
  for (const rel of candidates) {
    const fp = path.join(projectPath, rel);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as {
        compilerOptions?: Record<string, unknown>;
      };
      const opts = raw.compilerOptions ?? {};
      const keys = Object.keys(opts);
      return {
        path: rel,
        strict: typeof opts.strict === 'boolean' ? opts.strict : null,
        compilerOptions: keys.slice(0, 12),
      };
    } catch {
      return { path: rel, strict: null, compilerOptions: [] };
    }
  }
  return null;
}

export function listSourceFiles(
  projectPath: string,
  depth: AnalysisDepth,
): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const limit = maxFilesFor(depth);
  const maxDepth = maxDepthFor(depth);

  function walk(dir: string, relPrefix: string, currentDepth: number) {
    if (truncated || files.length >= limit) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (truncated || files.length >= limit) {
        truncated = true;
        return;
      }
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        if (currentDepth >= maxDepth) continue;
        walk(path.join(dir, ent.name), rel, currentDepth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SOURCE_EXT.has(ext)) continue;
      files.push(rel);
    }
  }

  walk(projectPath, '', 0);
  return { files, truncated };
}

export function countProjectFiles(projectPath: string, depth: AnalysisDepth): FileInventory {
  const byExtension: Record<string, number> = {};
  const samplePaths: string[] = [];
  const { files, truncated } = listSourceFiles(projectPath, depth);

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase() || '(none)';
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    if (samplePaths.length < 20) samplePaths.push(rel);
  }

  if (depth === 'surface') {
    for (const rel of ['package.json', 'tsconfig.json', 'src']) {
      const fp = path.join(projectPath, rel);
      if (fs.existsSync(fp) && !samplePaths.includes(rel)) samplePaths.push(rel);
    }
  }

  return { total: files.length, byExtension, samplePaths, truncated };
}

export function buildAnalysisSummary(
  projectPath: string,
  depth: AnalysisDepth,
  kind: string,
  stackLabel: string,
  inventory: FileInventory,
  pkg: PackageInfo | null,
  routeCount: number,
  functionsFound?: number,
  parser?: string,
  importEdges?: number,
  callChainSamples?: number,
): string {
  const name = pkg?.name ?? path.basename(projectPath);
  const scripts = pkg?.scripts.length ? pkg.scripts.slice(0, 6).join(', ') : 'none';
  const lines = [
    `Project: ${name}`,
    `Kind: ${kind} (${stackLabel})`,
    `Depth: ${depth}`,
    `Source files counted: ${inventory.total}${inventory.truncated ? ' (truncated)' : ''}`,
    `Routes discovered: ${routeCount}`,
  ];
  if (functionsFound !== undefined) {
    lines.push(`Functions counted: ${functionsFound} (parser: ${parser ?? 'stub'})`);
  }
  if (importEdges !== undefined) {
    lines.push(`Import graph edges: ${importEdges} (doc 03 Layer 3 stub)`);
  }
  if (callChainSamples !== undefined && callChainSamples > 0) {
    lines.push(`Call-graph sample chains: ${callChainSamples}`);
  }
  lines.push(`npm scripts: ${scripts}`);
  return lines.join('\n');
}
