import path from 'path';
import fs from 'fs';
import { PATHS } from '../paths.js';
import { readLifecycleState } from '../utils/lifecycleState.js';
import { phaseOrder } from '../utils/lifecycle.js';
import { normalizeAbsolutePath } from '../utils/file.js';

export async function getLifecycleStatus(params: { projectPath: string }) {
  const p = normalizeAbsolutePath(params.projectPath);
  const state = readLifecycleState(p);
  const mode = state?.mode ?? 'frontend';

  return {
    projectPath: p,
    phase: state?.phase ?? 'setup',
    mode,
    endpoint: state?.endpoint,
    phases: phaseOrder(mode),
    artifacts: {
      feature_map: fs.existsSync(path.resolve(p, PATHS.FEATURE_MAP)),
      explore_manifest: fs.existsSync(path.resolve(p, PATHS.EXPLORE_MANIFEST)),
      test_results: fs.existsSync(path.resolve(p, PATHS.TEST_RESULTS)),
      repair_prompt: fs.existsSync(path.resolve(p, PATHS.REPAIR_PROMPT)),
      test_report: fs.existsSync(path.resolve(p, PATHS.TEST_REPORT)),
      enrich_prompt: fs.existsSync(path.resolve(p, PATHS.ENRICH_PROMPT)),
    },
    updatedAt: state?.updatedAt,
  };
}
