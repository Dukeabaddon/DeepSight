/** Strip noisy Playwright/Node stderr from report tails. */
export function sanitizePlaywrightLog(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'/i.test(t)) return false;
    if (/Use `node --trace-warnings`/i.test(t)) return false;
    return true;
  });
  const joined = kept.join('\n').trim();
  if (joined.length > 0) return joined.slice(-4000);
  return raw.replace(/\(node:\d+\) Warning: The 'NO_COLOR'[^\n]*\n/g, '').slice(-4000);
}
