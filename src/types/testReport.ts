import type { FailureCategory } from '../utils/failureClassifier.js';
import type { TestResultsArtifact } from '../utils/artifacts.js';

export type ClassifiedFailure = {
  testId: string;
  title: string;
  category: FailureCategory;
  confidence: 'high' | 'medium' | 'low';
  errorMessage?: string;
  suggestedAction: string;
  autoAction: string;
};

export type ClassifiedTestReport = {
  runId: string;
  format: string;
  generatedAt: string;
  summary: TestResultsArtifact['summary'];
  passed: TestResultsArtifact['results'];
  classifiedFailures: ClassifiedFailure[];
  markdownPath?: string;
};
