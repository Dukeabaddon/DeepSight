import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import { enrichRepairWithSelectorHints } from './selectorHints.js';
import { updateExploreFromResults } from './exploreManifest.js';
import { testIdFromSpecTitle } from './testId.js';
import { classifiedFailureFromResult } from './failureClassifier.js';
import { sanitizePlaywrightLog } from './logSanitize.js';
import { generateHtmlReportFromResults } from './report.js';

export { testIdFromSpecTitle } from './testId.js';

export type StructuredTestResult = {
  testId: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  durationMs?: number;
  errorMessage?: string;
  specFile?: string;
};

export type TestResultsArtifact = {
  projectName: string;
  executionTimestamp: string;
  summary: {
    totalRun: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: StructuredTestResult[];
  rawLogTail?: string;
};

export type RepairPromptArtifact = {
  systemContext: string;
  failures: Array<{
    testId: string;
    title: string;
    category?: string;
    failureDescription: string;
    diagnosticFixSuggestion: string;
    specFile?: string;
  }>;
};

function diagnosticFixSuggestion(result: StructuredTestResult): {
  category: string;
  suggestion: string;
} {
  const classified = classifiedFailureFromResult(result);
  const err = result.errorMessage ?? '';
  let suggestion = classified.suggestedAction;

  if (/ERR_CONNECTION_REFUSED|econnrefused/i.test(err)) {
    const wrongPort = err.match(/localhost:(\d+)/i)?.[1];
    suggestion = wrongPort
      ? `Environment: app not reachable at localhost:${wrongPort}. Start the dev server and set dashboard App port / .deepsight/config.json localEndpoint (e.g. http://localhost:8080). Update hardcoded URLs in ${result.specFile ?? 'spec files'}.`
      : 'Environment: connection refused — start dev server and verify base URL in .deepsight/config.json.';
  } else if (/strict mode violation/i.test(err) && /main|body/i.test(err)) {
    suggestion =
      "Fragility: replace getByRole('main').or(locator('body')) with a single target — use getByRole('main') when present, else locator('body'). Re-run sync via dashboard Run DeepSight.";
  } else if (/locator resolved to 0 elements/i.test(err)) {
    suggestion =
      'Fragility: selector not found — use getByRole/getByTestId from the live UI; add data-testid in app if needed.';
  }

  return { category: classified.category, suggestion };
}

/** Parse Playwright JSON reporter file (preferred when run_tests uses DeepSight config). */
export function parsePlaywrightJsonFile(filePath: string): StructuredTestResult[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsePlaywrightJsonPayload(payload);
  } catch {
    return [];
  }
}

export function parsePlaywrightJsonPayload(payload: any): StructuredTestResult[] {
  const results: StructuredTestResult[] = [];
  const suites = payload.suites || [];
  let tc = 0;
  const walk = (suite: any, filePrefix: string) => {
    const file = suite.file || filePrefix;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tc++;
        const title = spec.title || test.title || `Test ${tc}`;
        const last = test.results?.[test.results.length - 1];
        const status = last?.status || 'unknown';
        results.push({
          testId: testIdFromSpecTitle(title, tc),
          title,
          status:
            status === 'passed'
              ? 'passed'
              : status === 'skipped'
                ? 'skipped'
                : status === 'failed' || status === 'timedOut'
                  ? 'failed'
                  : 'unknown',
          durationMs: last?.duration,
          errorMessage: last?.error?.message,
          specFile: file,
        });
      }
    }
    for (const child of suite.suites || []) walk(child, file);
  };
  for (const s of suites) walk(s, '');
  return results;
}

/** Parse Playwright JSON reporter output when available. */
export function parsePlaywrightJsonReport(stdout: string): StructuredTestResult[] {
  const results: StructuredTestResult[] = [];
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) return results;
  try {
    return parsePlaywrightJsonPayload(JSON.parse(stdout.slice(jsonStart)));
  } catch {
    /* list reporter fallback handled by caller */
  }
  return results;
}

