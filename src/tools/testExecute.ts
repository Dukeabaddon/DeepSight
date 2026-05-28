import fs from 'fs';
import path from 'path';
import { GenerateCodeAndExecuteInputSchema } from '../schemas.js';
import { readConfig, normalizeAbsolutePath } from '../utils/file.js';
import { PATHS } from '../paths.js';
import { isLLMConfigured, generateText } from '../llm.js';
import { scanProject } from '../utils/projectScan.js';
import {
  prepareEnrichment,
  runPlaywrightTests,
  writeReportFromRun,
  isEnrichmentComplete,
} from '../utils/scaffoldPipeline.js';

function hasRunnableSpecs(projectPath: string): boolean {
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
  if (!fs.existsSync(testDir)) return false;
  return fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.spec.ts'))
    .some((f) => {
      const body = fs.readFileSync(path.join(testDir, f), 'utf-8');
      return !(body.includes('toHaveURL(/.*/)') && body.length < 400);
    });
}

/**
 * Phase 1: scaffold plan exists → return IDE enrichment prompt.
 * Phase 2: enriched specs → run Playwright + real report.
 */
export async function generateCodeAndExecute(args: {
  projectName: string;
  projectPath: string;
  testIds: string[];
  additionalInstruction: string;
  serverMode: string;
}) {
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const config = await readConfig(projectPath);
  const type = config.type === 'backend' ? 'backend' : 'frontend';
  const testPlanFile = type === 'backend' ? PATHS.BACKEND_TEST_PLAN : PATHS.FRONTEND_TEST_PLAN;
  const testPlanPath = path.resolve(projectPath, testPlanFile);

  if (!fs.existsSync(testPlanPath)) {
    return {
      next_action: [{
        type: 'tool_use',
        tool: `deepsight_generate_${type}_test_plan`,
        message: `No test plan found. Generate one first with deepsight_generate_${type}_test_plan.`,
      }],
    };
  }

  const scan = scanProject(projectPath);
  const endpoint = config.localEndpoint || 'http://localhost:5173/';

  // Not enriched yet → prepare prompt (no fake stub specs)
  if (!isEnrichmentComplete(projectPath) && !hasRunnableSpecs(projectPath)) {
    const { promptPath, removedStubs } = prepareEnrichment(projectPath, scan, {
      localEndpoint: endpoint,
      type,
    });

    const prompt =
      fs.readFileSync(promptPath, 'utf-8') +
      (args.additionalInstruction ? `\n\n## Extra\n${args.additionalInstruction}` : '');

    if (isLLMConfigured()) {
      return {
        next_action: [{
          type: 'llm.generate',
          input: {
            prompt: `Follow DeepSight enrichment instructions and write Playwright tests.\n\n${prompt}`,
          },
        }],
      };
    }

    return {
      next_action: [{
        type: 'ai_instructions',
        message: `**DeepSight — write real tests (IDE step required)**

Scaffold is ready. Stub specs were removed (${removedStubs}).

**Copy this prompt into your AI IDE** (or read \`${promptPath}\`):

---
${prompt}
---

After tests are written, create: \`${path.resolve(projectPath, PATHS.ENRICHED_MARKER)}\`

Then call \`deepsight_generate_code_and_execute\` again to run Playwright.`,
      }],
    };
  }

  // Option B LLM one-shot generation (optional)
  if (isLLMConfigured() && !hasRunnableSpecs(projectPath)) {
    const testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf-8'));
    const filteredTests =
      args.testIds.length > 0
        ? testPlan.filter((t: any) => args.testIds.includes(t.id))
        : testPlan;
    const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
    fs.mkdirSync(testDir, { recursive: true });

    for (const test of filteredTests) {
      const systemPrompt = `Generate Playwright TypeScript tests. Base URL: ${endpoint}. Output code only.`;
      const userPrompt = `Test: ${JSON.stringify(test, null, 2)}`;
      const testCode = await generateText(systemPrompt, userPrompt);
      if (testCode) {
        const testFileName = `${test.id}_${test.title.replace(/[^a-zA-Z0-9]/g, '_')}.spec.ts`;
        fs.writeFileSync(path.join(testDir, testFileName), testCode, 'utf-8');
      }
    }
    fs.writeFileSync(path.resolve(projectPath, PATHS.ENRICHED_MARKER), new Date().toISOString(), 'utf-8');
  }

  const run = runPlaywrightTests(projectPath);
  const reportPath = writeReportFromRun(projectPath, run);

  return {
    next_action: [{
      type: 'instructions',
      message: `**Playwright run finished**

- Report: \`${reportPath}\`
- Status: ${run.ok ? 'all passed or completed' : 'failures — see report'}
- Output tail in report markdown

${run.log ? `\`\`\`\n${run.log.slice(-1500)}\n\`\`\`` : ''}`,
    }],
  };
}
