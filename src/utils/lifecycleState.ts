import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths.js';
import type { LifecyclePhase, LifecycleState, ProjectMode } from './lifecycle.js';

export function readLifecycleState(projectPath: string): LifecycleState | null {
  const p = path.resolve(projectPath, PATHS.LIFECYCLE_STATE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as LifecycleState;
  } catch {
    return null;
  }
}

export function writeLifecycleState(
  projectPath: string,
  partial: Partial<LifecycleState> & { phase: LifecyclePhase }
): LifecycleState {
  const prev = readLifecycleState(projectPath) || {
    phase: 'setup',
    mode: 'frontend' as ProjectMode,
    updatedAt: new Date().toISOString(),
  };
  const next: LifecycleState = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  const p = path.resolve(projectPath, PATHS.LIFECYCLE_STATE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
