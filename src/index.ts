#!/usr/bin/env node

/**
 * DeepSight MCP Server
 * 
 * An open-source AI-powered testing MCP server.
 * Works in two modes:
 *   Option A (default): Returns instructions for the AI assistant to execute
 *   Option B: Uses a configured LLM (Gemini/OpenAI/Ollama) to auto-generate tests
 * 
 * Start: node dist/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { VERSION, PATHS, ABS_PATHS } from './paths.js';
import {
  InitializationInputSchema,
  AnalyzeCodebaseInputSchema,
  ParsePrdInputSchema,
  GenerateTestPlanInputSchema,
  GenerateTestCodeInputSchema,
  RunTestsInputSchema,
  GetTestReportInputSchema,
  AutoHealTestInputSchema,
  CodeAnalyzeInputSchema,
  GenerateStandardPRDInputSchema,
  GenerateFrontendTestPlanInputSchema,
  GenerateBackendTestPlanInputSchema,
  GenerateCodeAndExecuteInputSchema,
  TestModificationInputSchema,
} from './schemas.js';
import { toJSONSchema } from './utils/schema.js';
import { initialization } from './tools/bootstrap.js';
import { analyzeCodebase } from './tools/analyzeCodebase.js';
import { parsePrd } from './tools/parsePrd.js';
import { generateTestPlan } from './tools/generateTestPlan.js';
import { generateTestCode } from './tools/generateTestCode.js';
import { runTests } from './tools/runTests.js';
import { getTestReport } from './tools/getTestReport.js';
import { autoHealTest } from './tools/autoHealTest.js';
import { codeAnalyze } from './tools/codeSummary.js';
import { generateStandardPRD } from './tools/prd.js';
import { generateFrontendTestPlan, generateBackendTestPlan } from './tools/testPlan.js';
import { generateCodeAndExecute } from './tools/testExecute.js';
import { testModification, checkInfo } from './tools/dashboard.js';
import { getLifecycleStatus } from './tools/lifecycleTool.js';

// Create MCP server
const server = new Server(
  {
    name: 'deepsight-mcp',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ========================
// Tool Registration
// ========================
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'analyze_codebase',
        description:
          'Scan project structure (framework, routes, file inventory). Deep/exhaustive: import-graph + call-graph stub (doc 03). Stores in .deepsight/analysis.db or JSON fallback.',
        inputSchema: toJSONSchema(AnalyzeCodebaseInputSchema),
      },
      {
        name: 'parse_prd',
        description:
          'Normalize PRD from analyze_codebase routes + code_entities, optional PRD.md. Requires prior deep analyze_codebase.',
        inputSchema: toJSONSchema(ParsePrdInputSchema),
      },
      {
        name: 'generate_test_plan',
        description:
          'Generate prioritized test plan JSON from parse_prd output, linked to routes and entities from analysis.',
        inputSchema: toJSONSchema(GenerateTestPlanInputSchema),
      },
      {
        name: 'generate_test_code',
        description:
          'Generate Playwright .spec.ts from generate_test_plan. Writes tests/deepsight and deepsight_tests.',
        inputSchema: toJSONSchema(GenerateTestCodeInputSchema),
      },
      {
        name: 'run_tests',
        description:
          'Run Playwright tests locally (doc 05/18). dryRun:true = plan only. Real run needs dev server; baseUrl or DEEPSIGHT_BASE_URL or .deepsight/config.json localEndpoint.',
        inputSchema: toJSONSchema(RunTestsInputSchema),
      },
      {
        name: 'get_test_report',
        description:
          'Classified test report from last run_tests output (doc 05/12): bug, fragility, environment, etc.',
        inputSchema: toJSONSchema(GetTestReportInputSchema),
      },
      {
        name: 'auto_heal_test',
        description:
          'Propose/apply heals by failure category (fragility, timeout, assertion, environment, bug/gap hints). Uses get_test_report + spec patches.',
        inputSchema: toJSONSchema(AutoHealTestInputSchema),
      },
      {
        name: 'deepsight_bootstrap',
        description: `BEFORE calling this tool, check if .deepsight/config.json exists.
If config.json EXISTS, DO NOT call this tool — proceed directly with other tools instead.
This tool is ONLY for first-time project initialization.`,
        inputSchema: toJSONSchema(InitializationInputSchema),
      },
      {
        name: 'deepsight_generate_code_summary',
        description: 'Analyze the project repository and summarize the codebase into a structured YAML file.',
        inputSchema: toJSONSchema(CodeAnalyzeInputSchema),
      },
      {
        name: 'deepsight_generate_standardized_prd',
        description: 'Generate a structured PRD (Product Requirements Document) from the code summary.',
        inputSchema: toJSONSchema(GenerateStandardPRDInputSchema),
      },
      {
        name: 'deepsight_generate_frontend_test_plan',
        description: 'Generate a test plan for frontend testing based on the PRD.',
        inputSchema: toJSONSchema(GenerateFrontendTestPlanInputSchema),
      },
      {
        name: 'deepsight_generate_backend_test_plan',
        description: 'Generate a test plan for backend API testing based on the PRD.',
        inputSchema: toJSONSchema(GenerateBackendTestPlanInputSchema),
      },
      {
        name: 'deepsight_generate_code_and_execute',
        description: `Generate test code and execute it against the project.
Before calling: ensure the local project is running (e.g. npm run dev or npm run build && npm start).
If a test plan already exists and the project is running, call this directly.
Test cap: 15 tests in dev mode, 30 in production mode to prevent overload.`,
        inputSchema: toJSONSchema(GenerateCodeAndExecuteInputSchema),
      },
      {
        name: 'deepsight_open_test_result_dashboard',
        description: `Open an interactive web dashboard to review test results.
Displays all test cases with execution status, allows viewing test details,
editing test steps, and re-running tests.
Prerequisites: tests must have been generated via 'deepsight_generate_code_and_execute' first.`,
        inputSchema: toJSONSchema(TestModificationInputSchema),
      },
      {
        name: 'deepsight_check_info',
        description: `Check DeepSight version, mode, and LLM configuration status.`,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: 'deepsight_get_lifecycle_status',
        description: `Return current spec-driven lifecycle phase and which artifacts exist under deepsight_tests/.`,
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: { type: 'string', description: 'Absolute path to project root.' },
          },
          required: ['projectPath'],
        },
      },
    ],
  };
});

// ========================
// Tool Call Handler
// ========================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};

  try {
    let result: any;

    switch (toolName) {
      case 'analyze_codebase': {
        result = await analyzeCodebase(args);
        break;
      }
      case 'parse_prd': {
        result = await parsePrd(args);
        break;
      }
      case 'generate_test_plan': {
        result = await generateTestPlan(args);
        break;
      }
      case 'generate_test_code': {
        result = await generateTestCode(args);
        break;
      }
      case 'run_tests': {
        result = await runTests(args);
        break;
      }
      case 'get_test_report': {
        result = await getTestReport(args);
        break;
      }
      case 'auto_heal_test': {
        result = await autoHealTest(args);
        break;
      }
      case 'deepsight_bootstrap': {
        result = await initialization(args);
        break;
      }
      case 'deepsight_generate_code_summary': {
        result = await codeAnalyze(args);
        break;
      }
      case 'deepsight_generate_standardized_prd': {
        result = await generateStandardPRD(args);
        break;
      }
      case 'deepsight_generate_frontend_test_plan': {
        result = await generateFrontendTestPlan(args);
        break;
      }
      case 'deepsight_generate_backend_test_plan': {
        result = await generateBackendTestPlan(args);
        break;
      }
      case 'deepsight_generate_code_and_execute': {
        result = await generateCodeAndExecute(args as any);
        break;
      }
      case 'deepsight_open_test_result_dashboard': {
        result = await testModification(args);
        break;
      }
      case 'deepsight_check_info': {
        result = await checkInfo();
        break;
      }
      case 'deepsight_get_lifecycle_status': {
        result = await getLifecycleStatus(args as { projectPath: string });
        break;
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Validation error: ${error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        }],
      };
    }
    return {
      isError: true,
      content: [{ type: 'text', text: error.message || String(error) }],
    };
  }
});

// ========================
// Start Server
// ========================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[DeepSight MCP v${VERSION}] Server started via stdio`);
}

main().catch((error) => {
  console.error('[DeepSight] Fatal error:', error);
  process.exit(1);
});
