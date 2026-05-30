import type { RepairPromptArtifact, TestResultsArtifact } from './artifacts.js';

const LOCATOR_PATTERNS = [
  /locator/i,
  /selector/i,
  /waiting for/i,
  /getByRole/i,
  /getByText/i,
  /timeout.*exceeded/i,
];

export function enrichRepairWithSelectorHints(
  artifact: TestResultsArtifact,
  repair: RepairPromptArtifact
): RepairPromptArtifact {
  const failures = repair.failures.map((f) => {
    const match = artifact.results.find((r) => r.testId === f.testId);
    const err = match?.errorMessage || f.failureDescription;
    const isLocator = LOCATOR_PATTERNS.some((p) => p.test(err));

    if (!isLocator) return f;

    return {
      ...f,
      diagnosticFixSuggestion:
        `${f.diagnosticFixSuggestion} For locator drift: prefer getByRole/getByLabel with accessible names; avoid brittle CSS-only selectors. Re-run after UI change (auto-heal scoring is on the roadmap).`,
    };
  });

  return { ...repair, failures };
}
