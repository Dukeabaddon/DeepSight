import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import type { ProjectScan } from './projectScan.js';

export type FeatureMapNode = {
  id: string;
  title: string;
  path?: string;
  useCases: Array<{
    id: string;
    title: string;
    acceptanceCriteria: string[];
    priority: string;
  }>;
};

export type FeatureMap = {
  projectName: string;
  generatedAt: string;
  testType: string;
  features: FeatureMapNode[];
};

export function buildFeatureMap(
  projectPath: string,
  scan: ProjectScan,
  testType: string
): FeatureMap {
  const prdPath = path.resolve(projectPath, PATHS.STANDARD_PRD);
  let requirements: Array<{
    id: string;
    title: string;
    acceptanceCriteria?: string[];
    priority?: string;
  }> = [];

  if (fs.existsSync(prdPath)) {
    try {
      const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
      requirements = prd.requirements || [];
    } catch {
      /* fall through to scan-only */
    }
  }

  const features: FeatureMapNode[] = [];

  if (requirements.length > 0) {
    for (const req of requirements) {
      features.push({
        id: req.id,
        title: req.title,
        useCases: [
          {
            id: `${req.id}-UC1`,
            title: req.title,
            acceptanceCriteria: req.acceptanceCriteria || [],
            priority: req.priority || 'Medium',
          },
        ],
      });
    }
  } else {
    const routes = scan.routes.length
      ? scan.routes
      : [{ path: '/', description: 'Home', auth_required: false, file: '' }];
    for (const r of routes) {
      features.push({
        id: `F-${r.path.replace(/[^a-zA-Z0-9]+/g, '_') || 'root'}`,
        title: r.description || r.path,
        path: r.path,
        useCases: [
          {
            id: `UC-${r.path}`,
            title: `Verify ${r.path}`,
            acceptanceCriteria: [
              `Route ${r.path} reachable`,
              'No unhandled client or server errors',
            ],
            priority: r.path === '/' ? 'High' : 'Medium',
          },
        ],
      });
    }
  }

  return {
    projectName: path.basename(projectPath),
    generatedAt: new Date().toISOString(),
    testType,
    features,
  };
}

export function writeFeatureMap(
  projectPath: string,
  scan: ProjectScan,
  testType: string
): { mapPath: string; featureCount: number } {
  const map = buildFeatureMap(projectPath, scan, testType);
  const mapPath = path.resolve(projectPath, PATHS.FEATURE_MAP);
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), 'utf-8');
  return { mapPath, featureCount: map.features.length };
}
