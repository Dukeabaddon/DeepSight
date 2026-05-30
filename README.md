<p align="center">
  <strong>DeepSight</strong><br/>
  Local-first MCP server for code-aware test planning, Playwright generation, execution, and repair.
</p>

<p align="center">
  <a href="https://github.com/Dukeabaddon/DeepSight/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node >= 18"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-stdio-purple.svg" alt="MCP stdio"></a>
  <img src="https://img.shields.io/badge/status-0.1.0--alpha-orange.svg" alt="Alpha MVP">
</p>

---

DeepSight scans your JavaScript/TypeScript app, builds a test plan, generates Playwright specs, runs them against your **local dev server**, and produces HTML + repair briefs for your IDE. No cloud upload of your codebase.

**Repository:** [github.com/Dukeabaddon/DeepSight](https://github.com/Dukeabaddon/DeepSight)

---

## Features (v0.1 alpha)

| Capability | Status |
|------------|--------|
| MCP tools (analyze → plan → codegen → run → report → heal) | Shipped |
| Tree-sitter code analysis + import graph | Shipped |
| Web dashboard (`npm run web`) | Shipped |
| HTML test report with per-case errors | Shipped |
| Playwright local execution | Shipped |
| Optional LLM auto-generation | Optional env keys |
| API/backend test generation | Roadmap |
| Screenshot / video artifacts | Roadmap |
| CI GitHub Action export | Roadmap |

---

## Tech stack

- **Runtime:** Node.js 18+, TypeScript (ESM)
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) (stdio)
- **Testing:** Playwright (`@playwright/test`)
- **Analysis:** tree-sitter (JS/TS), route inventory, SQLite or JSON store
- **Dashboard:** Express 5 + static UI (`assets/init-dashboard.html`)
- **Validation:** Zod schemas for all MCP tool inputs

---

## Requirements

- Node.js **18+**
- Chromium for Playwright: `npx playwright install chromium` (once per machine)
- Your app running locally (e.g. `npm run dev`) when executing tests

---

## Install

```bash
git clone https://github.com/Dukeabaddon/DeepSight.git
cd DeepSight
npm install
npm run build
npx playwright install chromium
```

Verify the pipeline:

```bash
npm run test:analyze
```

---

## Quick start — Web dashboard

Best for first-time use on a real project (Vite, Next.js, etc.).

```bash
# Terminal 1 — your app
cd /path/to/your-app && npm run dev

# Terminal 2 — DeepSight
cd DeepSight
export DEEPSIGHT_PROJECT_PATH=/path/to/your-app   # PowerShell: $env:DEEPSIGHT_PROJECT_PATH = "..."
npm run web
```

Open the printed URL (default `http://localhost:9080/init?project_path=...`).

1. Choose **Frontend**, **Backend**, or **Both**
2. Set **App port** (e.g. `8080` for Vite, `3000` for Next.js)
3. Click **Run DeepSight**
4. Open **Full report (HTML)** for pass/fail details
5. Use **Fix this now** to copy a repair brief into Cursor

---

## Quick start — MCP (Cursor / Claude Code)

Add to `.cursor/mcp.json` (adjust the absolute path):

```json
{
  "mcpServers": {
    "deepsight": {
      "command": "node",
      "args": ["/absolute/path/to/DeepSight/dist/index.js"],
      "env": {
        "DEEPSIGHT_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

Restart the IDE, then ask: *“Run DeepSight analyze_codebase on this project.”*

### Core MCP tools

| Tool | Purpose |
|------|---------|
| `analyze_codebase` | Scan routes, entities, import graph |
| `parse_prd` | Normalize requirements from code + optional PRD.md |
| `generate_test_plan` | Priority-tagged test cases |
| `generate_test_code` | Playwright specs → `tests/deepsight/` + `deepsight_tests/` |
| `run_tests` | Headless Playwright against live app |
| `get_test_report` | JSON + markdown + HTML summary |
| `auto_heal_test` | Selector / timeout heal proposals |
| `deepsight_open_test_result_dashboard` | Launch web UI |

Legacy aliases (`deepsight_*`) remain for compatibility.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `DEEPSIGHT_PROJECT_PATH` | Target app root (dashboard / verify scripts) |
| `DEEPSIGHT_BASE_URL` | App URL, e.g. `http://localhost:8080` |
| `DEEPSIGHT_LLM_API_KEY` | Optional — enable LLM auto-generation |
| `DEEPSIGHT_LLM_PROVIDER` | `openai` \| `gemini` \| `ollama` |
| `DEEPSIGHT_LLM_MODEL` | Model id for provider |

Copy [`.env.example`](.env.example) to `.env.local` — **never commit secrets**.

Port resolution order: `DEEPSIGHT_BASE_URL` → `.deepsight/config.json` → Vite/Next heuristics from `package.json`.

---

## Output in your project

DeepSight writes under the **project under test** (not inside the DeepSight repo):

```
your-app/
├── .deepsight/           # config, analysis.db, playwright config copy
├── deepsight_tests/      # generated specs, reports, tmp results
└── tests/deepsight/      # CI-friendly spec copies
```

Add to your app `.gitignore`:

```
deepsight_tests/
.deepsight/
tests/deepsight/
```

---

## Development

```bash
npm run build              # compile TypeScript → dist/
npm run test:analyze       # pipeline QA on bundled sample
npm run test:live:e2e      # full E2E (set DEEPSIGHT_PROJECT_PATH + DEEPSIGHT_BASE_URL)
npm run security:check     # scan for accidental secrets
```

Live E2E example:

```powershell
$env:DEEPSIGHT_PROJECT_PATH = "C:\path\to\your-app"
$env:DEEPSIGHT_BASE_URL = "http://localhost:8080"
npm run test:live:e2e
```

---

## Security

- Runs locally; no DeepSight-hosted code upload.
- Optional LLM keys stay in **your** environment.
- Run `npm run security:check` before commit or release.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## Publish to npm (maintainers)

```bash
npm run build
npm publish --access public
```

Package name: `@deepsight/deepsight-mcp` (ships `dist/` + `assets/`).

---

## Roadmap

- Richer API/backend tests (Express/Fastify/Nest)
- Trace / screenshot / video in HTML report
- CI workflow generator
- Stronger auto-heal (DOM re-rank)

Track issues on [GitHub](https://github.com/Dukeabaddon/DeepSight/issues).

---

## License

[MIT](LICENSE) © [Dukeabaddon](https://github.com/Dukeabaddon)

---

<p align="center">
  <sub>DeepSight is independent open source — not affiliated with any parent monorepo that may vendor this folder for local development.</sub>
</p>
