import fs from 'fs';
import path from 'path';
import type {
  AnalysisDepth,
  FunctionCountParser,
  FunctionCountResult,
} from '../types/analysis.js';
import type { CodeEntityDraft } from '../types/codeEntity.js';
import { listSourceFiles } from '../utils/projectInventory.js';

export type { FunctionCountParser, FunctionCountResult } from '../types/analysis.js';

const PARSEABLE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MAX_ENTITIES = 2500;

const TS_FUNCTION_TYPES = [
  'function_declaration',
  'method_definition',
  'arrow_function',
  'generator_function_declaration',
];

type TsNode = {
  type: string;
  startPosition: { row: number };
  endPosition: { row: number };
  childForFieldName?(name: string): TsNode | null;
  children: TsNode[];
  text: string;
  descendantsOfType(type: string): TsNode[];
};

type TreeSitterParser = {
  setLanguage(language: unknown): void;
  parse(source: string): { rootNode: TsNode };
};

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<unknown>;

let ParserCtor: (new () => TreeSitterParser) | null = null;
const languageCache = new Map<string, unknown>();
let treeSitterLoadFailed = false;

function langKeyForExt(ext: string): string {
  if (ext === '.tsx') return 'tsx';
  if (ext === '.ts') return 'ts';
  return 'js';
}

async function ensureParser(): Promise<boolean> {
  if (ParserCtor) return true;
  if (treeSitterLoadFailed) return false;
  try {
    const mod = (await dynamicImport('tree-sitter')) as { default: new () => TreeSitterParser };
    ParserCtor = mod.default;
    return true;
  } catch {
    treeSitterLoadFailed = true;
    return false;
  }
}

async function languageForExt(ext: string): Promise<unknown | null> {
  const key = langKeyForExt(ext);
  if (languageCache.has(key)) return languageCache.get(key)!;
  if (!(await ensureParser())) return null;

  try {
    const isTs = key === 'ts' || key === 'tsx';
    const langPkg = await dynamicImport(isTs ? 'tree-sitter-typescript' : 'tree-sitter-javascript');
    const lang =
      key === 'tsx'
        ? (langPkg as { tsx: unknown }).tsx
        : key === 'ts'
          ? (langPkg as { typescript: unknown }).typescript
          : (langPkg as { default?: unknown; javascript?: unknown }).default ??
            (langPkg as { javascript: unknown }).javascript;
    languageCache.set(key, lang);
    return lang;
  } catch {
    return null;
  }
}

function nodeName(node: TsNode): string | null {
  const nameNode =
    node.childForFieldName?.('name') ??
    node.children.find((c) => c.type === 'identifier' || c.type === 'property_identifier');
  if (nameNode?.text) return nameNode.text;
  if (node.type === 'method_definition') {
    const key = node.childForFieldName?.('name');
    return key?.text ?? null;
  }
  return null;
}

function extractEntitiesTreeSitter(source: string, fileRel: string, lang: unknown): CodeEntityDraft[] {
  if (!ParserCtor) return [];
  const parser = new ParserCtor();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const entities: CodeEntityDraft[] = [];

  for (const type of TS_FUNCTION_TYPES) {
    for (const node of tree.rootNode.descendantsOfType(type)) {
      const name = nodeName(node);
      entities.push({
        type: 'function',
        file_path: fileRel.replace(/\\/g, '/'),
        name,
        line_start: node.startPosition.row + 1,
        line_end: node.endPosition.row + 1,
        signature: JSON.stringify({ nodeType: type, name }),
        metadata: JSON.stringify({ parser: 'tree-sitter' }),
      });
    }
  }
  return entities;
}

/** Regex fallback — approximate line numbers via indexOf. */
export function extractEntitiesRegex(source: string, fileRel: string): CodeEntityDraft[] {
  const entities: CodeEntityDraft[] = [];
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bfunction\s+([a-zA-Z_$][\w$]*)\s*\(/g, label: 'function_declaration' },
    { re: /\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/g, label: 'method_definition' },
  ];

  for (const { re, label } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const line = source.slice(0, m.index).split('\n').length;
      entities.push({
        type: 'function',
        file_path: fileRel.replace(/\\/g, '/'),
        name: m[1] ?? null,
        line_start: line,
        line_end: line,
        signature: JSON.stringify({ nodeType: label, name: m[1] ?? null }),
        metadata: JSON.stringify({ parser: 'regex-stub' }),
      });
    }
  }
  return entities;
}

export function countFunctionsRegex(source: string): number {
  return extractEntitiesRegex(source, 'inline.ts').length;
}

async function analyzeFile(
  fileAbs: string,
  fileRel: string,
  ext: string,
): Promise<{ entities: CodeEntityDraft[]; parser: FunctionCountParser }> {
  let source: string;
  try {
    source = fs.readFileSync(fileAbs, 'utf-8');
  } catch {
    return { entities: [], parser: 'regex-stub' };
  }

  const lang = await languageForExt(ext);
  if (lang && ParserCtor) {
    try {
      const entities = extractEntitiesTreeSitter(source, fileRel, lang);
      if (entities.length > 0) {
        return { entities, parser: 'tree-sitter' };
      }
    } catch {
      /* fall through */
    }
  }

  return { entities: extractEntitiesRegex(source, fileRel), parser: 'regex-stub' };
}

/**
 * Deep analysis: function entities + counts (doc 03 / 07 / 16 code_entities).
 */
export async function analyzeFunctionCount(
  projectPath: string,
  depth: AnalysisDepth,
): Promise<FunctionCountResult | null> {
  if (depth !== 'deep') return null;

  const { files, truncated } = listSourceFiles(projectPath, depth);
  const parseable = files.filter((rel) => PARSEABLE_EXT.has(path.extname(rel).toLowerCase()));

  await ensureParser();

  let aggregateParser: FunctionCountParser = 'regex-stub';
  const allEntities: CodeEntityDraft[] = [];

  for (const rel of parseable) {
    if (allEntities.length >= MAX_ENTITIES) break;
    const ext = path.extname(rel).toLowerCase();
    const { entities, parser } = await analyzeFile(path.join(projectPath, rel), rel, ext);
    allEntities.push(...entities);
    if (parser === 'tree-sitter') aggregateParser = 'tree-sitter';
  }

  const capped = allEntities.slice(0, MAX_ENTITIES);

  return {
    totalFunctions: capped.length,
    filesParsed: parseable.length,
    parser: aggregateParser,
    truncated: truncated || allEntities.length > MAX_ENTITIES,
    treeSitterAvailable: ParserCtor !== null && languageCache.size > 0,
    entities: capped,
  };
}
