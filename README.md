# DeepSight 🕵️

**Let your code test itself.**

DeepSight is an open-source, AI-powered testing MCP server that integrates with your IDE (Cursor, VS Code, Windsurf, Claude Code) to automatically analyze, generate, and execute tests for your project.

No cloud dependency. No paywalls. No API keys required (Option A).

**Setup:** `npm install && npm run build` — then `npm start` (MCP) or `npm run web` (dashboard).

## Repository contents

| Path | Purpose |
|------|---------|
| `src/` | MCP server (TypeScript → `dist/`) |
| `assets/` | Web dashboard + test editor UI |
| `start-web.mjs` | Launch dashboard (`npm run web`) |

FlowState/RepoFlux pipeline helpers (GateMCP, graphify) live in the main app under `lib/deepsight-integrations/`, not in this package.

## Supported stacks (automatic detection)

| Stack | Detection | UI tests (Playwright) |
|-------|-----------|------------------------|
| React / Vite / Next | `package.json` | Yes — routes from `App.tsx` |
| Vue / Svelte / Angular | `package.json` | Yes — route scan + smoke tests |
| Static HTML | `index.html` | Yes |
| Node API (Express, etc.) | `package.json` | HTTP smoke (`backend` type) |
| Go / .NET | `go.mod` / `.csproj` | Use **Backend** + IDE prompt (no auto UI) |

Pick **Frontend**, **Backend**, or **Both**, set **local port**, click **Run DeepSight**. Optional: **IDE prompt** tab to improve tests in Cursor.

## How It Works

DeepSight works in two modes:

### Option A: AI-Assisted (default, no setup needed)

Your IDE's AI assistant handles everything directly — no extra API keys, no cloud calls.

```
You: "Test this project with DeepSight"

Your IDE AI:
1. Scans your codebase
2. Writes a structured code summary
3. Generates test plans
4. Writes Playwright test files
5. Runs them against your local server
```

### Option B: LLM-Powered (configure once)

Set environment variables and DeepSight auto-generates tests using the LLM of your choice.

| Provider | Env Var | Example |
|----------|---------|---------|
| **Gemini** | `DEEPSIGHT_LLM_PROVIDER=gemini` + `DEEPSIGHT_LLM_API_KEY=...` | `gemini-2.0-flash` |
| **OpenAI** | `DEEPSIGHT_LLM_PROVIDER=openai` + `DEEPSIGHT_LLM_API_KEY=...` | `gpt-4o` |
| **Ollama** | `DEEPSIGHT_LLM_PROVIDER=ollama` + `DEEPSIGHT_LLM_BASE_URL=http://localhost:11434` | `llama3.2` |

## Quick Start

### 1. Install

```bash
npm install -g @deepsight/deepsight-mcp
```

Or use directly:

```bash
npx @deepsight/deepsight-mcp
```

### 2. Add to Your IDE

**Cursor / VS Code** — add to your MCP config:

```json
{
  "mcpServers": {
    "DeepSight": {
      "command": "npx",
      "args": ["@deepsight/deepsight-mcp"]
    }
  }
}
```

### 3. Test Your Project

Open your project in the IDE and tell the AI:

> "Help me test this project with DeepSight"

DeepSight will automatically walk through the workflow:

1. **Bootstrap** — Sets up project structure
2. **Code Summary** — Analyzes your codebase (YAML)
3. **PRD** — Creates a product requirements document
4. **Test Plan** — Generates frontend + backend test cases
5. **Code + Execute** — Writes Playwright tests and runs them
6. **Dashboard** — Opens an interactive test results viewer

## Tools

| Tool | Description |
|------|-------------|
| `deepsight_bootstrap` | Initialize project for testing |
| `deepsight_generate_code_summary` | Scan codebase and create structured YAML summary |
| `deepsight_generate_standardized_prd` | Generate a PRD from code analysis |
| `deepsight_generate_frontend_test_plan` | Create frontend test plan |
| `deepsight_generate_backend_test_plan` | Create backend API test plan |
| `deepsight_generate_code_and_execute` | Generate Playwright tests and execute them |
| `deepsight_open_test_result_dashboard` | Open interactive test review dashboard |
| `deepsight_check_info` | Check DeepSight version and configuration |

## Project Structure

When you initialize DeepSight on a project, it creates:

```
your-project/
├── deepsight_tests/
│   ├── standard_prd.json
│   ├── deepsight_frontend_test_plan.json
│   ├── deepsight_backend_test_plan.json
│   ├── deepsight-test-report.md
│   ├── deepsight-test-report.html
│   ├── TC001_*.spec.ts
│   └── tmp/
│       ├── code_summary.yaml
│       ├── test_results.json
│       └── raw_report.md
└── .deepsight/
    └── config.json
```

## What DeepSight Tests

- **Functional Testing** — Core business logic and user workflows
- **Error Handling** — Exception handling and error recovery
- **Security** — Vulnerability scanning and security validation
- **Authorization** — User permissions and access control
- **Boundary Testing** — Input validation and data limits
- **Edge Cases** — Unusual scenarios and corner cases
- **UI/UX** — User interface interactions and flows

**Supported:** React, Vue, Angular, Svelte, Next.js, Node.js, Express, FastAPI, REST APIs, and more.

## License

MIT — free to use, modify, and distribute.

