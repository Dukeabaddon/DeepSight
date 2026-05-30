/**
 * Failure classification stub (doc 12) — pattern-based signals.
 */

export type FailureCategory =
  | 'bug'
  | 'fragility'
  | 'environment'
  | 'missing-implementation'
  | 'assertion-error'
  | 'timeout'
  | 'flaky';

const ERROR_PATTERNS: Array<{ pattern: RegExp; category: FailureCategory }> = [
  { pattern: /locator resolved to 0 elements/i, category: 'fragility' },
  { pattern: /strict mode violation/i, category: 'fragility' },
  { pattern: /element is not visible/i, category: 'fragility' },
  { pattern: /element is not enabled/i, category: 'fragility' },
  { pattern: /detached from dom/i, category: 'fragility' },
  { pattern: /net::err_connection_refused/i, category: 'environment' },
  { pattern: /econnrefused/i, category: 'environment' },
  { pattern: /browser has been closed/i, category: 'environment' },
  { pattern: /timeout/i, category: 'timeout' },
  { pattern: /exceeded timeout/i, category: 'timeout' },
  { pattern: /cannot read propert/i, category: 'bug' },
  { pattern: /typeerror/i, category: 'bug' },
  { pattern: /referenceerror/i, category: 'bug' },
  { pattern: /internal server error/i, category: 'bug' },
  { pattern: /expect\(received\)/i, category: 'assertion-error' },
  { pattern: /to be visible/i, category: 'fragility' },
  { pattern: /404/i, category: 'missing-implementation' },
];

const ACTION_MAP: Record<FailureCategory, { suggested: string; auto: string }> = {
  bug: {
    suggested: 'Fix application code; re-run after patch.',
    auto: 'suggest-fix',
  },
  fragility: {
    suggested: 'Update selector or wait strategy in Playwright spec.',
    auto: 'auto-heal-selector',
  },
  environment: {
    suggested: 'Start dev server / check base URL and network.',
    auto: 'retry',
  },
  'missing-implementation': {
    suggested: 'Implement route or feature from PRD.',
    auto: 'flag-gap',
  },
  'assertion-error': {
    suggested: 'Align test expectation with PRD or fix test data.',
    auto: 'suggest-test-update',
  },
  timeout: {
    suggested: 'Increase timeout or optimize slow path.',
    auto: 'suggest-timeout',
  },
  flaky: {
    suggested: 'Stabilize test (waits, isolation); re-run.',
    auto: 'retry-and-flag',
  },
};

export function classifyFailure(
  errorMessage?: string,
  title?: string,
): { category: FailureCategory; confidence: 'high' | 'medium' | 'low' } {
  const haystack = `${errorMessage ?? ''} ${title ?? ''}`;
  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(haystack)) {
      return { category, confidence: 'high' };
    }
  }
  if (errorMessage?.includes('500') || haystack.includes('status')) {
    return { category: 'bug', confidence: 'medium' };
  }
  return { category: 'bug', confidence: 'low' };
}

export function classifiedFailureFromResult(result: {
  testId: string;
  title: string;
  errorMessage?: string;
}): {
  testId: string;
  title: string;
  category: FailureCategory;
  confidence: 'high' | 'medium' | 'low';
  errorMessage?: string;
  suggestedAction: string;
  autoAction: string;
} {
  const { category, confidence } = classifyFailure(result.errorMessage, result.title);
  const actions = ACTION_MAP[category];
  return {
    testId: result.testId,
    title: result.title,
    category,
    confidence,
    errorMessage: result.errorMessage,
    suggestedAction: actions.suggested,
    autoAction: actions.auto,
  };
}
