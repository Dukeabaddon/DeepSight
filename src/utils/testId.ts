/** Extract TC### from Playwright spec title (e.g. "TC002: Visit /"). */
export function testIdFromSpecTitle(title: string, fallbackIndex: number): string {
  const fromPrefix = title.match(/^(TC\d{3})\s*:/i);
  if (fromPrefix) return fromPrefix[1]!.toUpperCase();
  const embedded = title.match(/\b(TC\d{3})\b/i);
  if (embedded) return embedded[1]!.toUpperCase();
  return `TC${String(fallbackIndex).padStart(3, '0')}`;
}

export function entityToTestIdSlug(entityName: string): string {
  return entityName
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
