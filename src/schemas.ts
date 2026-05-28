import { z } from 'zod';

export const TestType = z.enum(['frontend', 'backend']);
export type TestType = z.infer<typeof TestType>;

export const TargetScope = z.enum(['codebase', 'diff']);
export type TargetScope = z.infer<typeof TargetScope>;

export const ExecutionType = z.enum(['console', 'tool']);

export const Priority = z.enum(['High', 'Medium', 'Low']);

export const ProjectPath = z.string().describe('Absolute path to the project root directory');

// ========================
// Bootstrap
// ========================
export const InitializationInputSchema = z.object({
  localPort: z.number().min(1).max(65535).default(5173)
    .describe('The port of the local dev server. Detected from the project (e.g., Next.js = 3000, Vite = 5173).'),
  pathname: z.string().optional().describe('Optional webpage path (without domain).'),
  type: TestType,
  projectPath: ProjectPath,
  testScope: TargetScope,
});

// ========================
// Code Summary
// ========================
export const CodeAnalyzeInputSchema = z.object({
  projectRootPath: ProjectPath,
});

export const FrontendCodeSummarySchema = `
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
      - src/hooks/useAuth.ts
    entry_route: /login
    user_interactions:
      - Fill email input field
      - Fill password input field
      - Click Login button to submit
      - See error message on invalid credentials
    api_calls:
      - method: POST
        endpoint: /api/auth/login
    auth_required: false
known_limitations:
  - issue: Admin CRUD is UI-only, not connected to backend API
    location: src/pages/AdminPage.tsx
    impact: Create/update/delete only modify local state, not persisted
`;

export const BackendCodeSummarySchema = `
version: "2"
type: backend
tech_stack:
  - language
  - framework
  - database
  - other
features:
  - name: Product Management API
    description: CRUD operations for product resources
    files:
      - src/routes/products.ts
      - src/models/product.ts
    endpoints:
      - method: GET
        path: /api/products
        description: List all products
        auth_required: false
        response_schema:
          "200": Product[]
      - method: POST
        path: /api/products
        description: Create a new product
        auth_required: true
        request_schema:
          body:
            name: string
            price: number
        response_schema:
          "200": Product
          "400": Validation error
    depends_on:
      - Authentication
known_limitations:
  - issue: No input validation on product creation
    location: src/routes/products.ts
    impact: Invalid data accepted without error
`;

// ========================
// PRD
// ========================
export const GenerateStandardPRDInputSchema = z.object({
  projectPath: ProjectPath,
  prdFiles: z.array(z.string()).optional().describe('Paths to PRD document files (optional)'),
});

// ========================
// Test Plan
// ========================
export const GenerateFrontendTestPlanInputSchema = z.object({
  projectPath: ProjectPath,
});

export const GenerateBackendTestPlanInputSchema = z.object({
  projectPath: ProjectPath,
});

// ========================
// Test Case
// ========================
export const TestCase = z.object({
  id: z.string().describe('The unique identifier for the test case'),
  title: z.string().describe('The title of the test case'),
  description: z.string(),
  category: z.string().describe('Test category (functional, error handling, security)'),
  priority: Priority,
  steps: z.array(z.string()),
});

export const TestCaseWithCode = TestCase.extend({
  test_code_file_path: z.string().describe('Absolute path to the generated test code file'),
});

export const TestPlanItem = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  steps: z.array(z.string()),
  priority: Priority,
});

// ========================
// Code Generation & Execution
// ========================
export const GenerateCodeAndExecuteInputSchema = z.object({
  projectName: z.string().describe('Name of the project (root directory name)'),
  projectPath: ProjectPath,
  testIds: z.array(z.string()).default([])
    .describe('Specific test IDs to run. Empty = run all.'),
  additionalInstruction: z.string().default('')
    .describe('Additional instructions for test generation'),
  serverMode: z.enum(['production', 'development']).default('development')
    .describe('Whether the project runs in production or dev mode. Affects test count limits.'),
});

// ========================
// Dashboard
// ========================
export const TestModificationInputSchema = z.object({
  projectPath: ProjectPath,
  context: z.string().optional().describe('Context about test results to review'),
});

// ========================
// Config
// ========================
export const DeepSightConfigSchema = z.object({
  status: z.enum(['init', 'committed']).default('init'),
  type: TestType.optional(),
  serverMode: z.enum(['production', 'development']).default('development').optional(),
  serverPort: z.number().optional(),
  localEndpoint: z.string().optional(),
  loginUser: z.string().optional(),
  loginPassword: z.string().optional(),
  backendAuthType: z.string().optional(),
  backendCredential: z.string().optional(),
  backendUsername: z.string().optional(),
  backendPassword: z.string().optional(),
  backendApiKey: z.string().optional(),
  backendApiValue: z.string().optional(),
  scope: TargetScope.optional(),
  proxy: z.string().optional(),
  executionArgs: z.any().optional(),
});

export type DeepSightConfig = z.infer<typeof DeepSightConfigSchema>;

// ========================
// LLM Options (Option B)
// ========================
export const LLMProviderSchema = z.enum(['gemini', 'openai', 'ollama']);

// ========================
// Output Schema
// ========================
export const NextActionOutputSchema = z.object({
  next_action: z.any(),
});