export type RequirementPriority = 'High' | 'Medium' | 'Low';

export type NormalizedRequirement = {
  id: string;
  title: string;
  description: string;
  priority: RequirementPriority;
  acceptanceCriteria: string[];
  linkedRoutes: string[];
  linkedEntities: string[];
  source: 'route' | 'function' | 'markdown' | 'inferred';
};

export type NormalizedPrd = {
  prdId: string;
  projectName: string;
  testType: 'frontend' | 'backend';
  analysisRunId: string;
  createdAt: string;
  requirements: NormalizedRequirement[];
};

export type TestPlanCase = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: RequirementPriority;
  steps: string[];
  linkedRequirementIds: string[];
  linkedRoutes: string[];
  linkedEntities: string[];
};

export type GeneratedTestPlan = {
  planId: string;
  prdId: string;
  projectPath: string;
  coverageTarget: string;
  testCases: TestPlanCase[];
  createdAt: string;
};
