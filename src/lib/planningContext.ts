import path from 'path';
import type { CodeEntityDraft } from '../types/codeEntity.js';
import {
  getCodeEntitiesForLatestRun,
  getLatestAnalysisRun,
  loadAnalysisSnapshot,
} from '../db/analysisStore.js';
import { scanProject, type ScannedRoute, type ProjectKind } from '../utils/projectScan.js';
import { readPackageInfo } from '../utils/projectInventory.js';

export type PlanningContext = {
  projectPath: string;
  analysisRunId: string;
  framework: string;
  kind: ProjectKind;
  routes: ScannedRoute[];
  entities: CodeEntityDraft[];
  projectName: string;
};

export type PlanningContextError = {
  error: 'NO_ANALYSIS';
  message: string;
  next_action: Array<{ type: string; tool: string; message: string }>;
};

export async function loadPlanningContext(
  projectPath: string,
): Promise<PlanningContext | PlanningContextError> {
  const resolved = path.resolve(projectPath);
  const run = await getLatestAnalysisRun(resolved);
  if (!run) {
    return {
      error: 'NO_ANALYSIS',
      message: 'No analysis run found. Call analyze_codebase with depth deep first.',
      next_action: [
        {
          type: 'tool_use',
          tool: 'analyze_codebase',
          message: 'Run analyze_codebase({ projectPath, depth: "deep" }) before parse_prd.',
        },
      ],
    };
  }

  const entities = await getCodeEntitiesForLatestRun(resolved);
  if (entities.length === 0) {
    return {
      error: 'NO_ANALYSIS',
      message: 'No code_entities for latest run. Re-run analyze_codebase with depth deep.',
      next_action: [
        {
          type: 'tool_use',
          tool: 'analyze_codebase',
          message: 'Run analyze_codebase({ projectPath, depth: "deep" }).',
        },
      ],
    };
  }

  const snapshot = await loadAnalysisSnapshot(resolved, run.id);
  const scan = scanProject(resolved);
  const routes: ScannedRoute[] = snapshot?.routes?.length
    ? snapshot.routes.map((r) => ({ ...r, auth_required: false }))
    : scan.routes;
  const pkg = readPackageInfo(resolved);
  const kind = (snapshot?.kind ?? scan.kind) as ProjectKind;

  return {
    projectPath: resolved,
    analysisRunId: run.id,
    framework: snapshot?.framework ?? scan.kind,
    kind,
    routes,
    entities,
    projectName: pkg?.name ?? path.basename(resolved),
  };
}
