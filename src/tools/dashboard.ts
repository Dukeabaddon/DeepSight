import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { TestModificationInputSchema } from '../schemas.js';
import { normalizeAbsolutePath, readConfig } from '../utils/file.js';
import { PATHS, ABS_PATHS, VERSION } from '../paths.js';
import {
  apiBootstrap,
  apiCodeSummary,
  apiPrd,
  apiTestPlan,
  apiPrepareEnrich,
  apiEnrichPrompt,
  apiRunTests,
  apiReport,
  apiRunPipeline,
  apiWorkflowResult,
  apiIterate,
  apiFixNowPrompt,
} from './dashboardApi.js';
import { readLifecycleState } from '../utils/lifecycleState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server: http.Server | null = null;
let actualPort: number | null = null;

// Store workflow results
const workflowStore = new Map<string, any>();

/**
 * Start the DeepSight web server (init dashboard + modification UI).
 */
export async function startWebServer(projectPath?: string): Promise<string> {
  if (server && actualPort) {
    return `http://localhost:${actualPort}/init?project_path=${encodeURIComponent(projectPath || '')}`;
  }

  return new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    // --- Static assets ---
    const assetsDir = ABS_PATHS.CURRENT_DIR;
    const initHtml = path.resolve(assetsDir, 'assets', 'init-dashboard.html');

    // --- Init Dashboard (main page) ---
    app.get('/init', (_req, res) => {
      if (fs.existsSync(initHtml)) {
        res.sendFile(initHtml);
      } else {
        res.status(500).send('Dashboard not found');
      }
    });

    // Redirect root to /init
    app.get('/', (_req, res) => {
      const params = new URL('http://localhost' + (_req.url || '')).searchParams;
      const pp = params.get('project_path') || '';
      res.redirect('/init?project_path=' + encodeURIComponent(pp));
    });

    // --- Modification UI (Monaco editor) ---
    const modificationDir = ABS_PATHS.MODIFICATION_DIR;
    if (fs.existsSync(modificationDir)) {
      app.use('/modification', express.static(modificationDir));
    }

    // ==========================================
    // API: Bootstrap
    // ==========================================
    app.post('/api/bootstrap', async (req, res) => {
      try {
        if (!req.body?.projectPath) return res.status(400).json({ error: 'Missing projectPath' });
        res.json(await apiBootstrap(req.body));
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    const apiWrap =
      (fn: (body: any) => Promise<any>) => async (req: express.Request, res: express.Response) => {
        try {
          if (!req.body?.projectPath && !req.query?.projectPath) {
            return res.status(400).json({ error: 'Missing projectPath' });
          }
          const out = await fn(req.body?.projectPath ? req.body : { ...req.body, projectPath: req.query.projectPath });
          if (out.status === 'error') return res.status(400).json(out);
          res.json(out);
        } catch (e: any) {
          res.status(500).json({ error: e.message });
        }
      };

    app.post('/api/code-summary', apiWrap(apiCodeSummary));
    app.post('/api/prd', apiWrap(apiPrd));
    app.post('/api/test-plan', apiWrap(apiTestPlan));
    app.post('/api/prepare-enrich', apiWrap(apiPrepareEnrich));
    app.post('/api/generate-tests', apiWrap(apiPrepareEnrich));
    app.post('/api/run-pipeline', apiWrap(apiRunPipeline));
    app.post('/api/run-tests', apiWrap(apiRunTests));
    app.post('/api/report', apiWrap(apiReport));
    app.post('/api/iterate', apiWrap(apiIterate));
    app.post('/api/fix-now', apiWrap(apiFixNowPrompt));

    app.get('/api/lifecycle', async (req, res) => {
      try {
        const pp = req.query.projectPath as string;
        if (!pp) return res.status(400).json({ error: 'Missing projectPath' });
        res.json({ state: readLifecycleState(pp) });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/enrich-prompt', async (req, res) => {
      try {
        const pp = req.query.projectPath as string;
        if (!pp) return res.status(400).json({ error: 'Missing projectPath' });
        res.json(await apiEnrichPrompt({ projectPath: pp }));
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/workflow-result', async (req, res) => {
      try {
        const pp = req.query.projectPath as string;
        const tab = (req.query.tab as string) || 'report';
        if (!pp) return res.status(400).json({ error: 'Missing projectPath' });
        res.json(await apiWorkflowResult({ projectPath: pp, tab }));
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/full-report', (req, res) => {
      try {
        const pp = req.query.projectPath as string;
        if (!pp) return res.status(400).send('Missing projectPath');
        const htmlPath = path.resolve(normalizeAbsolutePath(pp), PATHS.TEST_REPORT_HTML);
        if (!fs.existsSync(htmlPath)) {
          return res.status(404).send('No HTML report yet — run DeepSight first.');
        }
        res.sendFile(htmlPath);
      } catch (e: any) {
        res.status(500).send(e.message);
      }
    });

    // ==========================================
    // API: Check if server is running
    // ==========================================
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', version: VERSION, serverPort: actualPort });
    });

    // --- Try ports ---
    const tryPort = (port: number) => {
      server = app.listen(port, () => {
        actualPort = port;
        console.error(`[DeepSight] Web dashboard running at http://localhost:${port}/init`);
        resolve(`http://localhost:${port}/init?project_path=${encodeURIComponent(projectPath || '')}`);
      });
      server.on('error', () => {
        if (port < 9100) tryPort(port + 1);
        else resolve('http://localhost:9080/init');
      });
    };
    tryPort(9080);
  });
}

// ==========================================
// Export: testModification tool handler
// ==========================================
export async function testModification(params: unknown) {
  const args = TestModificationInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const config = await readConfig(projectPath);

  const url = await startWebServer(projectPath);
  try {
    const open = (await import('open')).default;
    await open(url);
  } catch {}

  return {
    next_action: [{
      type: 'instructions',
      message: `✅ Dashboard opened at: ${url}

You can configure and run tests from the web UI.

**Project:** ${projectPath}
**Report:** ${path.resolve(projectPath, PATHS.TEST_REPORT_HTML)}`
    }]
  };
}

// ==========================================
// Export: Check info
// ==========================================
export async function checkInfo() {
  const apiKey = process.env.DEEPSIGHT_LLM_API_KEY;
  const llmProvider = process.env.DEEPSIGHT_LLM_PROVIDER;
  return {
    version: VERSION,
    mode: {
      optionA: 'AI Assistant (default) — your IDE\'s AI generates tests',
      optionB: llmProvider ? `LLM (${llmProvider}) — configured` : 'LLM — not configured'
    },
    llmConfigured: !!apiKey,
    llmProvider: llmProvider || null,
  };
}

