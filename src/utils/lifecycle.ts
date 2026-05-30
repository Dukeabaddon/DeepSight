/**
 * Spec-driven testing lifecycle phases (UI + API).
 * Grounds tests in PRD + scan — not self-referential code-only generation.
 */

export const LIFECYCLE_PHASES = [
  'setup',
  'feature_map',
  'configure',
  'discover',
  'plan',
  'enrich',
  'run',
  'review',
  'iterate',
] as const;

export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export type ProjectMode = 'frontend' | 'backend' | 'both';

export type LifecycleState = {
  phase: LifecyclePhase;
  mode: ProjectMode;
  updatedAt: string;
  endpoint?: string;
  notes?: string;
};

export function discoverLabel(mode: ProjectMode): string {
  return mode === 'backend' ? 'api_discover' : 'ui_explore';
}

/** UI: Explore after configure. API: Discover endpoints — skips live browser explore. */
export function phaseOrder(mode: ProjectMode): LifecyclePhase[] {
  const base: LifecyclePhase[] = [
    'setup',
    'feature_map',
    'configure',
    'discover',
    'plan',
    'enrich',
    'run',
    'review',
  ];
  if (mode === 'both') return [...base, 'iterate'];
  return base;
}

export function nextPhase(current: LifecyclePhase, mode: ProjectMode): LifecyclePhase | null {
  const order = phaseOrder(mode);
  const i = order.indexOf(current);
  if (i < 0 || i >= order.length - 1) return null;
  return order[i + 1];
}
