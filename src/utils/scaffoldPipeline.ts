import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from '../paths.js';
import { scanProject, scanToSummaryYaml, type ProjectScan } from './projectScan.js';
import {
  writeEnrichPromptFile,
  removeScaffoldStubSpecs,
  isEnrichmentComplete,
} from './enrichPrompt.js';
import { generateHtmlReport, generateHtmlReportFromResults } from './report.js';
import { writeFeatureMap } from './featureMap.js';
import { writeRunArtifacts } from './artifacts.js';
import { runPlaywrightTests as runPlaywrightTestsCore } from './playwrightRunner.js';
import { writeLifecycleState } from './lifecycleState.js';
import { writeDiscoverManifest } from './exploreManifest.js';
import { sanitizePlaywrightLog } from './logSanitize.js';
import type { ProjectMode } from './lifecycle.js';

export type ScaffoldConfig = {
  projectPath: string;
  type: 'frontend' | 'backend' | 'both';
  localPort: number;
  scope: string;
};

export function writeCodeSummary(projectPath: string, testType: string): { scan: ProjectScan; detail: string } {
  const scan = scanProject(projectPath);
  const summaryPath = path.resolve(projectPath, PATHS.CODE_SUMMARY);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, scanToSummaryYaml(scan, testType), 'utf-8');
  const genDir = path.resolve(projectPath, PATHS.GENERATED_DIR);
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, 'code_summary.json'),
    JSON.stringify({ testType, scan }, null, 2),
    'utf-8'
  );
  return {
    scan,
    detail: `Scanned ${scan.routes.length} routes from ${scan.router_files.length ? scan.router_files.join(', ') : 'pages fallback'}`,
  };
}

export function writePrd(projectPath: string, scan: ProjectScan, testType: string): string {
  const requirements = scan.routes.map((r, i) => ({
    id: `REQ-${String(i + 1).padStart(3, '0')}`,
    title: `${r.description} (${r.path})`,
    description: `Verify route ${r.path} works as specified in the application`,
    priority: i === 0 ? 'High' : 'Medium',
    acceptanceCriteria: [
      `Route ${r.path} loads without console errors`,
      `Primary UI on ${r.path} is visible`,
      `Navigation to/from ${r.path} works`,
    ],
  }));

  if (requirements.length === 0) {
    requirements.push({
      id: 'REQ-001',
      title: 'Core application',
      description: 'Main user flows',
      priority: 'High',
      acceptanceCriteria: ['Application loads', 'Primary navigation works'],
    });
  }

  const prd = {
    projectName: path.basename(projectPath),
    testType,
    routes: scan.routes,
    requirements,
  };
  const prdPath = path.resolve(projectPath, PATHS.STANDARD_PRD);
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2), 'utf-8');

  const genDir = path.resolve(projectPath, PATHS.GENERATED_DIR);
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, 'normalized_prd.json'),
    JSON.stringify(prd, null, 2),
    'utf-8'
  );

  writeFeatureMap(projectPath, scan, testType);
  writeLifecycleState(projectPath, {
    phase: 'feature_map',
    mode: (testType === 'backend' ? 'backend' : testType === 'both' ? 'both' : 'frontend') as ProjectMode,
  });

  return `${requirements.length} requirements`;
}

function buildTestCasesForRoute(
  route: { path: string; description: string },
  baseUrl: string,
  isBackend: boolean,
  startId: number
): { cases: any[]; nextId: number } {
  const cases: any[] = [];
  let id = startId;
  const routeLabel = route.path === '*' ? '404' : route.path;

  cases.push({
    id: `TC${String(id++).padStart(3, '0')}`,
    title: `${routeLabel} — loads and primary UI visible`,
    description: `Open ${route.path} and verify main content renders`,
    category: 'functional',
    priority: 'High',
    steps: isBackend
      ? [`Request ${route.path}`, 'Expect 2xx', 'Validate response shape']
      : [
          `Go to ${baseUrl}${route.path === '*' ? '/nonexistent-path-404' : route.path}`,
          'Wait for network idle',
          'Assert heading or main landmark is visible',
        ],
  });

  cases.push({
    id: `TC${String(id++).padStart(3, '0')}`,
    title: `${routeLabel} — error or empty state handling`,
    description: `Invalid input or edge case on ${route.path}`,
    category: 'error_handling',
    priority: 'Medium',
    steps: isBackend
      ? ['Send invalid payload', 'Expect 4xx with safe error body']
      : ['Trigger validation or empty state if applicable', 'Assert user-visible feedback'],
  });

  return { cases, nextId: id };
}

export function writeTestPlan(
  projectPath: string,
  scan: ProjectScan,
  planType: string,
  localEndpoint: string
): string {
  const isBackend = planType === 'backend';
  const baseUrl = localEndpoint.replace(/\/$/, '');
  let tcId = 1;
  const testPlan: any[] = [];

  const routes = scan.routes.length ? scan.routes : [{ path: '/', description: 'Home', auth_required: false, file: '' }];
  for (const route of routes) {
    const { cases, nextId } = buildTestCasesForRoute(route, baseUrl, isBackend, tcId);
    testPlan.push(...cases);
    tcId = nextId;
  }

  const planPath = isBackend
    ? path.resolve(projectPath, PATHS.BACKEND_TEST_PLAN)
    : path.resolve(projectPath, PATHS.FRONTEND_TEST_PLAN);
  fs.writeFileSync(planPath, JSON.stringify(testPlan, null, 2), 'utf-8');

  if (planType === 'both') {
    writeTestPlan(projectPath, scan, 'backend', localEndpoint);
  }

  return `${testPlan.length} test cases`;
}

