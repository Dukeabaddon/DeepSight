import fs from 'fs';

import path from 'path';

import { PATHS } from '../paths.js';

import type { ClassifiedFailure } from '../types/testReport.js';

import { classifiedFailureFromResult, type FailureCategory } from './failureClassifier.js';

import type { TestResultsArtifact } from './artifacts.js';

import { CI_TEST_SUBDIR } from './playwrightGen.js';



export type HealProposal = {

  testId: string;

  title: string;

  category: string;

  specFile?: string;

  beforeSnippet?: string;

  afterSnippet: string;

  recommendedSelector: string;

  strategy:

    | 'aria-role-name'

    | 'text-fuzzy'

    | 'data-testid'

    | 'timeout-bump'

    | 'wait-network'

    | 'expect-soften'

    | 'environment-hint'

    | 'bug-hint'

    | 'gap-hint';

  confidence: number;

  applied: boolean;

};



/** Categories that receive an automated or commented patch (doc 11–12). */

export const HEALABLE_CATEGORIES: FailureCategory[] = [

  'fragility',

  'timeout',

  'assertion-error',

  'environment',

  'bug',

  'missing-implementation',

];



function loadClassifiedFailures(projectPath: string): ClassifiedFailure[] {

  const fp = path.join(projectPath, '.deepsight', 'classified-report.json');

  if (fs.existsSync(fp)) {

    try {

      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as {

        classifiedFailures?: ClassifiedFailure[];

      };

      if (Array.isArray(data.classifiedFailures)) return data.classifiedFailures;

    } catch {

      /* fall through */

    }

  }

  const resultsFp = path.resolve(projectPath, PATHS.TEST_RESULTS);

  if (!fs.existsSync(resultsFp)) return [];

  const artifact = JSON.parse(fs.readFileSync(resultsFp, 'utf-8')) as TestResultsArtifact;

  return artifact.results

    .filter((r) => r.status === 'failed')

    .map((r) => classifiedFailureFromResult(r));

}



