import fs from 'fs';

import path from 'path';

import { RunTestsInputSchema } from '../schemas.js';

import { PATHS } from '../paths.js';

import { ensureDirs, normalizeAbsolutePath } from '../utils/file.js';

import { CI_TEST_SUBDIR } from '../utils/playwrightGen.js';

import { isServerReachable, resolveBaseUrl, runPlaywrightTests } from '../utils/playwrightRunner.js';

import { writeReportFromRun } from '../utils/scaffoldPipeline.js';



function countSpecs(projectPath: string, relDir: string): number {

  const dir = path.resolve(projectPath, relDir);

  if (!fs.existsSync(dir)) return 0;

  return fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).length;

}



/**

 * Spec tool `run_tests` (doc 05) — local Playwright execution via DeepSight config.

 */

export async function runTests(params: unknown) {

  const args = RunTestsInputSchema.parse(params);

  const projectPath = normalizeAbsolutePath(args.projectPath);

  const testPath = args.testPath ?? CI_TEST_SUBDIR;



  ensureDirs(projectPath);



  const specCount = countSpecs(projectPath, testPath);

  if (specCount === 0) {

    const legacy = countSpecs(projectPath, PATHS.TEST_CODE_DIR);

    if (legacy === 0) {

      return {

        error: 'NO_SPECS',

        message: 'No Playwright specs found. Call generate_test_code first.',

        next_action: [

          {

            type: 'tool_use',

            tool: 'generate_test_code',

            message: 'Run generate_test_code({ projectPath }).',

          },

        ],

      };

    }

  }



  const baseUrl = await resolveBaseUrl(projectPath, args.baseUrl);



  if (args.dryRun) {

    const n = Math.max(specCount, countSpecs(projectPath, PATHS.TEST_CODE_DIR));

    return {

      dryRun: true,

      testPath,

      baseUrl,

      specFiles: n,

      mode: args.mode,

      message: `Would run Playwright against ${baseUrl} (config: .deepsight/playwright.deepsight.config.mjs)`,

      next_action: [

        {

          type: 'instructions',

          message:

            'Start the app (e.g. npm run dev), set DEEPSIGHT_BASE_URL if not localhost:3000, then run_tests with dryRun: false.',

        },

      ],

    };

  }



  if (!args.skipServerCheck) {

    const up = await isServerReachable(baseUrl);

    if (!up) {

      return {

        error: 'SERVER_NOT_READY',

        baseUrl,

        message: `Dev server not reachable at ${baseUrl}. Start it or set baseUrl / DEEPSIGHT_BASE_URL / .deepsight/config.json localEndpoint.`,

        next_action: [

          {

            type: 'instructions',

            message: 'Start your app, then retry run_tests with skipServerCheck: true only if you know the URL is correct.',

          },

        ],

      };

    }

  }



  const run = runPlaywrightTests(projectPath, {

    testPath,

    baseUrl,

    mode: args.mode,

  });

  const reportPath = writeReportFromRun(projectPath, run);

  const runId = `run-${Date.now()}`;

  const lastRunFp = path.join(projectPath, '.deepsight', 'last-run.json');

  fs.mkdirSync(path.dirname(lastRunFp), { recursive: true });

  fs.writeFileSync(

    lastRunFp,

    JSON.stringify(

      {

        runId,

        ok: run.ok,

        testPath,

        baseUrl: run.baseUrl,

        passed: run.passed,

        failed: run.failed,

        total: run.total,

        resultsPath: path.relative(projectPath, run.resultsPath).replace(/\\/g, '/'),

        at: new Date().toISOString(),

      },

      null,

      2,

    ),

    'utf-8',

  );



  return {

    runId,

    ok: run.ok,

    passed: run.passed,

    failed: run.failed,

    total: run.total,

    testPath,

    baseUrl: run.baseUrl,

    reportPath: path.relative(projectPath, reportPath).replace(/\\/g, '/'),

    resultsPath: path.relative(projectPath, run.resultsPath).replace(/\\/g, '/'),

    logTail: run.log?.slice(-1500) ?? '',

    next_action: [

      {

        type: 'tool_use',

        tool: 'get_test_report',

        message: 'Call get_test_report({ projectPath, format: "detailed" }) for classified failures.',

      },

      ...(run.failed > 0

        ? [

            {

              type: 'tool_use' as const,

              tool: 'auto_heal_test',

              message: 'For fragility failures, call auto_heal_test({ projectPath }).',

            },

          ]

        : []),

      ...(run.ok

        ? [{ type: 'tool_use', tool: 'deepsight_open_test_result_dashboard', message: 'Open dashboard.' }]

        : [{ type: 'instructions', message: 'See report markdown for failures.' }]),

    ],

  };

}


