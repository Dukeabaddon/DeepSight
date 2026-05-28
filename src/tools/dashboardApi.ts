import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import { normalizeAbsolutePath, readConfig, saveConfig, ensureDirs, ensureGitignoreEntry } from '../utils/file.js';
import {
  writeCodeSummary,
  writePrd,
  writeTestPlan,
  prepareEnrichment,
  runPlaywrightTests,
  writeReportFromRun,
  isEnrichmentComplete,
  writeRouteSmokeSpecs,
} from '../utils/scaffoldPipeline.js';
import { buildIdeEnrichPrompt, removeScaffoldStubSpecs } from '../utils/enrichPrompt.js';
import { scanProject, stackLabel, detectProjectKind } from '../utils/projectScan.js';

export async function apiBootstrap(body: {
  projectPath: string;
  type: string;
  localPort: number;
  scope: string;
}) {
  const p = normalizeAbsolutePath(body.projectPath);
  ensureDirs(p);
  let config: any = { status: 'init' };
  try {
    config = await readConfig(p);
  } catch {}
  config.status = 'init';
  config.scope = body.scope || 'codebase';
  const rawType = body.type || 'frontend';
  config.type = rawType === 'both' ? 'both' : rawType;
  config.localEndpoint = `http://localhost:${body.localPort || 5173}/`;
  await saveConfig(p, config);
  ensureGitignoreEntry(p);
  return { status: 'ok', detail: `Structure ready at ${p}/${PATHS.DEEPSIGHT_DIR}` };
}

export async function apiCodeSummary(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  const config = await readConfig(p);
  const testType = config.type === 'backend' ? 'backend' : 'frontend';
  const { scan, detail } = writeCodeSummary(p, testType);
  return { status: 'ok', detail, scan };
}

export async function apiPrd(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  const config = await readConfig(p);
  const testType = config.type === 'backend' ? 'backend' : 'frontend';
  const scan = scanProject(p);
  const detail = writePrd(p, scan, testType);
  return { status: 'ok', detail };
}

export async function apiTestPlan(body: {
  projectPath: string;
  planType?: string;
  localPort?: number;
}) {
  const p = normalizeAbsolutePath(body.projectPath);
  const config = await readConfig(p);
  const planType = body.planType || config.type || 'frontend';
  const endpoint =
    config.localEndpoint || `http://localhost:${body.localPort || 5173}/`;
  const scan = scanProject(p);
  const detail = writeTestPlan(p, scan, planType, endpoint);
  return { status: 'ok', detail };
}

export async function apiPrepareEnrich(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  const config = await readConfig(p);
  const scan = scanProject(p);
  const testType = config.type === 'backend' ? 'backend' : 'frontend';
  const { promptPath, removedStubs } = prepareEnrichment(p, scan, {
    localEndpoint: config.localEndpoint || 'http://localhost:5173/',
    type: testType,
  });
  return {
    status: 'ok',
    detail: `IDE prompt written. Removed ${removedStubs} stub spec(s).`,
    promptPath,
    enriched: false,
    nextStep: 'enrich_with_ide_ai',
  };
}

export async function apiEnrichPrompt(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  const promptFile = path.resolve(p, PATHS.ENRICH_PROMPT);
  if (fs.existsSync(promptFile)) {
    return { content: fs.readFileSync(promptFile, 'utf-8') };
  }
  const config = await readConfig(p);
  const scan = scanProject(p);
  const content = buildIdeEnrichPrompt(p, scan, {
    localEndpoint: config.localEndpoint || 'http://localhost:5173/',
    testType: config.type === 'backend' ? 'backend' : 'frontend',
  });
  return { content };
}

function hasRunnableSpecs(projectPath: string): boolean {
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
  if (!fs.existsSync(testDir)) return false;
  const specs = fs.readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'));
  if (!specs.length) return false;
  return specs.some((f) => {
    const body = fs.readFileSync(path.join(testDir, f), 'utf-8');
    return !(body.includes('toHaveURL(/.*/)') && body.length < 400);
  });
}

export async function apiRunTests(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  if (!isEnrichmentComplete(p) && !hasRunnableSpecs(p)) {
    return {
      status: 'error',
      error:
        'No enriched tests found. Copy IDE_ENRICH_PROMPT.md into your AI IDE, write real Playwright specs, then add deepsight_tests/.enriched',
    };
  }
  const run = runPlaywrightTests(p);
  return {
    status: run.ok ? 'ok' : 'partial',
    detail: run.ok ? 'Playwright finished' : 'Playwright finished with failures',
    ...run,
  };
}

