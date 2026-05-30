import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import type { ProjectScan } from './projectScan.js';
import type { TestResultsArtifact } from './artifacts.js';
import type { ProjectMode } from './lifecycle.js';

export type ExploreFeatureStatus = 'pending' | 'smoke_ready' | 'passed' | 'failed' | 'blocked';

export type ExploreManifest = {
  mode: ProjectMode;
  endpoint: string;
  generatedAt: string;
  features: Array<{
    path: string;
    title: string;
    status: ExploreFeatureStatus;
    notes?: string;
  }>;
};

export function writeDiscoverManifest(
  projectPath: string,
  scan: ProjectScan,
  endpoint: string,
  mode: ProjectMode
): string {
  const routes = scan.routes.length
    ? scan.routes
    : [{ path: '/', description: 'Home', auth_required: false, file: '' }];

  const manifest: ExploreManifest = {
    mode,
    endpoint,
    generatedAt: new Date().toISOString(),
    features: routes.map((r) => ({
      path: r.path,
      title: r.description || r.path,
      status: 'smoke_ready',
      notes: mode === 'backend' ? 'API discover via smoke request' : 'UI explore-lite via route smoke',
    })),
  };

  const outPath = path.resolve(projectPath, PATHS.EXPLORE_MANIFEST);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return outPath;
}

/** Merge Playwright structured results back into explore manifest. */
export function updateExploreFromResults(
  projectPath: string,
  artifact: TestResultsArtifact
): void {
  const outPath = path.resolve(projectPath, PATHS.EXPLORE_MANIFEST);
  if (!fs.existsSync(outPath)) return;

  const manifest = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as ExploreManifest;
  for (const f of manifest.features) {
    const hit = artifact.results.find(
      (r) => r.title.includes(f.path) || r.title.includes(f.title)
    );
    if (hit) {
      f.status = hit.status === 'passed' ? 'passed' : hit.status === 'failed' ? 'failed' : f.status;
      if (hit.errorMessage) f.notes = hit.errorMessage.slice(0, 200);
    }
  }
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
