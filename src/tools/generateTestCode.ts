import { GenerateTestCodeInputSchema } from '../schemas.js';
import { ensureDirs, normalizeAbsolutePath } from '../utils/file.js';
import { CI_TEST_SUBDIR, writePlaywrightFromPlan } from '../utils/playwrightGen.js';

/**
 * Spec tool `generate_test_code` (doc 04).
 */
export async function generateTestCode(params: unknown) {
  const args = GenerateTestCodeInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);

  ensureDirs(projectPath);

  try {
    const result = await writePlaywrightFromPlan(projectPath, {
      planId: args.planId,
      testIds: args.testIds ?? [],
    });

    return {
      planId: args.planId ?? 'latest',
      outputDir: CI_TEST_SUBDIR,
      files: result.files,
      testCaseCount: result.testCaseCount,
      alsoWrittenTo: 'deepsight_tests',
      next_action: [
        {
          type: 'tool_use',
          tool: 'run_tests',
          message: `Wrote ${result.files.length} spec file(s). Start dev server, then run_tests.`,
        },
      ],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'NO_TEST_PLAN') {
      return {
        error: 'NO_TEST_PLAN',
        message: 'Test plan not found. Call generate_test_plan first.',
        next_action: [
          {
            type: 'tool_use',
            tool: 'generate_test_plan',
            message: 'Run generate_test_plan after parse_prd.',
          },
        ],
      };
    }
    throw e;
  }
}
