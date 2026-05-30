import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS, ABS_PATHS } from '../paths.js';
import { readConfig } from './file.js';
import { writeRunArtifacts } from './artifacts.js';
import { writeLifecycleState } from './lifecycleState.js';
import { sanitizePlaywrightLog } from './logSanitize.js';

export type PlaywrightRunMode = 'headless' | 'headed' | 'debug';

export type PlaywrightRunOptions = {
  testPath?: string;
  baseUrl?: string;
  mode?: PlaywrightRunMode;
  skipServerCheck?: boolean;
};

const DEEPSIGHT_CONFIG_NAME = 'playwright.deepsight.config.mjs';

function readViteConfigPort(projectPath: string): number | null {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    const fp = path.join(projectPath, name);
    if (!fs.existsSync(fp)) continue;
    try {
      const src = fs.readFileSync(fp, 'utf-8');
      const m = src.match(/port\s*:\s*(\d{2,5})/);
      if (m?.[1]) return Number(m[1]);
    } catch {
      continue;
    }
  }
  return null;
}

function deepsightPlaywrightConfigPath(): string {
  return path.resolve(ABS_PATHS.CURRENT_DIR, 'assets', DEEPSIGHT_CONFIG_NAME);
}

function getPlaywrightConfigPath(projectPath: string, useTargetRunner: boolean): string {
  const source = deepsightPlaywrightConfigPath();
  if (!useTargetRunner) return source;
  const target = path.join(projectPath, '.deepsight', DEEPSIGHT_CONFIG_NAME);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

function deepsightPlaywrightCli(): string {
  return path.join(ABS_PATHS.CURRENT_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function detectDevPort(projectPath: string): number {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 3000;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return 3000;
    if (deps.vite || deps['@vitejs/plugin-react']) {
      const fromVite = readViteConfigPort(projectPath);
      if (fromVite) return fromVite;
      return 5173;
    }
    const dev = String(pkg.scripts?.dev ?? '');
    const portMatch = dev.match(/(?:^|\s)(?:-p|--port)\s+(\d+)/) ?? dev.match(/:(\d{4,5})/);
    if (portMatch?.[1]) return Number(portMatch[1]);
    if (pkg.scripts?.start?.includes('-p ')) {
      const m = pkg.scripts.start.match(/-p\s+(\d+)/);
      if (m?.[1]) return Number(m[1]);
    }
  } catch {
    /* default */
  }
  return 3000;
}

export function resolveBaseUrlSync(projectPath: string, override?: string): string {
  if (override) return normalizeBaseUrl(override);
  if (process.env.DEEPSIGHT_BASE_URL) {
    return normalizeBaseUrl(process.env.DEEPSIGHT_BASE_URL);
  }
  const configPath = path.join(projectPath, '.deepsight', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        localEndpoint?: string;
        serverPort?: number;
      };
      if (config.localEndpoint) return normalizeBaseUrl(config.localEndpoint);
      if (config.serverPort) return `http://localhost:${config.serverPort}`;
    } catch {
      /* fall through */
    }
  }
  return `http://localhost:${detectDevPort(projectPath)}`;
}

export async function resolveBaseUrl(
  projectPath: string,
  override?: string,
): Promise<string> {
  if (override || process.env.DEEPSIGHT_BASE_URL) {
    return resolveBaseUrlSync(projectPath, override);
  }
  const config = await readConfig(projectPath);
  if (config.localEndpoint) return normalizeBaseUrl(config.localEndpoint);
  const port = config.serverPort ?? detectDevPort(projectPath);
  return `http://localhost:${port}`;
}

export async function isServerReachable(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function targetHasPlaywrightTest(projectPath: string): boolean {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return !!(
      pkg.devDependencies?.['@playwright/test'] || pkg.dependencies?.['@playwright/test']
    );
  } catch {
    return false;
  }
}

function playwrightCliFlags(mode: PlaywrightRunMode): string {
  if (mode === 'headed') return '--headed';
  if (mode === 'debug') return '--debug';
  return '';
}

/**
 * Run Playwright against generated specs using DeepSight's bundled @playwright/test.
 */
export function runPlaywrightTests(
  projectPath: string,
  options: PlaywrightRunOptions = {},
): {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  log: string;
  baseUrl: string;
  resultsPath: string;
} {
  const relDir = options.testPath ?? PATHS.TEST_CODE_DIR;
  const testDir = path.resolve(projectPath, relDir);
  const specs = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'))
    : [];

  if (specs.length === 0) {
    const emptyLog = `No .spec.ts files in ${relDir}. Call generate_test_code first.`;
    return {
      ok: false,
      passed: 0,
      failed: 0,
      total: 0,
      log: emptyLog,
      baseUrl: '',
      resultsPath: path.resolve(projectPath, PATHS.TEST_RESULTS),
    };
  }

  const baseUrl = resolveBaseUrlSync(projectPath, options.baseUrl);
  const mode = options.mode ?? 'headless';

  writeLifecycleState(projectPath, { phase: 'run' });
  const useTargetRunner = targetHasPlaywrightTest(projectPath);
  const configPath = getPlaywrightConfigPath(projectPath, useTargetRunner);
  const cliPath = deepsightPlaywrightCli();
  const jsonReportPath = path.resolve(projectPath, 'deepsight_tests', 'tmp', 'playwright-raw.json');
  fs.mkdirSync(path.dirname(jsonReportPath), { recursive: true });

  const pkgRoot = ABS_PATHS.CURRENT_DIR;
  const flags = playwrightCliFlags(mode);
  const cmd = useTargetRunner
    ? `npx playwright test --config "${configPath}" ${flags}`.trim()
    : `node "${cliPath}" test --config "${configPath}" ${flags}`.trim();
  const runCwd = useTargetRunner ? projectPath : pkgRoot;

  const env = {
    ...process.env,
    DEEPSIGHT_PROJECT_ROOT: projectPath,
    DEEPSIGHT_TEST_DIR: relDir.replace(/\\/g, '/'),
    DEEPSIGHT_BASE_URL: baseUrl,
  };

  try {
    const out = execSync(cmd, {
      cwd: runCwd,
      timeout: 300000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const log = out + (fs.existsSync(jsonReportPath) ? '' : '');
    const { resultsPath, artifact } = writeRunArtifacts(projectPath, log, true, jsonReportPath);
    writeLifecycleState(projectPath, { phase: 'review' });
    return {
      ok: true,
      passed: artifact.summary.passed,
      failed: artifact.summary.failed,
      total: artifact.summary.totalRun,
      log: sanitizePlaywrightLog(log),
      baseUrl,
      resultsPath,
    };
  } catch (e: any) {
    const log = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    const { resultsPath, artifact } = writeRunArtifacts(projectPath, log, false, jsonReportPath);
    writeLifecycleState(projectPath, { phase: 'review' });
    return {
      ok: false,
      passed: artifact.summary.passed,
      failed: Math.max(artifact.summary.failed, 1),
      total: Math.max(artifact.summary.totalRun, 1),
      log: sanitizePlaywrightLog(log),
      baseUrl,
      resultsPath,
    };
  }
}
