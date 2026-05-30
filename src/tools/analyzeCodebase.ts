import fs from 'fs';
import path from 'path';
import { AnalyzeCodebaseInputSchema } from '../schemas.js';
import { PATHS } from '../paths.js';
import { ensureDirs, ensureGitignoreEntry, normalizeAbsolutePath } from '../utils/file.js';
import {
  scanProject,
  scanToSummaryYaml,
  stackLabel,
} from '../utils/projectScan.js';
import {
  buildAnalysisSummary,
  countProjectFiles,
  readPackageInfo,
  readTsConfigSummary,
} from '../utils/projectInventory.js';
import { analyzeFunctionCount } from '../analyzer/functionCountStub.js';
import { buildImportAndCallGraphStub } from '../analyzer/importGraphStub.js';
import { recordAnalysisRun, saveAnalysisSnapshot, saveCodeEntities } from '../db/analysisStore.js';
import type { CodebaseAnalysisResult } from '../types/analysis.js';

/**
 * Spec tool `analyze_codebase` (doc 02 / 07): surface discovery via projectScan + file inventory.
 */
export async function analyzeCodebase(params: unknown): Promise<CodebaseAnalysisResult> {
  const args = AnalyzeCodebaseInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const depth = args.depth;
  const started = Date.now();

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  ensureDirs(projectPath);
  ensureGitignoreEntry(projectPath);

  const scan = scanProject(projectPath);
  const inventory = countProjectFiles(projectPath, depth);
  const functionAnalysis = await analyzeFunctionCount(projectPath, depth);
  const routeFiles = scan.routes.map((r) => r.file).filter(Boolean) as string[];
  const graphStub =
    depth === 'deep' || depth === 'exhaustive'
      ? buildImportAndCallGraphStub(projectPath, depth, routeFiles)
      : null;
  const pkg = readPackageInfo(projectPath);
  const tsconfig = readTsConfigSummary(projectPath);
  const label = stackLabel(scan.kind);
  const durationMs = Date.now() - started;

  const summary = buildAnalysisSummary(
    projectPath,
    depth,
    scan.kind,
    label,
    inventory,
    pkg,
    scan.routes.length,
    functionAnalysis?.totalFunctions,
    functionAnalysis?.parser,
    graphStub?.importGraph.edgeCount,
    graphStub?.callGraphStub.sampleChains.length,
  );

  const { runId, store } = await recordAnalysisRun(projectPath, {
    depth,
    durationMs,
    filesAnalyzed: inventory.total,
    routesFound: scan.routes.length,
    functionsFound: functionAnalysis?.totalFunctions ?? 0,
    framework: scan.kind,
    projectName: pkg?.name,
  });

  if (functionAnalysis?.entities?.length) {
    const { stored } = await saveCodeEntities(
      projectPath,
      runId,
      functionAnalysis.entities,
    );
    functionAnalysis.entitiesStored = stored;
  }

  await saveAnalysisSnapshot(projectPath, {
    analysisRunId: runId,
    framework: scan.kind,
    kind: scan.kind,
    routes: scan.routes.map((r) => ({
      path: r.path,
      file: r.file,
      description: r.description,
    })),
    savedAt: new Date().toISOString(),
    importGraph: graphStub
      ? {
          edgeCount: graphStub.importGraph.edgeCount,
          nodeCount: graphStub.importGraph.nodeCount,
          artifactPath: graphStub.importGraph.artifactPath,
        }
      : undefined,
  });

  let codeSummaryPath: string | null = null;
  if (depth === 'surface') {
    const testType = scan.kind === 'node_api' ? 'backend' : 'frontend';
    const yaml = scanToSummaryYaml(scan, testType);
    codeSummaryPath = path.resolve(projectPath, PATHS.CODE_SUMMARY);
    fs.mkdirSync(path.dirname(codeSummaryPath), { recursive: true });
    fs.writeFileSync(codeSummaryPath, yaml, 'utf-8');
  }

  return {
    projectPath,
    depth,
    durationMs,
    scan,
    inventory,
    package: pkg,
    tsconfig,
    summary,
    analysisRunId: runId,
    store,
    codeSummaryPath,
    functionAnalysis,
    importGraph: graphStub?.importGraph ?? null,
    callGraphStub: graphStub?.callGraphStub ?? null,
    next_action: [
      {
        type: 'tool_use',
        tool: 'deepsight_generate_standardized_prd',
        message: `Analysis complete (${store}). ${summary} Next: generate PRD or call deepsight_generate_code_summary for LLM-enriched summary.`,
      },
    ],
  };
}