export async function apiReport(body: { projectPath: string }) {
  const p = normalizeAbsolutePath(body.projectPath);
  const resultsPath = path.resolve(p, PATHS.TEST_RESULTS);
  if (!fs.existsSync(resultsPath)) {
    return {
      status: 'error',
      error: 'No test run yet. Click "Run Playwright tests" after IDE enrichment.',
    };
  }
  const stored = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
  const run = {
    ok: stored.ok,
    passed: stored.ok ? 1 : 0,
    failed: stored.ok ? 0 : 1,
    total: 1,
    log: stored.stdout || '',
  };
  const reportPath = writeReportFromRun(p, run);
  return { status: 'ok', detail: `Report from Playwright run → ${reportPath}` };
}

/** One-click run — scaffold, smoke tests, Playwright, report. */
export async function apiRunPipeline(body: {
  projectPath: string;
  type: string;
  localPort: number;
  scope: string;
}) {
  const p = normalizeAbsolutePath(body.projectPath);
  await apiBootstrap(body);

  const config = await readConfig(p);
  const planType = body.type || config.type || 'frontend';
  const endpoint = config.localEndpoint || `http://localhost:${body.localPort || 8080}/`;

  const { scan, detail: scanDetail } = writeCodeSummary(
    p,
    planType === 'backend' ? 'backend' : 'frontend'
  );
  const prdDetail = writePrd(p, scan, planType === 'backend' ? 'backend' : 'frontend');
  const planDetail = writeTestPlan(p, scan, planType, endpoint);

  const { promptPath, removedStubs } = prepareEnrichment(p, scan, {
    localEndpoint: endpoint,
    type: planType === 'both' ? 'frontend' : planType,
  });

  removeScaffoldStubSpecs(p);
  const smokeCount = writeRouteSmokeSpecs(p, scan, {
    localEndpoint: endpoint,
    type: planType,
  });

  const run = runPlaywrightTests(p);
  const reportPath = writeReportFromRun(p, run);
  const kind = detectProjectKind(p);

  return {
    status: run.ok ? 'ok' : 'partial',
    detail: run.ok
      ? `Done — ${smokeCount} smoke group(s), report written`
      : `Finished with failures — see report`,
    stack: stackLabel(kind),
    kind,
    steps: { scan: scanDetail, prd: prdDetail, plan: planDetail, smokeCount, removedStubs },
    promptPath,
    reportPath,
    run,
  };
}

export async function apiWorkflowResult(query: {
  projectPath: string;
  tab: string;
}) {
  const p = normalizeAbsolutePath(query.projectPath);
  const tab = query.tab || 'report';

  if (tab === 'prompt') {
    const promptFile = path.resolve(p, PATHS.ENRICH_PROMPT);
    if (fs.existsSync(promptFile)) {
      return { content: fs.readFileSync(promptFile, 'utf-8') };
    }
    return { content: 'Run scaffold first to generate IDE_ENRICH_PROMPT.md' };
  }

  if (tab === 'report') {
    const htmlPath = path.resolve(p, PATHS.TEST_REPORT_HTML);
    const mdPath = path.resolve(p, PATHS.TEST_REPORT);
    if (fs.existsSync(mdPath)) {
      return { content: fs.readFileSync(mdPath, 'utf-8').substring(0, 12000) };
    }
    if (fs.existsSync(htmlPath)) {
      return { content: '(HTML report on disk — open via Full Report button)' };
    }
    return { content: 'No report yet. Run Playwright after IDE enrichment.' };
  }

  if (tab === 'files') {
    const testDir = path.resolve(p, PATHS.TEST_CODE_DIR);
    if (!fs.existsSync(testDir)) return { content: 'No test directory.' };
    const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.ts'));
    if (!files.length) return { content: 'No spec files. Use IDE AI to write tests.' };
    const contents = files
      .map((f) => `// ===== ${f} =====\n\n${fs.readFileSync(path.join(testDir, f), 'utf-8')}`)
      .join('\n\n');
    return { content: contents.substring(0, 12000) };
  }

  if (tab === 'plan') {
    const planPath = path.resolve(p, PATHS.FRONTEND_TEST_PLAN);
    const backPlanPath = path.resolve(p, PATHS.BACKEND_TEST_PLAN);
    if (fs.existsSync(planPath)) {
      return {
        content: JSON.stringify(JSON.parse(fs.readFileSync(planPath, 'utf-8')), null, 2).substring(0, 12000),
      };
    }
    if (fs.existsSync(backPlanPath)) {
      return {
        content: JSON.stringify(JSON.parse(fs.readFileSync(backPlanPath, 'utf-8')), null, 2).substring(0, 12000),
      };
    }
    return { content: 'No test plan. Run scaffold first.' };
  }

  return { content: 'Unknown tab: ' + tab };
}
