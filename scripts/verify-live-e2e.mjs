/**
 * Mode F: full spec pipeline + real run_tests + get_test_report on live app.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const deepsightRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath =
  process.env.DEEPSIGHT_PROJECT_PATH ||
  path.resolve(deepsightRoot, '..', 'apps', 'web');
const baseUrl = process.env.DEEPSIGHT_BASE_URL || 'http://localhost:3000';

const imp = (rel) => import(pathToFileURL(path.join(deepsightRoot, 'dist', rel)).href);

const { analyzeCodebase } = await imp('tools/analyzeCodebase.js');
const { parsePrd } = await imp('tools/parsePrd.js');
const { generateTestPlan } = await imp('tools/generateTestPlan.js');
const { generateTestCode } = await imp('tools/generateTestCode.js');
const { runTests } = await imp('tools/runTests.js');
const { getTestReport } = await imp('tools/getTestReport.js');

let serverUp = false;
try {
  const res = await fetch(baseUrl, { signal: AbortSignal.timeout(8000) });
  serverUp = res.status < 500;
} catch {
  serverUp = false;
}

if (!serverUp) {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: 'SERVER_NOT_READY',
      baseUrl,
      projectPath,
      hint: 'Start dev server, then re-run npm run test:live:e2e',
    }),
  );
  process.exit(0);
}

await analyzeCodebase({ projectPath, depth: 'deep' });
await parsePrd({ projectPath });
const plan = await generateTestPlan({ projectPath, coverageTarget: 'standard' });
await generateTestCode({ projectPath, planId: plan.planId });

const run = await runTests({ projectPath, dryRun: false, baseUrl, testPath: 'tests/deepsight' });
assert.notStrictEqual(run.error, 'SERVER_NOT_READY', 'server should be up');
assert.ok(run.runId, 'runId from real run');
assert.ok(run.resultsPath, 'resultsPath');

const resultsFp = path.join(projectPath, 'deepsight_tests', 'tmp', 'test_results.json');
assert.ok(fs.existsSync(resultsFp), 'test_results.json written');

const artifact = JSON.parse(fs.readFileSync(resultsFp, 'utf-8'));
assert.ok(artifact.summary.totalRun >= 1, 'at least one test in artifact');

const report = await getTestReport({ projectPath, format: 'detailed' });
assert.ok(Array.isArray(report.classifiedFailures), 'classifiedFailures array');

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      projectPath,
      runOk: run.ok,
      passed: run.passed,
      failed: run.failed,
      total: run.total,
      artifactSummary: artifact.summary,
      classifiedCount: report.classifiedFailures.length,
      categories: [...new Set(report.classifiedFailures.map((f) => f.category))],
      resultsPath: run.resultsPath,
    },
    null,
    2,
  ),
);
