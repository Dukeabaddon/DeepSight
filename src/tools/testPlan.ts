import fs from 'fs';
import path from 'path';
import { GenerateFrontendTestPlanInputSchema, GenerateBackendTestPlanInputSchema } from '../schemas.js';
import { readConfig, normalizeAbsolutePath } from '../utils/file.js';
import { PATHS } from '../paths.js';
import { isLLMConfigured, generateText } from '../llm.js';

/**
 * Generates frontend test plan JSON from PRD.
 */
export async function generateFrontendTestPlan(params: unknown) {
  const args = GenerateFrontendTestPlanInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const standardPRDPath = path.resolve(projectPath, PATHS.STANDARD_PRD);

  if (!fs.existsSync(standardPRDPath)) {
    return {
      next_action: [{
        type: "tool_use",
        tool: "deepsight_generate_standardized_prd",
        message: "PRD not found. Generate it first with deepsight_generate_standardized_prd."
      }]
    };
  }

  const standardPRD = JSON.parse(fs.readFileSync(standardPRDPath, 'utf-8'));

  // Option B: Use LLM
  if (isLLMConfigured()) {
    const systemPrompt = `You are a test plan generator. Generate a comprehensive test plan based on the PRD.`;
    const userPrompt = `Generate a frontend test plan JSON from this PRD:
${JSON.stringify(standardPRD, null, 2)}

Each test case must have: id (TC001, TC002...), title, description, category (functional/error handling/security), priority (High/Medium/Low), and steps array.`;
    const result = await generateText(systemPrompt, userPrompt);
    if (result) {
      const testPlanPath = path.resolve(projectPath, PATHS.FRONTEND_TEST_PLAN);
      // Try to parse the response as JSON, extract from code blocks if needed
      let testPlan = result;
      const jsonMatch = result.match(/\[\s*\{.*\}\s*\]/s);
      if (jsonMatch) testPlan = jsonMatch[0];
      fs.writeFileSync(testPlanPath, testPlan, 'utf-8');
      return {
        next_action: [{
          type: "tool_use",
          tool: "deepsight_generate_code_and_execute",
          context: { projectPath, testPlanFilePath: testPlanPath }
        }]
      };
    }
  }

  // Option A (default): Tell AI to write it
  return {
    next_action: [{
      type: "ai_instructions",
      message: `**Generate a frontend test plan.**

Read the PRD at \`${standardPRDPath}\`.

Create test cases based on these requirements and write them to:
\`${path.resolve(projectPath, PATHS.FRONTEND_TEST_PLAN)}\`

Each test case format:
{
  "id": "TC001",
  "title": "Descriptive test name",
  "description": "What this test verifies",
  "category": "functional | error_handling | security | boundary | edge_case | ui_ux",
  "priority": "High | Medium | Low",
  "steps": ["Step 1: ...", "Step 2: ..."]
}

Generate 8-20 test cases covering all requirements.

Once written, call \`deepsight_generate_code_and_execute\`.`
    }]
  };
}

/**
 * Generates backend test plan JSON from PRD.
 */
export async function generateBackendTestPlan(params: unknown) {
  const args = GenerateBackendTestPlanInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const standardPRDPath = path.resolve(projectPath, PATHS.STANDARD_PRD);

  if (!fs.existsSync(standardPRDPath)) {
    return {
      next_action: [{
        type: "tool_use",
        tool: "deepsight_generate_standardized_prd",
        message: "PRD not found."
      }]
    };
  }

  const standardPRD = JSON.parse(fs.readFileSync(standardPRDPath, 'utf-8'));

  // Option B
  if (isLLMConfigured()) {
    const systemPrompt = `You are a test plan generator. Generate a comprehensive backend API test plan.`;
    const userPrompt = `Generate a backend test plan JSON from this PRD:
${JSON.stringify(standardPRD, null, 2)}

Each test must include: id, title, description, method, endpoint, requestBody, expectedStatus, priority.`;
    const result = await generateText(systemPrompt, userPrompt);
    if (result) {
      const testPlanPath = path.resolve(projectPath, PATHS.BACKEND_TEST_PLAN);
      const jsonMatch = result.match(/\[\s*\{.*\}\s*\]/s);
      fs.writeFileSync(testPlanPath, jsonMatch ? jsonMatch[0] : result, 'utf-8');
      return {
        next_action: [{
          type: "tool_use",
          tool: "deepsight_generate_code_and_execute",
          context: { projectPath, testPlanFilePath: testPlanPath }
        }]
      };
    }
  }

  // Option A
  return {
    next_action: [{
      type: "ai_instructions",
      message: `**Generate a backend test plan.**

Read the PRD at \`${standardPRDPath}\`.

Write test plan to: \`${path.resolve(projectPath, PATHS.BACKEND_TEST_PLAN)}\`

Each test case:
{
  "id": "TC001",
  "title": "...",
  "description": "...",
  "method": "GET|POST|PUT|DELETE",
  "endpoint": "/api/...",
  "requestBody": {},
  "expectedStatus": 200,
  "priority": "High|Medium|Low"
}

Once written, call \`deepsight_generate_code_and_execute\`.`
    }]
  };
}