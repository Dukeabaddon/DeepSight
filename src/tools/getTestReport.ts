import fs from 'fs';
import path from 'path';
import { GetTestReportInputSchema } from '../schemas.js';
import { PATHS } from '../paths.js';
import { normalizeAbsolutePath } from '../utils/file.js';
import type { TestResultsArtifact } from '../utils/artifacts.js';
import { classifiedFailureFromResult } from '../utils/failureClassifier.js';
import type { ClassifiedTestReport } from '../types/testReport.js';
import { generateHtmlReport } from '../utils/report.js';

function loadTestResults(projectPath: string): TestResultsArtifact | null {
  const fp = path.resolve(projectPath, PATHS.TEST_RESULTS);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as TestResultsArtifact;
  } catch {
    return null;
  }
}

function loadLastRunId(projectPath: string): string | null {
  const fp = path.join(projectPath, '.deepsight', 'last-run.json');
  if (!fs.existsSync(fp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as { runId?: string };
    return data.runId ?? null;
  } catch {
    return null;
  }
}

function buildMarkdown(report: ClassifiedTestReport): string {
  const lines = [
    `# DeepSight classified report`,
    ``,
    `**Run:** ${report.runId}`,
    `**Generated:** ${report.generatedAt}`,
    ``,
    `## Summary`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Total: ${report.summary.totalRun}`,
    ``,
  ];
  if (report.classifiedFailures.length) {
    lines.push(`## Failures by category`);
    for (const f of report.classifiedFailures) {
      lines.push(
        `### ${f.testId} — ${f.category} (${f.confidence})`,
        `- **Test:** ${f.title}`,
        `- **Error:** ${f.errorMessage ?? 'n/a'}`,
        `- **Action:** ${f.suggestedAction}`,
        `- **Auto:** ${f.autoAction}`,
        ``,
      );
    }
  } else {
    lines.push(`## Failures`, `_None — all tests passed._`, ``);
  }
  return lines.join('\n');
}

function toIdePatches(report: ClassifiedTestReport): Array<{
  testId: string;
  category: string;
  patchHint: string;
}> {
  return report.classifiedFailures.map((f) => ({
    testId: f.testId,
    category: f.category,
    patchHint: `${f.suggestedAction} (${f.autoAction})`,
  }));
}

/**
 * Spec tool `get_test_report` (doc 05 / 12).
 */
export async function getTestReport(params: unknown) {
  const args = GetTestReportInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const artifact = loadTestResults(projectPath);

  if (!artifact) {
    return {
      error: 'NO_RUN_RESULTS',
      message: 'No test_results.json. Call run_tests first (or dryRun then a real run).',
      next_action: [
        {
          type: 'tool_use',
          tool: 'run_tests',
          message: 'Run run_tests after generate_test_code with app server up.',
        },
      ],
    };
  }

  const runId = args.runId ?? loadLastRunId(projectPath) ?? artifact.executionTimestamp;
  const classifiedFailures = artifact.results
    .filter((r) => r.status === 'failed')
    .map((r) => classifiedFailureFromResult(r));

  const report: ClassifiedTestReport = {
    runId,
    format: args.format,
    generatedAt: new Date().toISOString(),
    summary: artifact.summary,
    passed: artifact.results.filter((r) => r.status === 'passed'),
    classifiedFailures,
    markdownPath: path.relative(projectPath, PATHS.TEST_REPORT).replace(/\\/g, '/'),
  };

  const classifiedPath = path.join(projectPath, '.deepsight', 'classified-report.json');
  fs.mkdirSync(path.dirname(classifiedPath), { recursive: true });
  fs.writeFileSync(classifiedPath, JSON.stringify(report, null, 2), 'utf-8');

  const md = buildMarkdown(report);
  const mdPath = path.resolve(projectPath, PATHS.TEST_REPORT);
  fs.writeFileSync(mdPath, md, 'utf-8');
  try {
    generateHtmlReport(mdPath);
  } catch {
    /* optional */
  }

  if (args.format === 'summary') {
    return {
      runId: report.runId,
      summary: report.summary,
      failureCount: classifiedFailures.length,
      categories: [...new Set(classifiedFailures.map((f) => f.category))],
      markdownPath: report.markdownPath,
    };
  }

  if (args.format === 'ide-patches') {
    return {
      runId: report.runId,
      summary: report.summary,
      patches: toIdePatches(report),
      classifiedFailures,
      markdownPath: report.markdownPath,
    };
  }

  return {
    ...report,
    repairPromptPath: path
      .relative(projectPath, PATHS.REPAIR_PROMPT)
      .replace(/\\/g, '/'),
    next_action: classifiedFailures.some((f) => f.category === 'fragility')
      ? [
          {
            type: 'tool_use',
            tool: 'auto_heal_test',
            message:
              'Fragility failures detected — call auto_heal_test({ projectPath }) to propose selector heals.',
          },
        ]
      : [],
  };
}
