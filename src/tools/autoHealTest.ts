import path from 'path';
import { AutoHealTestInputSchema } from '../schemas.js';
import { normalizeAbsolutePath } from '../utils/file.js';
import { buildHealProposals, writeHealArtifacts, HEALABLE_CATEGORIES } from '../utils/autoHeal.js';
import { getTestReport } from './getTestReport.js';

/**
 * Spec tool `auto_heal_test` (doc 11–12) — patches/heals by failure category.
 */
export async function autoHealTest(params: unknown) {
  const args = AutoHealTestInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);

  if (!args.failureLog) {
    const report = await getTestReport({ projectPath, format: 'summary' });
    if ('error' in report && report.error === 'NO_RUN_RESULTS') {
      return report;
    }
    const cats: string[] =
      'categories' in report && Array.isArray(report.categories) ? report.categories : [];
    const healable = cats.filter((c) => HEALABLE_CATEGORIES.includes(c as any));
    if (healable.length === 0 && !args.testId) {
      return {
        healed: 0,
        proposals: [],
        message: 'No healable failures in last report.',
        healableCategories: HEALABLE_CATEGORIES,
        next_action: [
          {
            type: 'tool_use',
            tool: 'get_test_report',
            message: 'Run get_test_report after run_tests.',
          },
        ],
      };
    }
  }

  const proposals = buildHealProposals(projectPath, {
    testId: args.testId,
    failureLog: args.failureLog,
    testPath: args.testPath,
    applyPatches: args.applyPatches,
  });

  if (proposals.length === 0) {
    return {
      healed: 0,
      proposals: [],
      message: 'No matching failures to heal.',
      healableCategories: HEALABLE_CATEGORIES,
      next_action: [
        {
          type: 'tool_use',
          tool: 'get_test_report',
          message: 'Run get_test_report to refresh classification.',
        },
      ],
    };
  }

  const artifactPath = writeHealArtifacts(projectPath, proposals);
  const applied = proposals.filter((p) => p.applied).length;
  const byCategory = [...new Set(proposals.map((p) => p.category))];

  return {
    healed: applied,
    proposed: proposals.length,
    categories: byCategory,
    proposals,
    artifactPath: path.relative(projectPath, artifactPath).replace(/\\/g, '/'),
    next_action: [
      {
        type: 'tool_use',
        tool: 'run_tests',
        message: `Applied ${applied} patch(es) across [${byCategory.join(', ')}]. Re-run tests.`,
      },
    ],
  };
}
