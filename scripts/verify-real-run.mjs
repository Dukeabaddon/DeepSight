/**
 * Optional live QA: real run_tests against a running dev server.
 * Usage: DEEPSIGHT_PROJECT_PATH=/abs/path/to/app npm run test:run:live
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const deepsightRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath =
  process.env.DEEPSIGHT_PROJECT_PATH ||
  path.resolve(deepsightRoot, '..', 'apps', 'web');

const { runTests } = await import(pathToFileURL(path.join(deepsightRoot, 'dist/tools/runTests.js')).href);
const { getTestReport } = await import(
  pathToFileURL(path.join(deepsightRoot, 'dist/tools/getTestReport.js')).href,
);

const run = await runTests({ projectPath, dryRun: false });
if (run.error === 'SERVER_NOT_READY') {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: 'SERVER_NOT_READY',
      baseUrl: run.baseUrl,
      hint: 'Start dev server, set DEEPSIGHT_BASE_URL, then re-run npm run test:run:live',
    }),
  );
  process.exit(0);
}

assert.ok(run.runId, 'runId');
assert.ok(run.resultsPath, 'resultsPath');

const report = await getTestReport({ projectPath, format: 'summary' });
console.log(
  JSON.stringify(
    {
      ok: run.ok,
      baseUrl: run.baseUrl,
      passed: run.passed,
      failed: run.failed,
      total: run.total,
      failureCount: report.failureCount,
      categories: report.categories,
    },
    null,
    2,
  ),
);
