import path from 'path';
import fs from 'fs';
import { GenerateStandardPRDInputSchema } from '../schemas.js';
import { readConfig, readYAMLWithAutoEncoding } from '../utils/file.js';
import { PATHS } from '../paths.js';
import { isLLMConfigured, generateText } from '../llm.js';

/**
 * Builds standardized PRD JSON from code summary.
 * Creates a structured PRD from the code summary.
 * Option B: Uses configured LLM.
 */
export async function generateStandardPRD(params: unknown) {
  const args = GenerateStandardPRDInputSchema.parse(params);
  const projectPath = path.resolve(args.projectPath);
  const prdFiles = args.prdFiles || [];
  const codeSummaryPath = path.resolve(projectPath, PATHS.CODE_SUMMARY);

  // Check if code summary exists
  if (!fs.existsSync(codeSummaryPath)) {
    return {
      next_action: [{
        type: "tool_use",
        tool: "deepsight_generate_code_summary",
        message: "Code summary not found. Generate it first with deepsight_generate_code_summary."
      }]
    };
  }

  const codeSummary = readYAMLWithAutoEncoding(codeSummaryPath);
  const config = await readConfig(projectPath);
  const testType = config.type || 'frontend';

  // Option B: Use LLM
  if (isLLMConfigured()) {
    const systemPrompt = `You are a product requirements document generator for DeepSight testing framework.
Generate a structured PRD based on the code summary provided.`;
    const userPrompt = `Generate a structured PRD JSON for a ${testType} project.
Code summary: ${JSON.stringify(codeSummary, null, 2)}
Output the PRD as a JSON object with requirements array.`;
    const result = await generateText(systemPrompt, userPrompt);
    if (result) {
      const prdPath = path.resolve(projectPath, PATHS.STANDARD_PRD);
      fs.writeFileSync(prdPath, result, 'utf-8');
      return {
        next_action: [{
          type: "tool_use",
          tool: `deepsight_generate_${testType}_test_plan`,
          message: `PRD generated at ${prdPath}. Proceed with test plan generation.`
        }]
      };
    }
  }

  // Option A (default): Tell AI to write it
  return {
    next_action: [{
      type: "ai_instructions",
      message: `**Generate a standardized PRD.**

Read the code summary from \`${codeSummaryPath}\`.

The code summary reveals these features:
${JSON.stringify(codeSummary, null, 2)}

Your PRD files are at: ${projectPath}/${PATHS.RAW_PRD_DIR}

Write the structured PRD JSON to: \`${path.resolve(projectPath, PATHS.STANDARD_PRD)}\`

Format:
{
  "projectName": "...",
  "testType": "${testType}",
  "requirements": [
    {
      "id": "REQ-001",
      "title": "...",
      "description": "...",
      "priority": "High|Medium|Low",
      "acceptanceCriteria": [...]
    }
  ]
}

Once written, call \`deepsight_generate_${testType}_test_plan\`.`
    }]
  };
}