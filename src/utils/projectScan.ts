import fs from 'fs';
import path from 'path';

export type ScannedRoute = {
  path: string;
  file: string;
  description: string;
  auth_required: boolean;
};

export type ProjectKind =
  | 'react_spa'
  | 'vue'
  | 'svelte'
  | 'next'
  | 'static_html'
  | 'node_api'
  | 'dotnet'
  | 'go'
  | 'unknown';

export type ProjectScan = {
  kind: ProjectKind;
  tech_stack: Array<Record<string, string>>;
  routes: ScannedRoute[];
  router_files: string[];
};

const ROUTER_CANDIDATES = [
  'src/App.tsx',
  'src/app/App.tsx',
  'src/router.tsx',
  'src/routes.tsx',
  'src/main.tsx',
];

function readIfExists(root: string, rel: string): string | null {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

/** Parse React Router <Route path="..."> from source text. */
export function parseRoutesFromSource(content: string, fileRel: string): ScannedRoute[] {
  const routes: ScannedRoute[] = [];
  const re = /<Route\s+[^>]*path=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const routePath = m[1];
    const baseName =
      routePath === '*'
        ? 'NotFound'
        : routePath.replace(/^\//, '').replace(/[/:]/g, '_') || 'Index';
    routes.push({
      path: routePath,
      file: fileRel,
      description: `${baseName} route`,
      auth_required: false,
    });
  }
  return routes;
}

export function detectTechStack(projectPath: string): Array<Record<string, string>> {
  const stack: Array<Record<string, string>> = [];
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return stack;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  stack.push({ language: 'TypeScript' });
  if (deps.react || deps.next) stack.push({ framework: deps.next ? 'Next.js' : 'React' });
  if (deps.vue) stack.push({ framework: 'Vue' });
  if (deps.vite) stack.push({ build: 'Vite' });
  if (deps.tailwindcss) stack.push({ ui_library: 'Tailwind' });
  if (deps['react-router-dom']) stack.push({ routing: 'React Router' });
  if (deps['@playwright/test'] || deps.playwright) stack.push({ testing: 'Playwright' });
  if (deps.svelte || deps['@sveltejs/kit']) stack.push({ framework: 'Svelte' });
  if (deps['@angular/core']) stack.push({ framework: 'Angular' });

  return stack;
}

/** What kind of project this is — drives UI tests vs API-only guidance. */
export function detectProjectKind(projectPath: string): ProjectKind {
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) return 'go';
  try {
    if (fs.readdirSync(projectPath).some((f) => f.endsWith('.csproj'))) return 'dotnet';
  } catch {}
  if (!fs.existsSync(pkgPath)) {
    if (fs.existsSync(path.join(projectPath, 'index.html'))) return 'static_html';
    return 'unknown';
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return 'next';
  if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
  if (deps.vue) return 'vue';
  if (deps.express || deps.fastify || deps.koa) return 'node_api';
  if (deps.react || deps.vite) return 'react_spa';
  return 'unknown';
}

export function scanProject(projectPath: string): ProjectScan {
  const kind = detectProjectKind(projectPath);
  const routes: ScannedRoute[] = [];
  const router_files: string[] = [];

  for (const rel of ROUTER_CANDIDATES) {
    const content = readIfExists(projectPath, rel);
    if (!content) continue;
    const found = parseRoutesFromSource(content, rel);
    if (found.length > 0) {
      router_files.push(rel);
      for (const r of found) {
        if (!routes.some((x) => x.path === r.path)) routes.push(r);
      }
    }
  }

  // Fallback: page filenames (weaker)
  if (routes.length === 0) {
    const pagesDir = path.join(projectPath, 'src', 'pages');
    if (fs.existsSync(pagesDir)) {
      for (const f of fs.readdirSync(pagesDir)) {
        if (!/\.(tsx|jsx)$/.test(f)) continue;
        const name = f.replace(/\.(tsx|jsx)$/, '');
        const routePath =
          name.toLowerCase() === 'index' ? '/' : `/${name.toLowerCase()}`;
        routes.push({
          path: routePath,
          file: `src/pages/${f}`,
          description: `${name} page`,
          auth_required: false,
        });
      }
    }
  }

  return {
    kind,
    tech_stack: detectTechStack(projectPath),
    routes,
    router_files,
  };
}

/** Human label for dashboard. */
export function stackLabel(kind: ProjectKind): string {
  const map: Record<ProjectKind, string> = {
    react_spa: 'React / Vite (auto UI tests)',
    vue: 'Vue (auto UI tests)',
    svelte: 'Svelte (auto UI tests)',
    next: 'Next.js (auto UI tests)',
    static_html: 'Static HTML (Playwright UI)',
    node_api: 'Node API (HTTP tests)',
    dotnet: '.NET — use Backend + IDE prompt',
    go: 'Go — use Backend + IDE prompt',
    unknown: 'Unknown — IDE prompt recommended',
  };
  return map[kind] || kind;
}

export function scanToSummaryYaml(scan: ProjectScan, testType: string): string {
  const lines: string[] = [
    'version: "2"',
    `type: ${testType}`,
    'tech_stack:',
  ];
  for (const item of scan.tech_stack) {
    const [k, v] = Object.entries(item)[0];
    lines.push(`  - ${k}: ${v}`);
  }
  lines.push('routes:');
  for (const r of scan.routes) {
    lines.push(`  - path: ${r.path}`);
    lines.push(`    file: ${r.file}`);
    lines.push(`    auth_required: ${r.auth_required}`);
    lines.push(`    description: ${r.description}`);
  }
  if (scan.router_files.length) {
    lines.push('router_files:');
    for (const f of scan.router_files) lines.push(`  - ${f}`);
  }
  lines.push('features: []');
  lines.push('known_limitations: []');
  return lines.join('\n');
}