function inferSelectorFromError(errorMessage: string, title: string): {

  recommended: string;

  strategy: HealProposal['strategy'];

} {

  const haystack = `${errorMessage} ${title}`;

  const testIdMatch = haystack.match(/data-testid[= "']+([\w-]+)/i);

  if (testIdMatch) {

    return {

      recommended: `page.getByTestId('${testIdMatch[1]}')`,

      strategy: 'data-testid',

    };

  }

  const roleMatch = haystack.match(/getByRole\(['"](\w+)['"]/i);

  const nameMatch = haystack.match(/name:\s*['"]([^'"]+)['"]/i);

  if (roleMatch) {

    const name = nameMatch ? `, { name: '${nameMatch[1]}' }` : '';

    return {

      recommended: `page.getByRole('${roleMatch[1]}'${name})`,

      strategy: 'aria-role-name',

    };

  }

  const quoted = haystack.match(/["']([A-Za-z][^"']{2,40})["']/);

  const label = quoted?.[1] ?? 'main';

  return {

    recommended: `page.getByRole('main').or(page.getByRole('button', { name: /${label.slice(0, 20)}/i }))`,

    strategy: 'text-fuzzy',

  };

}



function buildProposalForFailure(f: ClassifiedFailure): Omit<HealProposal, 'specFile' | 'applied'> {

  const cat = f.category as FailureCategory;



  if (cat === 'fragility') {

    const { recommended, strategy } = inferSelectorFromError(f.errorMessage ?? '', f.title);

    return {

      testId: f.testId,

      title: f.title,

      category: f.category,

      beforeSnippet: 'page.locator("body")',

      afterSnippet: `await ${recommended}.click();`,

      recommendedSelector: recommended,

      strategy,

      confidence: strategy === 'data-testid' ? 0.9 : 0.78,

    };

  }



  if (cat === 'timeout') {

    return {

      testId: f.testId,

      title: f.title,

      category: f.category,

      afterSnippet: `test.setTimeout(90_000);\n    await page.waitForLoadState('networkidle');`,

      recommendedSelector: 'page.waitForLoadState(networkidle)',

      strategy: 'timeout-bump',

      confidence: 0.7,

    };

  }



  if (cat === 'assertion-error') {

    return {

      testId: f.testId,

      title: f.title,

      category: f.category,

      afterSnippet: `// Review expectation vs PRD: ${(f.errorMessage ?? '').slice(0, 120)}`,

      recommendedSelector: 'expect.soft(page.getByRole("main"))',

      strategy: 'expect-soften',

      confidence: 0.55,

    };

  }



  if (cat === 'environment') {

    return {

      testId: f.testId,

      title: f.title,

      category: f.category,

      afterSnippet: `// Ensure dev server + DEEPSIGHT_BASE_URL match generate_test_code BASE`,

      recommendedSelector: 'process.env.DEEPSIGHT_BASE_URL',

      strategy: 'environment-hint',

      confidence: 0.85,

    };

  }



  if (cat === 'missing-implementation') {

    return {

      testId: f.testId,

      title: f.title,

      category: f.category,

      afterSnippet: `// PRD gap: implement route/feature then re-run parse_prd + generate_test_plan`,

      recommendedSelector: 'n/a',

      strategy: 'gap-hint',

      confidence: 0.8,

    };

  }



  return {

    testId: f.testId,

    title: f.title,

    category: f.category,

    afterSnippet: `// Likely app bug — fix source, not selector: ${(f.errorMessage ?? '').slice(0, 100)}`,

    recommendedSelector: 'n/a',

    strategy: 'bug-hint',

    confidence: 0.5,

  };

}



function findSpecFiles(projectPath: string, testPath?: string): string[] {

  const dirs = testPath

    ? [path.resolve(projectPath, testPath)]

    : [

        path.resolve(projectPath, CI_TEST_SUBDIR),

        path.resolve(projectPath, PATHS.TEST_CODE_DIR),

      ];

  const files: string[] = [];

  for (const dir of dirs) {

    if (!fs.existsSync(dir)) continue;

    for (const f of fs.readdirSync(dir)) {

      if (f.endsWith('.spec.ts')) files.push(path.join(dir, f));

    }

  }

  return files;

}



function applyProposalToSpec(

  specFile: string,

  testId: string,

  proposal: Omit<HealProposal, 'specFile' | 'applied'>,

): boolean {

  let content = fs.readFileSync(specFile, 'utf-8');

  if (!content.includes(testId)) return false;

  const marker = `// DeepSight auto-heal ${testId}`;

  if (content.includes(marker)) return false;



  let insert = '';

  const cat = proposal.category;



  if (cat === 'fragility') {

    insert = `

    ${marker}

    // Suggested: ${proposal.afterSnippet}

    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });

`;

  } else if (cat === 'timeout') {

    insert = `

    ${marker}

    test.setTimeout(90_000);

    await page.waitForLoadState('domcontentloaded');

`;

  } else {

    insert = `

    ${marker}

    ${proposal.afterSnippet}

`;

  }



  const testRe = new RegExp(`(test\\('${testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^']*'[^{]*\\{)`);

  if (!testRe.test(content)) return false;

  content = content.replace(testRe, `$1${insert}`);

  fs.writeFileSync(specFile, content, 'utf-8');

  return true;

}



export function buildHealProposals(

  projectPath: string,

  options: {

    testId?: string;

    failureLog?: string;

    testPath?: string;

    applyPatches?: boolean;

    categories?: FailureCategory[];

  },

): HealProposal[] {

  const allowed = new Set(options.categories ?? HEALABLE_CATEGORIES);

  let failures = loadClassifiedFailures(projectPath).filter((f) =>

    allowed.has(f.category as FailureCategory),

  );



  if (failures.length === 0 && options.failureLog) {

    const single = classifiedFailureFromResult({

      testId: options.testId ?? 'TC001',

      title: 'Manual failure',

      errorMessage: options.failureLog,

    });

    if (allowed.has(single.category)) failures = [single];

  }



  if (options.testId) {

    failures = failures.filter((f) => f.testId === options.testId);

  }



  const specs = findSpecFiles(projectPath, options.testPath);

  const proposals: HealProposal[] = [];



  for (const f of failures) {

    const base = buildProposalForFailure(f);

    let specFile: string | undefined;

    let applied = false;



    for (const fp of specs) {

      const body = fs.readFileSync(fp, 'utf-8');

      if (!body.includes(f.testId)) continue;

      specFile = path.relative(projectPath, fp).replace(/\\/g, '/');

      if (options.applyPatches) {
        applied = applyProposalToSpec(fp, f.testId, base);
      }

      break;

    }



    proposals.push({ ...base, specFile, applied });

  }



  return proposals;

}



export function writeHealArtifacts(projectPath: string, proposals: HealProposal[]): string {

  const fp = path.join(projectPath, '.deepsight', 'heal-proposals.json');

  fs.mkdirSync(path.dirname(fp), { recursive: true });

  fs.writeFileSync(

    fp,

    JSON.stringify({ generatedAt: new Date().toISOString(), proposals }, null, 2),

    'utf-8',

  );

  return fp;

}


