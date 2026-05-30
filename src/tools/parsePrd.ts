import fs from 'fs';
import path from 'path';
import { ParsePrdInputSchema } from '../schemas.js';
import { PATHS } from '../paths.js';
import { ensureDirs, normalizeAbsolutePath } from '../utils/file.js';
import { loadPlanningContext, type PlanningContext } from '../lib/planningContext.js';
import type { NormalizedPrd, NormalizedRequirement, RequirementPriority } from '../types/prd.js';

function parseMarkdownRequirements(content: string): NormalizedRequirement[] {
  const reqs: NormalizedRequirement[] = [];
  const sections = content.split(/^##\s+/m).filter(Boolean);
  let n = 0;
  for (const block of sections) {
    const lines = block.trim().split('\n');
    const title = lines[0]?.trim();
    if (!title) continue;
    n += 1;
    const body = lines.slice(1).join('\n').trim();
    const bullets = body
      .split('\n')
      .filter((l) => /^\s*[-*]/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim());
    reqs.push({
      id: `REQ-MD-${String(n).padStart(3, '0')}`,
      title,
      description: body.slice(0, 500) || title,
      priority: 'Medium',
      acceptanceCriteria: bullets.length ? bullets : [`${title} is satisfied`],
      linkedRoutes: [],
      linkedEntities: [],
      source: 'markdown',
    });
  }
  return reqs;
}

function requirementsFromContext(ctx: PlanningContext): NormalizedRequirement[] {
  const reqs: NormalizedRequirement[] = [];
  let i = 0;

  for (const route of ctx.routes) {
    i += 1;
    reqs.push({
      id: `REQ-R-${String(i).padStart(3, '0')}`,
      title: `Route ${route.path}`,
      description: route.description || `User can access ${route.path}`,
      priority: route.path === '/' ? 'High' : 'Medium',
      acceptanceCriteria: [
        `Navigate to ${route.path}`,
        'Page loads without error',
        'Primary UI is visible',
      ],
      linkedRoutes: [route.path],
      linkedEntities: [],
      source: 'route',
    });
  }

  const named = ctx.entities.filter((e) => e.name && e.name.length > 1);
  const cap = Math.min(named.length, 25);
  for (let j = 0; j < cap; j++) {
    const ent = named[j]!;
    i += 1;
    reqs.push({
      id: `REQ-F-${String(i).padStart(3, '0')}`,
      title: `Function ${ent.name}`,
      description: `Behavior of ${ent.name} in ${ent.file_path}`,
      priority: 'Low' as RequirementPriority,
      acceptanceCriteria: [`Invoke or cover ${ent.name} via UI/API`],
      linkedRoutes: [],
      linkedEntities: [ent.name!],
      source: 'function',
    });
  }

  return reqs;
}

/**
 * Spec tool `parse_prd` (doc 02 / 09) — normalized PRD from analysis + optional markdown.
 */
export async function parsePrd(params: unknown) {
  const args = ParsePrdInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const ctx = await loadPlanningContext(projectPath);

  if ('error' in ctx) {
    return ctx;
  }

  ensureDirs(projectPath);

  let requirements = requirementsFromContext(ctx);

  if (args.prdContent) {
    requirements = [...parseMarkdownRequirements(args.prdContent), ...requirements];
  }

  for (const prdFile of args.prdPath ? [args.prdPath] : []) {
    const fp = path.isAbsolute(prdFile) ? prdFile : path.join(projectPath, prdFile);
    if (fs.existsSync(fp)) {
      const text = fs.readFileSync(fp, 'utf-8');
      requirements = [...parseMarkdownRequirements(text), ...requirements];
    }
  }

  const defaultPrd = path.join(projectPath, 'PRD.md');
  if (!args.prdPath && !args.prdContent && fs.existsSync(defaultPrd)) {
    requirements = [...parseMarkdownRequirements(fs.readFileSync(defaultPrd, 'utf-8')), ...requirements];
  }

  const testType =
    ctx.kind === 'node_api' ? 'backend' : ('frontend' as const);

  const prd: NormalizedPrd = {
    prdId: `prd-${ctx.analysisRunId.slice(0, 8)}`,
    projectName: ctx.projectName,
    testType,
    analysisRunId: ctx.analysisRunId,
    createdAt: new Date().toISOString(),
    requirements: dedupeRequirements(requirements),
  };

  const outPath = path.resolve(projectPath, PATHS.STANDARD_PRD);
  const dotPrd = path.join(projectPath, '.deepsight', 'normalized-prd.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(prd, null, 2), 'utf-8');
  fs.writeFileSync(dotPrd, JSON.stringify(prd, null, 2), 'utf-8');

  return {
    prdId: prd.prdId,
    prdPath: outPath,
    requirementCount: prd.requirements.length,
    routesUsed: ctx.routes.length,
    entitiesUsed: ctx.entities.length,
    testType,
    next_action: [
      {
        type: 'tool_use',
        tool: 'generate_test_plan',
        message: `PRD ${prd.prdId} saved (${prd.requirements.length} requirements). Call generate_test_plan next.`,
      },
    ],
  };
}

function dedupeRequirements(reqs: NormalizedRequirement[]): NormalizedRequirement[] {
  const seen = new Set<string>();
  const out: NormalizedRequirement[] = [];
  for (const r of reqs) {
    const key = `${r.source}:${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
