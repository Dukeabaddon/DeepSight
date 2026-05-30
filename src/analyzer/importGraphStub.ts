import fs from 'fs';
import path from 'path';
import type { AnalysisDepth } from '../types/analysis.js';
import type {
  CallGraphStub,
  ImportGraphEdge,
  ImportGraphResult,
} from '../types/importGraph.js';
import { listSourceFiles } from '../utils/projectInventory.js';

const MAX_EDGES_STORED = 3000;
const MAX_SAMPLE_EDGES = 40;
const MAX_CHAINS = 5;
const CHAIN_DEPTH = 5;

const IMPORT_FROM =
  /import\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_FROM = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /import\s+['"]([^'"]+)['"]\s*;/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractSpecs(source: string): Array<{ spec: string; kind: ImportGraphEdge['kind'] }> {
  const found: Array<{ spec: string; kind: ImportGraphEdge['kind'] }> = [];
  const run = (re: RegExp, kind: ImportGraphEdge['kind']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      found.push({ spec: m[1]!, kind });
    }
  };
  run(IMPORT_FROM, 'import');
  run(EXPORT_FROM, 'export-from');
  run(SIDE_EFFECT_IMPORT, 'import');
  run(REQUIRE_RE, 'require');
  return found;
}

function resolveSpec(
  projectPath: string,
  fromRel: string,
  spec: string,
  fileSet: Set<string>,
): string {
  if (!spec.startsWith('.')) {
    const pkg = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0]!;
    return `external:${pkg}`;
  }

  const fromDir = path.dirname(path.join(projectPath, fromRel));
  const base = path.normalize(path.join(fromDir, spec));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];

  for (const c of candidates) {
    const rel = path.relative(projectPath, c).replace(/\\/g, '/');
    if (fileSet.has(rel)) return rel;
  }

  const unresolved = path.relative(projectPath, base).replace(/\\/g, '/');
  return `unresolved:${unresolved}`;
}

function buildAdjacency(edges: ImportGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.to.startsWith('external:') || e.to.startsWith('unresolved:')) continue;
    const list = adj.get(e.from) ?? [];
    if (!list.includes(e.to)) list.push(e.to);
    adj.set(e.from, list);
  }
  return adj;
}

function sampleChains(
  entryPoints: string[],
  adj: Map<string, string[]>,
): string[][] {
  const chains: string[][] = [];
  for (const entry of entryPoints) {
    if (chains.length >= MAX_CHAINS) break;
    const chain = [entry];
    const seen = new Set<string>([entry]);
    let cur = entry;
    for (let d = 0; d < CHAIN_DEPTH; d++) {
      const neighbors = adj.get(cur) ?? [];
      const next = neighbors.find((n) => !seen.has(n));
      if (!next) break;
      chain.push(next);
      seen.add(next);
      cur = next;
    }
    if (chain.length > 1) chains.push(chain);
  }
  return chains;
}

function pickEntryPoints(
  projectPath: string,
  files: string[],
  routeFiles: string[],
): string[] {
  const fileSet = new Set(files);
  const entries = new Set<string>();

  for (const rf of routeFiles) {
    const norm = rf.replace(/\\/g, '/');
    if (fileSet.has(norm)) entries.add(norm);
  }

  const heuristics = [
    'app/page.tsx',
    'app/layout.tsx',
    'src/app/page.tsx',
    'src/main.tsx',
    'src/index.tsx',
    'pages/index.tsx',
  ];
  for (const h of heuristics) {
    if (fileSet.has(h)) entries.add(h);
  }

  if (entries.size === 0 && files.length > 0) {
    entries.add(files[0]!);
  }

  return [...entries].slice(0, 20);
}

export function buildImportAndCallGraphStub(
  projectPath: string,
  depth: AnalysisDepth,
  routeFiles: string[],
): { importGraph: ImportGraphResult; callGraphStub: CallGraphStub } {
  const { files, truncated: filesTruncated } = listSourceFiles(projectPath, depth);
  const fileSet = new Set(files);
  const edges: ImportGraphEdge[] = [];
  const nodeSet = new Set<string>();
  let edgesTruncated = false;

  for (const rel of files) {
    if (edges.length >= MAX_EDGES_STORED) {
      edgesTruncated = true;
      break;
    }
    const fp = path.join(projectPath, rel);
    let source: string;
    try {
      source = fs.readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }
    nodeSet.add(rel);
    for (const { spec, kind } of extractSpecs(source)) {
      if (edges.length >= MAX_EDGES_STORED) {
        edgesTruncated = true;
        break;
      }
      const to = resolveSpec(projectPath, rel, spec, fileSet);
      nodeSet.add(to);
      edges.push({ from: rel, to, kind });
    }
  }

  const entryPoints = pickEntryPoints(projectPath, files, routeFiles);
  const adj = buildAdjacency(edges);
  const chains = sampleChains(entryPoints, adj);

  const externalCount = [...nodeSet].filter((n) => n.startsWith('external:')).length;
  const artifactRel = '.deepsight/import-graph.json';
  const artifactPath = path.join(projectPath, artifactRel);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        parser: 'regex-stub',
        depth,
        truncated: filesTruncated || edgesTruncated,
        nodeCount: nodeSet.size,
        edgeCount: edges.length,
        entryPoints,
        nodes: [...nodeSet].sort(),
        edges,
        callGraphSampleChains: chains,
      },
      null,
      2,
    ),
    'utf-8',
  );

  const importGraph: ImportGraphResult = {
    parser: 'regex-stub',
    nodeCount: nodeSet.size,
    edgeCount: edges.length,
    externalCount,
    truncated: filesTruncated || edgesTruncated,
    entryPoints,
    sampleEdges: edges.slice(0, MAX_SAMPLE_EDGES),
    artifactPath: artifactRel.replace(/\\/g, '/'),
  };

  const callGraphStub: CallGraphStub = {
    parser: 'import-tree-stub',
    nodeCount: nodeSet.size,
    edgeCount: edges.length,
    sampleChains: chains,
    note: 'Phase 2 stub: chains follow static import edges from route/entry files, not runtime calls.',
  };

  return { importGraph, callGraphStub };
}
