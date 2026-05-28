import path from 'path';
import fs from 'fs';
import { CodeAnalyzeInputSchema } from '../schemas.js';
import { readConfig } from '../utils/file.js';
import { PATHS } from '../paths.js';
import { isLLMConfigured, generateText } from '../llm.js';

/**
 * Generates structured YAML code summary for the target project.
 * Tells the AI to scan the project and produce a YAML code summary.
 * Option B: uses configured LLM to do this automatically.
 */
export async function codeAnalyze(params: unknown) {
  const args = CodeAnalyzeInputSchema.parse(params);
  const projectPath = path.resolve(args.projectRootPath);
  const config = await readConfig(projectPath);
  const type = config.type || 'frontend';
  const scope = config.scope || 'codebase';

  const codeSummaryPath = path.resolve(projectPath, PATHS.CODE_SUMMARY);

  // Option B: Use configured LLM if available
  if (isLLMConfigured()) {
    const systemPrompt = `You are a code analyzer for DeepSight testing framework. 
Analyze the project files and produce a structured YAML code summary.`;
    const userPrompt = `Scan the project at ${projectPath} and produce a code summary in YAML format.
Type: ${type}
Scope: ${scope}
Write the full YAML output.`;
    const result = await generateText(systemPrompt, userPrompt);
    if (result) {
      fs.writeFileSync(codeSummaryPath, result, 'utf-8');
      return {
        codeSummarySchema: result,
        next_action: [
          {
            type: "tool_use",
            tool: "deepsight_generate_standardized_prd",
            message: `Code summary generated at ${codeSummaryPath}. Proceed with PRD generation.`
          }
        ]
      };
    }
  }

  // Option A (default): Let the AI assistant do the work
  return {
    codeSummarySchema: null,
    next_action: [
      {
        type: "ai_instructions",
        message: `**Generate a code summary for the project.**

You must analyze the project at \`${projectPath}\` and create a structured YAML summary.

**Parse real routes from \`src/App.tsx\`** (or router file) — do not invent paths from filenames alone.

Write the YAML to: \`${codeSummaryPath}\`

Schema for ${type}:

${type === 'frontend' ? `
version: "2"
type: frontend
tech_stack:
  - language
  - framework
  - ui_library
  - other
routes:
  - path: /login
    file: src/pages/Login.tsx
    auth_required: false
    description: User login page
features:
  - name: User Login
    description: Login with email and password credentials
    files:
      - src/pages/Login.tsx
    user_interactions:
      - Fill email input field
      - Click Login button
    api_calls:
      - method: POST
        endpoint: /api/auth/login
    auth_required: false
known_limitations: []
` : `
version: "2"
type: backend
tech_stack:
  - language
  - framework
  - database
features:
  - name: Product Management API
    description: CRUD operations
    files: []
    endpoints:
      - method: GET
        path: /api/products
        description: List products
        auth_required: false
    depends_on: []
known_limitations: []
`}

**FIELD RULES:**
- version must be "2"
- type must be "${type}"
- features: each must include actual files detected in the codebase
- known_limitations: list any issues found (empty array if none)
- Use standard YAML syntax
- Do NOT wrap in code fences or add document markers

Once complete, call \`deepsight_generate_standardized_prd\`.`
      }
    ]
  };
}