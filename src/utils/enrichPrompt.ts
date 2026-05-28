import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import type { ProjectScan } from './projectScan.js';

export function buildIdeEnrichPrompt(
  projectPath: string,
  scan: ProjectScan,
  opts: {
    localEndpoint: string;
    testType: string;
    projectName?: string;
  }
): string {
  const base = opts.localEndpoint.replace(/\/$/, '');
  const planPath = path.resolve(
    projectPath,
    opts.testType === 'backend' ? PATHS.BACKEND_TEST_PLAN : PATHS.FRONTEND_TEST_PLAN
  );
  const summaryPath = path.resolve(projectPath, PATHS.CODE_SUMMARY);
  const prdPath = path.resolve(projectPath, PATHS.STANDARD_PRD);
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);

  const routesBlock = scan.routes
    .map((r) => `- \`${r.path}\` (${r.file})`)
    .join('\n');

  return `# DeepSight — IDE test enrichment (required)

You are enriching **scaffolded** DeepSight tests for **${opts.projectName || path.basename(projectPath)}**.

## Rules
1. Read the real app router and components — do not guess routes from filenames alone.
2. Base URL: **${base}** (use this for every \`page.goto\`).
3. Replace generic scaffold tests with **real Playwright** specs in \`${testDir}\`.
4. Delete any stub files that only contain \`toHaveURL(/.*/)\` and comments.
5. Use selectors from actual UI (roles, labels, \`data-testid\` if present).
6. After writing tests, run:
   \`\`\`bash
   cd "${projectPath}"
   npx playwright test deepsight_tests --reporter=list
   \`\`\`
7. Write results to \`${path.resolve(projectPath, PATHS.TEST_REPORT)}\` from real output (pass/fail per test).
8. Create sentinel file \`${path.resolve(projectPath, PATHS.ENRICHED_MARKER)}\` when done.

## Routes detected (verify in router source)
${routesBlock || '(none — parse src/App.tsx manually)'}

## Artifacts to read
- Test plan: \`${planPath}\`
- Code summary: \`${summaryPath}\`
- PRD: \`${prdPath}\`
${scan.router_files.length ? `- Router: \`${scan.router_files.map((f) => path.join(projectPath, f)).join('`, `')}\`` : ''}

## What to write
For each test case in the plan:
- Meaningful \`test('TC00x — ...')\` with steps from the plan
- Navigate to the **correct path** (not always \`/\`)
- Assert visible UI, interactions, and error states where applicable
- Group related cases in describe blocks per feature/route

## FlowState note
This project uses DeepSight inside RepoFlux/FlowState. Tests must reflect the **actual** app under \`${projectPath}\`, not a generic template.
`;
}

export function writeEnrichPromptFile(
  projectPath: string,
  scan: ProjectScan,
  opts: { localEndpoint: string; testType: string }
): string {
  const prompt = buildIdeEnrichPrompt(projectPath, scan, opts);
  const outPath = path.resolve(projectPath, PATHS.ENRICH_PROMPT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, prompt, 'utf-8');
  return outPath;
}

/** Remove auto-generated stub specs from scaffold phase. */
export function removeScaffoldStubSpecs(projectPath: string): number {
  const testDir = path.resolve(projectPath, PATHS.TEST_CODE_DIR);
  if (!fs.existsSync(testDir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(testDir)) {
    if (!/^TC\d{3}_.*\.spec\.ts$/.test(f)) continue;
    const fp = path.join(testDir, f);
    const body = fs.readFileSync(fp, 'utf-8');
    if (body.includes('toHaveURL(/.*/)') && body.split('\n').filter((l) => !l.trim().startsWith('//')).length < 12) {
      fs.unlinkSync(fp);
      removed++;
    }
  }
  return removed;
}

export function isEnrichmentComplete(projectPath: string): boolean {
  return fs.existsSync(path.resolve(projectPath, PATHS.ENRICHED_MARKER));
}