export function parseListReporter(stdout: string): StructuredTestResult[] {
  const results: StructuredTestResult[] = [];
  const failRe = /^\s*(?:×|✘|x)\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)\s*ms\))?/gm;
  const passRe = /^\s*✓\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)\s*ms\))?/gm;
  let id = 0;
  let m: RegExpExecArray | null;
  while ((m = failRe.exec(stdout))) {
    id++;
    const title = m[1].trim();
    results.push({
      testId: testIdFromSpecTitle(title, id),
      title,
      status: 'failed',
      durationMs: m[2] ? Number(m[2]) : undefined,
    });
  }
  while ((m = passRe.exec(stdout))) {
    id++;
    const title = m[1].trim();
    results.push({
      testId: testIdFromSpecTitle(title, id),
      title,
      status: 'passed',
      durationMs: m[2] ? Number(m[2]) : undefined,
    });
  }
  return results;
}

export function buildTestResultsArtifact(
  projectPath: string,
  stdout: string,
  ok: boolean,
  jsonReportPath?: string,
): TestResultsArtifact {
  const fromFile = jsonReportPath ? parsePlaywrightJsonFile(jsonReportPath) : [];
  const fromJson = fromFile.length > 0 ? fromFile : parsePlaywrightJsonReport(stdout);
  let structured = fromJson.length > 0 ? fromJson : parseListReporter(stdout);

  if (structured.length === 0 && !ok) {
    structured = [
      {
        testId: 'TC001',
        title: 'Playwright run',
        status: 'failed',
        errorMessage: 'See rawLogTail',
      },
    ];
  }

  const passed = structured.filter((r) => r.status === 'passed').length;
  const failed = structured.filter((r) => r.status === 'failed').length;
  const skipped = structured.filter((r) => r.status === 'skipped').length;

  return {
    projectName: path.basename(projectPath),
    executionTimestamp: new Date().toISOString(),
    summary: {
      totalRun: structured.length || (ok ? 0 : 1),
      passed,
      failed: failed || (ok ? 0 : Math.max(1, structured.length === 0 ? 1 : 0)),
      skipped,
    },
    results: structured,
    rawLogTail: sanitizePlaywrightLog(stdout),
  };
}

export function buildRepairPrompt(artifact: TestResultsArtifact): RepairPromptArtifact {
  const seen = new Set<string>();
  const failures = artifact.results
    .filter((r) => r.status === 'failed')
    .map((r) => {
      const { category, suggestion } = diagnosticFixSuggestion(r);
      return {
        testId: r.testId,
        title: r.title,
        category,
        failureDescription: r.errorMessage || `Test failed: ${r.title}`,
        diagnosticFixSuggestion: suggestion,
        specFile: r.specFile,
      };
    })
    .filter((f) => {
      const key = `${f.testId}|${f.specFile ?? ''}|${f.failureDescription.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    systemContext:
      'You are an automated repair agent for DeepSight. Use PRD + feature_map + test_results. Fix app code or enriched Playwright specs — avoid circular self-referential tests.',
    failures,
  };
}

export function writeRunArtifacts(
  projectPath: string,
  stdout: string,
  ok: boolean,
  jsonReportPath?: string,
): { resultsPath: string; repairPath: string; artifact: TestResultsArtifact } {
  const artifact = buildTestResultsArtifact(projectPath, stdout, ok, jsonReportPath);
  const resultsPath = path.resolve(projectPath, PATHS.TEST_RESULTS);
  const repairPath = path.resolve(projectPath, PATHS.REPAIR_PROMPT);
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(artifact, null, 2), 'utf-8');
  const repair = enrichRepairWithSelectorHints(artifact, buildRepairPrompt(artifact));
  fs.writeFileSync(repairPath, JSON.stringify(repair, null, 2), 'utf-8');
  updateExploreFromResults(projectPath, artifact);
  try {
    generateHtmlReportFromResults(projectPath, artifact);
  } catch {
    /* html report optional */
  }
  return { resultsPath, repairPath, artifact };
}
