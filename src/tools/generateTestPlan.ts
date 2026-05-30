import fs from 'fs';
import path from 'path';
import { GenerateTestPlanInputSchema } from '../schemas.js';
import { PATHS } from '../paths.js';
import { ensureDirs, normalizeAbsolutePath } from '../utils/file.js';
import { loadPlanningContext } from '../lib/planningContext.js';
import type { GeneratedTestPlan, NormalizedPrd, TestPlanCase } from '../types/prd.js';

function loadPrd(projectPath: string, prdId?: string): NormalizedPrd | null {
  const candidates = [
    path.join(projectPath, '.deepsight', 'normalized-prd.json'),
    path.resolve(projectPath, PATHS.STANDARD_PRD),
  ];
  for (const fp of candidates) {
    if (!fs.existsSync(fp)) continue;
    try {
      const prd = JSON.parse(fs.readFileSync(fp, 'utf-8')) as NormalizedPrd;
      if (!prdId || prd.prdId === prdId) return prd;
    } catch {
      continue;
    }
  }
  return null;
}

function caseCap(coverageTarget: string): number {
  if (coverageTarget === 'happy-path') return 8;
  if (coverageTarget === 'comprehensive') return 40;
  return 20;
}

function buildTestCases(prd: NormalizedPrd, coverageTarget: string): TestPlanCase[] {
  const cases: TestPlanCase[] = [];
  const cap = caseCap(coverageTarget);
  let tc = 0;

  for (const req of prd.requirements) {
    if (cases.length >= cap) break;

    if (req.linkedRoutes.length > 0) {
      for (const route of req.linkedRoutes) {
        if (cases.length >= cap) break;
        tc += 1;
        cases.push({
          id: `TC${String(tc).padStart(3, '0')}`,
          title: `Visit ${route}`,
          description: req.description,
          category: 'functional',
          priority: req.priority,
          steps: [
            `Open ${route}`,
            'Wait for page load',
            'Verify expected content from analysis',
          ],
          linkedRequirementIds: [req.id],
          linkedRoutes: [route],
          linkedEntities: req.linkedEntities,
        });
      }
      continue;
    }

    if (req.linkedEntities.length > 0 && coverageTarget !== 'happy-path') {
      tc += 1;
      cases.push({
        id: `TC${String(tc).padStart(3, '0')}`,
        title: `Cover ${req.linkedEntities[0]}`,
        description: req.description,
        category: 'functional',
        priority: req.priority,
        steps: [
          `Exercise code path for ${req.linkedEntities.join(', ')}`,
          'Assert expected outcome',
        ],
        linkedRequirementIds: [req.id],
        linkedRoutes: req.linkedRoutes,
        linkedEntities: req.linkedEntities,
      });
      continue;
    }

    if (coverageTarget === 'comprehensive') {
      tc += 1;
      cases.push({
        id: `TC${String(tc).padStart(3, '0')}`,
        title: req.title,
        description: req.description,
        category: 'functional',
        priority: req.priority,
        steps: req.acceptanceCriteria.map((c, i) => `Step ${i + 1}: ${c}`),
        linkedRequirementIds: [req.id],
        linkedRoutes: req.linkedRoutes,
        linkedEntities: req.linkedEntities,
      });
    }
  }

  return cases;
}

/**
 * Spec tool `generate_test_plan` (doc 02) — plan from normalized PRD + analysis links.
 */
export async function generateTestPlan(params: unknown) {
  const args = GenerateTestPlanInputSchema.parse(params);
  const projectPath = normalizeAbsolutePath(args.projectPath);
  const ctx = await loadPlanningContext(projectPath);

  if ('error' in ctx) {
    return ctx;
  }

  const prd = loadPrd(projectPath, args.prdId);
  if (!prd) {
    return {
      error: 'NO_PRD',
      message: 'Normalized PRD not found. Call parse_prd first.',
      next_action: [
        {
          type: 'tool_use',
          tool: 'parse_prd',
          message: 'Run parse_prd({ projectPath }) after analyze_codebase.',
        },
      ],
    };
  }

  ensureDirs(projectPath);

  const testCases = buildTestCases(prd, args.coverageTarget);
  const plan: GeneratedTestPlan = {
    planId: `plan-${prd.prdId}`,
    prdId: prd.prdId,
    projectPath,
    coverageTarget: args.coverageTarget,
    testCases,
    createdAt: new Date().toISOString(),
  };

  const planPath =
    prd.testType === 'backend'
      ? path.resolve(projectPath, PATHS.BACKEND_TEST_PLAN)
      : path.resolve(projectPath, PATHS.FRONTEND_TEST_PLAN);

  fs.writeFileSync(planPath, JSON.stringify(testCases, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(projectPath, '.deepsight', 'test-plan.json'),
    JSON.stringify(plan, null, 2),
    'utf-8',
  );

  return {
    planId: plan.planId,
    prdId: prd.prdId,
    testPlanPath: planPath,
    testCaseCount: testCases.length,
    coverageTarget: args.coverageTarget,
    routesReferenced: [...new Set(testCases.flatMap((t) => t.linkedRoutes))],
    entitiesReferenced: [...new Set(testCases.flatMap((t) => t.linkedEntities))].slice(0, 20),
    analysisRunId: ctx.analysisRunId,
    next_action: [
      {
        type: 'tool_use',
        tool: 'deepsight_generate_code_and_execute',
        message: `Test plan written (${testCases.length} cases). Run tests when dev server is up.`,
      },
    ],
  };
}
