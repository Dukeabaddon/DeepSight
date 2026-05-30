/**
 * QA: deep analyze_codebase — build, tree-sitter probe, code_entities row count.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectPath = path.join(root, 'apps', 'web');

async function probeTreeSitter() {
  try {
    const dynamicImport = new Function('s', 'return import(s)');
    await dynamicImport('tree-sitter');
    await dynamicImport('tree-sitter-typescript');
    return true;
  } catch (e) {
    console.log('tree-sitter optional packages not loaded:', (e && e.message) || e);
    return false;
  }
}

const treeSitterInstalled = await probeTreeSitter();
console.log('tree-sitter packages resolvable:', treeSitterInstalled);

const { analyzeCodebase } = await import('../dist/tools/analyzeCodebase.js');
const { parsePrd } = await import('../dist/tools/parsePrd.js');
const { generateTestPlan } = await import('../dist/tools/generateTestPlan.js');
const { generateTestCode } = await import('../dist/tools/generateTestCode.js');
const { runTests } = await import('../dist/tools/runTests.js');
const { getTestReport } = await import('../dist/tools/getTestReport.js');
const { autoHealTest } = await import('../dist/tools/autoHealTest.js');
const { countCodeEntitiesForRun } = await import('../dist/db/analysisStore.js');

const result = await analyzeCodebase({ projectPath, depth: 'deep' });

assert.ok(result.functionAnalysis, 'functionAnalysis required for deep');
assert.ok(result.functionAnalysis.totalFunctions >= 1, 'totalFunctions >= 1');
assert.ok(
  result.functionAnalysis.entitiesStored >= 1,
  `entitiesStored >= 1, got ${result.functionAnalysis.entitiesStored}`,
);

const dbCount = await countCodeEntitiesForRun(projectPath, result.analysisRunId);
assert.strictEqual(
  dbCount,
  result.functionAnalysis.entitiesStored,
  'sqlite/json entity count matches entitiesStored',
);

assert.ok(result.importGraph, 'importGraph required for deep');
assert.ok(result.importGraph.edgeCount >= 1, 'import graph edges >= 1');
assert.ok(result.callGraphStub, 'callGraphStub required for deep');
assert.ok(fs.existsSync(path.join(projectPath, result.importGraph.artifactPath)), 'import-graph.json exists');

const prd = await parsePrd({ projectPath });
assert.ok(prd.prdId, 'parse_prd should return prdId');
assert.ok(prd.requirementCount >= 1, 'requirements >= 1');

const plan = await generateTestPlan({ projectPath, coverageTarget: 'standard' });
assert.ok(plan.planId, 'generate_test_plan should return planId');
assert.ok(plan.testCaseCount >= 1, 'test cases >= 1');
assert.ok(plan.routesReferenced?.length >= 0, 'routesReferenced present');

const code = await generateTestCode({ projectPath, planId: plan.planId });
assert.ok(code.files?.length >= 1, 'spec files written');

const dry = await runTests({ projectPath, dryRun: true });
assert.strictEqual(dry.dryRun, true);
assert.ok(dry.specFiles >= 1, 'dryRun sees specs');

const resultsPath = path.join(projectPath, 'deepsight_tests', 'tmp', 'test_results.json');
fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
fs.writeFileSync(
  resultsPath,
  JSON.stringify(
    {
      projectName: 'repoflux-web',
      executionTimestamp: new Date().toISOString(),
      summary: { totalRun: 2, passed: 1, failed: 1, skipped: 0 },
      results: [
        { testId: 'TC001', title: 'TC001: Visit /', status: 'passed' },
        {
          testId: 'TC002',
          title: 'TC002: Visit /',
          status: 'failed',
          errorMessage:
            'locator resolved to 0 elements waiting for selector "button.checkout-submit"',
        },
      ],
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(projectPath, '.deepsight', 'last-run.json'),
  JSON.stringify({ runId: 'run-verify-fixture' }, null, 2),
);

const report = await getTestReport({ projectPath, format: 'detailed' });
assert.ok(report.classifiedFailures?.length === 1, 'one classified failure');
assert.strictEqual(report.classifiedFailures[0].category, 'fragility');

const summary = await getTestReport({ projectPath, format: 'summary' });
assert.strictEqual(summary.failureCount, 1);
assert.ok(summary.categories?.includes('fragility'), 'summary lists fragility');

const heal = await autoHealTest({ projectPath, testId: 'TC002', applyPatches: true });
assert.ok(heal.proposed >= 1, 'heal proposals');
assert.ok(heal.proposals[0].recommendedSelector, 'selector suggestion');

console.log(
  JSON.stringify(
    {
      ok: true,
      parser: result.functionAnalysis.parser,
      treeSitterAvailable: result.functionAnalysis.treeSitterAvailable,
      treeSitterInstalled,
      totalFunctions: result.functionAnalysis.totalFunctions,
      entitiesStored: result.functionAnalysis.entitiesStored,
      dbCount,
      store: result.store,
      prdId: prd.prdId,
      requirementCount: prd.requirementCount,
      planId: plan.planId,
      testCaseCount: plan.testCaseCount,
      routesReferenced: plan.routesReferenced,
      specFiles: code.files,
      dryRunSpecs: dry.specFiles,
      importGraphEdges: result.importGraph?.edgeCount,
      callGraphChains: result.callGraphStub?.sampleChains?.length ?? 0,
      classifiedCategory: report.classifiedFailures[0].category,
      healProposed: heal.proposed,
      healApplied: heal.healed,
      reportSummary: summary.summary,
    },
    null,
    2,
  ),
);

if (treeSitterInstalled && result.functionAnalysis.parser !== 'tree-sitter') {
  console.warn(
    'WARN: tree-sitter installed but parser was regex-stub — check native build / language load',
  );
}
