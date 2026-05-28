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
import { generateHtmlReport } from './report.js';

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

export function runPlaywrightTests(projectPath: string): {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  log: string;
} {
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
  const specs = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'))
    : [];

  if (specs.length === 0) {
    return { ok: false, passed: 0, failed: 0, total: 0, log: 'No .spec.ts files in deepsight_tests. Enrich with IDE AI first.' };
  }

  try {
    const out = execSync('npx playwright test deepsight_tests --reporter=list', {
      cwd: projectPath,
      timeout: 300000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const passed = (out.match(/\bpassed\b/g) || []).length;
    const failed = (out.match(/\bfailed\b/g) || []).length;
    const resultsPath = path.resolve(projectPath, PATHS.TEST_RESULTS);
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ ok: true, stdout: out, at: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    return { ok: true, passed, failed, total: passed + failed, log: out.slice(-4000) };
  } catch (e: any) {
    const log = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    const resultsPath = path.resolve(projectPath, PATHS.TEST_RESULTS);
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ ok: false, stdout: log, at: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    return { ok: false, passed: 0, failed: 1, total: 1, log: log.slice(-4000) };
  }
}

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
- **Status:** ${run.ok ? 'Completed' : 'Completed with failures'}
- **Planned cases:** ${planLen}
- **Run summary:** see Playwright output below

## Playwright output (tail)
\`\`\`
${run.log}
\`\`\`

## Next steps
${run.ok ? 'Review failures in output and update specs in `deepsight_tests/`.' : 'Fix failing specs or app issues, then re-run from the dashboard.'}
`;

  const mdPath = path.resolve(projectPath, PATHS.TEST_REPORT);
  fs.writeFileSync(mdPath, md, 'utf-8');
  try {
    generateHtmlReport(mdPath);
  } catch {}
  return mdPath;
}

export { isEnrichmentComplete };
