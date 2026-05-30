import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Project directory where DeepSight stores its files
export const DEEPSIGHT_DIR = 'deepsight_tests';
export const TMP_DIR = path.join(DEEPSIGHT_DIR, 'tmp');
export const GENERATED_DIR = path.join(DEEPSIGHT_DIR, 'generated_specs');
export const DOT_DIR = '.deepsight';

// Relative paths (within project)
export const PATHS = {
  DEEPSIGHT_DIR,
  GENERATED_DIR,
  FEATURE_MAP: path.join(GENERATED_DIR, 'feature_map.json'),
  CODE_SUMMARY_OUT: path.join(GENERATED_DIR, 'code_summary.json'),
  NORMALIZED_PRD: path.join(GENERATED_DIR, 'normalized_prd.json'),
  STANDARD_PRD: path.join(DEEPSIGHT_DIR, 'standard_prd.json'),
  FRONTEND_TEST_PLAN: path.join(DEEPSIGHT_DIR, 'deepsight_frontend_test_plan.json'),
  BACKEND_TEST_PLAN: path.join(DEEPSIGHT_DIR, 'deepsight_backend_test_plan.json'),
  TEST_REPORT: path.join(DEEPSIGHT_DIR, 'deepsight-test-report.md'),
  TEST_REPORT_HTML: path.join(DEEPSIGHT_DIR, 'deepsight-test-report.html'),
  TEST_CODE_DIR: DEEPSIGHT_DIR,
  TMP_DIR,
  RAW_PRD_DIR: path.join(TMP_DIR, 'prd_files'),
  CONFIG: path.join(TMP_DIR, 'config.json'),
  CODE_SUMMARY: path.join(TMP_DIR, 'code_summary.yaml'),
  TEST_RESULTS: path.join(TMP_DIR, 'test_results.json'),
  REPAIR_PROMPT: path.join(TMP_DIR, 'repair_prompt.json'),
  LIFECYCLE_STATE: path.join(TMP_DIR, 'lifecycle_state.json'),
  EXPLORE_MANIFEST: path.join(GENERATED_DIR, 'explore_manifest.json'),
  RAW_REPORT: path.join(TMP_DIR, 'raw_report.md'),
  TASKS_PROMPT: path.join(TMP_DIR, 'tasks_prompt.json'),
  ENRICH_PROMPT: path.join(DEEPSIGHT_DIR, 'IDE_ENRICH_PROMPT.md'),
  ENRICHED_MARKER: path.join(DEEPSIGHT_DIR, '.enriched'),
  SCAFFOLD_PHASE: path.join(TMP_DIR, 'scaffold-phase.json'),
};

// Absolute paths (within DeepSight package)
export const ABS_PATHS = {
  CURRENT_DIR: PROJECT_ROOT,
  MD_TEST_REPORT_TEMPLATE: path.resolve(PROJECT_ROOT, 'assets', 'report-template.md'),
  HTML_TEST_REPORT_TEMPLATE: path.resolve(PROJECT_ROOT, 'assets', 'report-template.html'),
  MODIFICATION_DIR: path.resolve(PROJECT_ROOT, 'assets', 'modification'),
  LOGO_PATH: path.resolve(PROJECT_ROOT, 'assets', 'img', 'logo.svg'),
};

export const VERSION = '0.1.0';