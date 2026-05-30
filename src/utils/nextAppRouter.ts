import fs from 'fs';
import path from 'path';
import type { ScannedRoute } from './projectScan.js';

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;
const ROUTE_FILE = /^route\.(tsx|ts|jsx|js)$/;

const APP_DIR_CANDIDATES = ['app', 'src/app'];

/** Route groups `(marketing)` and parallel slots `@modal` do not appear in the URL. */
export function appSegmentToUrlPart(segment: string): string | null {
  if (segment.startsWith('@')) return null;
  if (segment.startsWith('(') && segment.endsWith(')')) return null;
  return segment;
}

/** Map a directory path under `app/` to a URL path. */
export function dirnameToNextRoute(dirRel: string): string {
  const normalized = dirRel.replace(/\\/g, '/').replace(/^\.\/?/, '');
  if (!normalized) return '/';
  const parts = normalized
    .split('/')
    .filter(Boolean)
    .map(appSegmentToUrlPart)
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return '/';
  return `/${parts.join('/')}`;
}

function routeLabel(routePath: string, fileRel: string, kind: 'page' | 'api'): string {
  const base = routePath === '/' ? 'Home' : routePath.replace(/^\//, '').split('/').pop() ?? 'Page';
  const dynamic = routePath.includes('[') ? ' (dynamic)' : '';
  return kind === 'api' ? `API ${base}` : `${base} page${dynamic} — ${fileRel}`;
}

export type NextAppScan = {
  routes: ScannedRoute[];
  router_files: string[];
};

function scanAppDirectory(
  appAbs: string,
  appRel: string,
  routes: ScannedRoute[],
  kind: 'page' | 'api',
): void {
  const filePattern = kind === 'page' ? PAGE_FILE : ROUTE_FILE;

  function walk(dirAbs: string, relUnderApp: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      const childRelUnderApp = relUnderApp ? `${relUnderApp}/${ent.name}` : ent.name;

      if (ent.isDirectory()) {
        walk(childAbs, childRelUnderApp);
        continue;
      }
      if (!ent.isFile() || !filePattern.test(ent.name)) continue;

      const routePath = dirnameToNextRoute(relUnderApp);
      const fileRel = `${appRel}/${childRelUnderApp}`.replace(/\\/g, '/');

      if (routes.some((r) => r.path === routePath && r.file === fileRel)) continue;

      routes.push({
        path: routePath,
        file: fileRel,
        description: routeLabel(routePath, fileRel, kind),
        auth_required: false,
      });
    }
  }

  walk(appAbs, '');
}

/**
 * Discover App Router pages (`page.tsx`) and optional Route Handlers (`route.ts`).
 */
export function discoverNextAppRoutes(
  projectPath: string,
  options: { includeApiRoutes?: boolean } = {},
): NextAppScan {
  const includeApiRoutes = options.includeApiRoutes ?? true;
  const routes: ScannedRoute[] = [];
  const router_files: string[] = [];

  for (const appRel of APP_DIR_CANDIDATES) {
    const appAbs = path.join(projectPath, appRel);
    if (!fs.existsSync(appAbs) || !fs.statSync(appAbs).isDirectory()) continue;

    router_files.push(appRel);
    scanAppDirectory(appAbs, appRel, routes, 'page');
    if (includeApiRoutes) {
      scanAppDirectory(appAbs, appRel, routes, 'api');
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return { routes, router_files };
}
