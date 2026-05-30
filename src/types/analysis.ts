import type { CodeEntityDraft } from './codeEntity.js';
import type { CallGraphStub, ImportGraphResult } from './importGraph.js';
import type { ProjectKind, ProjectScan } from '../utils/projectScan.js';

export type { CallGraphStub, ImportGraphResult } from './importGraph.js';

export type AnalysisDepth = 'surface' | 'deep' | 'exhaustive';

export type FunctionCountParser = 'tree-sitter' | 'regex-stub';

export type FunctionCountResult = {
  totalFunctions: number;
  filesParsed: number;
  parser: FunctionCountParser;
  truncated: boolean;
  treeSitterAvailable: boolean;
  entities: CodeEntityDraft[];
  entitiesStored?: number;
};

export type FileInventory = {
  total: number;
  byExtension: Record<string, number>;
  samplePaths: string[];
  truncated: boolean;
};

export type PackageInfo = {
  name?: string;
  version?: string;
  scripts: string[];
  dependencyCount: number;
};

export type TsConfigSummary = {
  path: string;
  strict: boolean | null;
  compilerOptions: string[];
};

export type CodebaseAnalysisResult = {
  projectPath: string;
  depth: AnalysisDepth;
  durationMs: number;
  scan: ProjectScan;
  inventory: FileInventory;
  package: PackageInfo | null;
  tsconfig: TsConfigSummary | null;
  summary: string;
  analysisRunId: string;
  store: 'sqlite' | 'json-stub';
  codeSummaryPath: string | null;
  functionAnalysis: FunctionCountResult | null;
  importGraph: ImportGraphResult | null;
  callGraphStub: CallGraphStub | null;
  next_action: Array<{ type: string; tool?: string; message: string }>;
};