/** Route-aware smoke specs for one-click Run. */
export function writeRouteSmokeSpecs(
  projectPath: string,
  scan: ProjectScan,
  config: { localEndpoint: string; type: string }
): number {
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
  fs.mkdirSync(testDir, { recursive: true });
  const base = config.localEndpoint.replace(/\/$/, '');
  const runUi =
    config.type !== 'backend' &&
    scan.kind !== 'go' &&
    scan.kind !== 'dotnet' &&
    scan.kind !== 'node_api';

  let written = 0;

  if (runUi && scan.routes.length > 0) {
    const lines: string[] = [
      `import { test, expect } from '@playwright/test';`,
      ``,
      `const BASE = '${base}';`,
      ``,
      `test.describe('DeepSight route smoke', () => {`,
    ];
    for (const r of scan.routes) {
      const url =
        r.path === '*'
          ? `${base}/__deepsight_missing_route__`
          : `${base}${r.path.startsWith('/') ? r.path : '/' + r.path}`;
      const safeName = r.path.replace(/'/g, "\\'");
      lines.push(`  test('${safeName} loads', async ({ page }) => {`);
      lines.push(`    const res = await page.goto('${url}');`);
      lines.push(`    expect(res?.ok() || res?.status() === 304).toBeTruthy();`);
      lines.push(`    await expect(page.locator('body')).toBeVisible();`);
      lines.push(`  });`);
      lines.push('');
      written++;
    }
    lines.push(`});`);
    fs.writeFileSync(path.join(testDir, 'deepsight-smoke-routes.spec.ts'), lines.join('\n'), 'utf-8');
  }

  if (config.type === 'backend' || config.type === 'both') {
    const apiLines = [
      `import { test, expect } from '@playwright/test';`,
      ``,
      `const BASE = '${base}';`,
      ``,
      `test.describe('DeepSight API smoke', () => {`,
      `  test('health or root responds', async ({ request }) => {`,
      `    const res = await request.get(BASE);`,
      `    expect(res.status()).toBeLessThan(500);`,
      `  });`,
      `});`,
    ];
    fs.writeFileSync(path.join(testDir, 'deepsight-smoke-api.spec.ts'), apiLines.join('\n'), 'utf-8');
    written++;
  }

  return written;
}

export function prepareEnrichment(
  projectPath: string,
  scan: ProjectScan,
  config: { localEndpoint: string; type: string }
): { promptPath: string; removedStubs: number } {
  const testType = config.type === 'backend' ? 'backend' : 'frontend';
  const removedStubs = removeScaffoldStubSpecs(projectPath);
  const promptPath = writeEnrichPromptFile(projectPath, scan, {
    localEndpoint: config.localEndpoint,
    testType,
  });

  const phasePath = path.resolve(projectPath, PATHS.SCAFFOLD_PHASE);
  fs.mkdirSync(path.dirname(phasePath), { recursive: true });
  fs.writeFileSync(
    phasePath,
    JSON.stringify(
      {
        phase: 'awaiting_enrich',
        removedStubs,
        promptPath,
        endpoint: config.localEndpoint,
        at: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  if (fs.existsSync(path.resolve(projectPath, PATHS.ENRICHED_MARKER))) {
    fs.unlinkSync(path.resolve(projectPath, PATHS.ENRICHED_MARKER));
  }

  return { promptPath, removedStubs };
}

export function runPlaywrightTests(
  projectPath: string,
  options: { testPath?: string; baseUrl?: string; mode?: 'headless' | 'headed' | 'debug' } = {},
) {
  const run = runPlaywrightTestsCore(projectPath, options);
  return {
    ok: run.ok,
    passed: run.passed,
    failed: run.failed,
    total: run.total,
    log: run.log,
    baseUrl: run.baseUrl,
  };
}

export { runPlaywrightTestsCore };

export function writeReportFromRun(
  projectPath: string,
  run: { ok: boolean; passed: number; failed: number; total: number; log: string }
): string {
  const planPath = path.resolve(projectPath, PATHS.FRONTEND_TEST_PLAN);
  let planLen = 0;
  if (fs.existsSync(planPath)) {
    planLen = JSON.parse(fs.readFileSync(planPath, 'utf-8')).length;
  }

  const md = `# DeepSight Test Report

## Metadata
- **Project:** ${path.basename(projectPath)}
- **Date:** ${new Date().toISOString().split('T')[0]}
- **Source:** Playwright execution (not estimated)

## Results
- **Status:** ${run.ok ? 'All checks passed' : 'Needs fixes (normal on first run)'}
- **Planned cases:** ${planLen}
- **Passed / failed:** ${run.passed} / ${run.failed} (total ${run.total})

## What this means
${run.ok
    ? 'Smoke tests passed against your running app. You can enrich tests in Cursor for deeper coverage.'
    : 'DeepSight is working. Failures usually mean: (1) app port mismatch — use the port Vite prints, e.g. 8081; (2) smoke tests are shallow until Cursor writes real tests. Click **Fix this now** on the dashboard to copy an AI repair brief.'}

## Playwright output (tail)
\`\`\`
${sanitizePlaywrightLog(run.log)}
\`\`\`

## Next steps
${run.ok ? 'Optional: enrich tests in Cursor for deeper coverage.' : 'Use **Fix this now** on the dashboard — paste into Cursor to fix the app or tests, then run again.'}
`;

  const mdPath = path.resolve(projectPath, PATHS.TEST_REPORT);
  fs.writeFileSync(mdPath, md, 'utf-8');
  const resultsPath = path.resolve(projectPath, PATHS.TEST_RESULTS);
  if (fs.existsSync(resultsPath)) {
    try {
      generateHtmlReportFromResults(projectPath);
    } catch {
      /* legacy markdown template optional */
      try {
        generateHtmlReport(mdPath);
      } catch {}
    }
  }
  return mdPath;
}

export { isEnrichmentComplete };
