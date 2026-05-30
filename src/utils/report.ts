import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import { PATHS, ABS_PATHS } from '../paths.js';
import type { TestResultsArtifact } from './artifacts.js';
import { classifiedFailureFromResult } from './failureClassifier.js';

interface TestResult {
  testName: string;
  testCode: string;
  testError: string;
  testVisualizationAndResult: string;
  passed: boolean;
}

interface Requirement {
  name: string;
  description: string;
  tests: TestResult[];
}

/**
 * Parse test requirements from raw markdown.
 */
export function parseRequirements(md: string): Requirement[] {
  const requirements: Requirement[] = [];
  // Simple parser: find ## Requirement: blocks
  const reqBlocks = md.split(/### Requirement:/g);
  for (const block of reqBlocks.slice(1)) {
    const lines = block.trim().split('\n');
    const name = lines[0]?.trim() || 'Unknown';
    const descMatch = block.match(/Description:\s*(.+)/);
    const description = descMatch ? descMatch[1].trim() : '';
    const tests: TestResult[] = [];
    // Find test cases
    const testBlocks = block.split(/#### Test /g);
    for (const tb of testBlocks.slice(1)) {
      const testName = tb.split('\n')[0]?.trim() || 'Unknown';
      const testCodeMatch = tb.match(/Test Code:\s*\[.*\]\(\.\/(.+)\)/);
      const testErrorMatch = tb.match(/Test Error:\s*(.+)/);
      const testVizMatch = tb.match(/Test Visualization and Result:\s*(.+)/);
      const statusMatch = tb.match(/Status:\s*(.+)/
);
      tests.push({
        testName,
        testCode: testCodeMatch ? testCodeMatch[1] : '',
        testError: testErrorMatch ? testErrorMatch[1].trim() : '',
        testVisualizationAndResult: testVizMatch ? testVizMatch[1].trim() : '',
        passed: statusMatch ? statusMatch[1].includes('Passed') : false,
      });
    }
    requirements.push({ name, description, tests });
  }
  return requirements;
}

/**
 * Get project name from markdown report header.
 */
export function getProjectName(md: string): string | null {
  const match = md.match(/Project Name:\*\*\s*(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Extract critical issues section as HTML.
 */
export function extractCriticalIssuesToHtml(md: string): string {
  const match = md.match(/## 4️⃣ Key Gaps \/ Risks\n([\s\S]*?)(?=\n##|$)/);
  if (!match) return 'N/A';
  return match[1].trim();
}

/**
 * Generate HTML report from markdown test report.
 */
export async function generateHtmlReport(mdFile: string): Promise<void> {
  const md = fs.readFileSync(mdFile, 'utf-8');
  const htmlFile = mdFile.replace(/\.md$/, '.html');
  const requirements = parseRequirements(md);
  const htmlTemplate = fs.readFileSync(ABS_PATHS.HTML_TEST_REPORT_TEMPLATE, 'utf-8');
  const projectName = getProjectName(md) || 'N/A';
  const criticalIssues = extractCriticalIssuesToHtml(md) || 'N/A';
  const totalPassed = requirements.reduce((acc, req) => acc + req.tests.filter(t => t.passed).length, 0);
  const totalTests = requirements.reduce((acc, req) => acc + req.tests.length, 0);
  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  // Build requirement HTML
  const reqHtml = requirements.map(req => {
    const testCards = req.tests.map(test => {
      const statusClass = test.passed ? 'status-pass' : 'status-fail';
      const statusText = test.passed ? 'Passed' : 'Failed';
      return `
        <div class="test-card" style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <h4 style="color: var(--foreground); font-family: 'Space Grotesk', sans-serif; margin: 0 0 8px 0;">${test.testName}</h4>
          <div style="display: grid; gap: 8px;">
            <div><span style="color: var(--muted); font-size: 12px;">Test Code:</span> <a href="./${test.testCode}" style="color: var(--accent);">${test.testCode}</a></div>
            <div><span style="color: var(--muted); font-size: 12px;">Status:</span> <span class="${statusClass}" style="color: ${test.passed ? 'var(--success)' : 'var(--error)'};">${statusText}</span></div>
            ${test.testError ? `<div><span style="color: var(--muted); font-size: 12px;">Error:</span> <span style="color: var(--error);">${test.testError}</span></div>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom: 24px;">
        <h3 style="color: var(--foreground); font-family: 'Space Grotesk', sans-serif;">${req.name}</h3>
        <p style="color: var(--muted);">${req.description}</p>
        ${testCards}
      </div>`;
  }).join('');

  // Build coverage table
  const coverageRows = requirements.map(req => {
    const passed = req.tests.filter(t => t.passed).length;
    const failed = req.tests.length - passed;
    return `
      <tr>
        <td style="padding: 8px; color: var(--foreground);">${req.name}</td>
        <td style="padding: 8px; color: var(--foreground); text-align: center;">${req.tests.length}</td>
        <td style="padding: 8px; color: var(--success); text-align: center;">${passed}</td>
        <td style="padding: 8px; color: var(--error); text-align: center;">${failed}</td>
      </tr>`;
  }).join('');

  const rendered = htmlTemplate
    .replace('{{PROJECT_NAME}}', projectName)
    .replace('{{PASS_RATE}}', `${passRate}%`)
    .replace('{{REQUIREMENTS_HTML}}', reqHtml)
    .replace('{{COVERAGE_ROWS}}', coverageRows)
    .replace('{{CRITICAL_ISSUES}}', criticalIssues)
    .replace('{{TOTAL_PASSED}}', String(totalPassed))
    .replace('{{TOTAL_TESTS}}', String(totalTests));

  fse.writeFileSync(htmlFile, rendered);
}

/**
 * Generate both HTML and check for markdown report.
 */
export async function generateHtmlAndPdfFromMarkdown(mdFile: string): Promise<void> {
  if (fs.existsSync(mdFile)) {
    await generateHtmlReport(mdFile);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Interactive HTML report from test_results.json (dashboard Full Report). */
export function generateHtmlReportFromResults(
  projectPath: string,
  artifact?: TestResultsArtifact,
): string {
  const resultsPath = path.resolve(projectPath, PATHS.TEST_RESULTS);
  const data: TestResultsArtifact =
    artifact ??
    (fs.existsSync(resultsPath)
      ? (JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as TestResultsArtifact)
      : {
          projectName: path.basename(projectPath),
          executionTimestamp: new Date().toISOString(),
          summary: { totalRun: 0, passed: 0, failed: 0, skipped: 0 },
          results: [],
        });

  const { summary, results } = data;
  const passRate =
    summary.totalRun > 0 ? Math.round((summary.passed / summary.totalRun) * 100) : 0;

  const rows = results
    .map((r) => {
      const cat = classifiedFailureFromResult(r);
      const statusClass = r.status === 'passed' ? 'pass' : r.status === 'skipped' ? 'skip' : 'fail';
      const err = r.errorMessage ? escapeHtml(r.errorMessage) : '';
      const detailId = `detail-${r.testId}-${(r.specFile ?? 'x').replace(/\W/g, '')}`;
      return `
      <tr class="row-${statusClass}" data-status="${r.status}">
        <td>${escapeHtml(r.testId)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td><span class="badge ${statusClass}">${r.status}</span></td>
        <td>${r.durationMs ?? '—'}ms</td>
        <td>${escapeHtml(r.specFile ?? '—')}</td>
        <td>${r.status === 'failed' ? escapeHtml(cat.category) : '—'}</td>
        <td>${err ? `<button type="button" class="link-btn" onclick="toggleDetail('${detailId}')">Details</button>` : '—'}</td>
      </tr>
      ${err ? `<tr id="${detailId}" class="detail-row" style="display:none"><td colspan="7"><pre class="err">${err}</pre></td></tr>` : ''}`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeepSight Report — ${escapeHtml(data.projectName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Space Grotesk', sans-serif; background: #0a0a0a; color: #f0f0f0; margin: 0; padding: 24px; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; background: linear-gradient(135deg, #6c63ff, #00d4aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .meta { color: #888; font-size: 13px; margin-bottom: 20px; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; min-width: 100px; }
    .card strong { display: block; font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; background: #111; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #222; font-size: 13px; vertical-align: top; }
    th { background: #1a1a1a; color: #aaa; font-weight: 600; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
    .badge.pass { background: rgba(0,212,170,0.2); color: #00d4aa; }
    .badge.fail { background: rgba(255,107,107,0.2); color: #ff6b6b; }
    .badge.skip { background: rgba(255,255,255,0.1); color: #aaa; }
    .link-btn { background: none; border: none; color: #6c63ff; cursor: pointer; text-decoration: underline; font: inherit; }
    pre.err { white-space: pre-wrap; word-break: break-word; background: #0a0a0a; padding: 12px; border-radius: 6px; color: #ccc; font-size: 12px; margin: 0; max-height: 280px; overflow: auto; }
    .filters { margin-bottom: 12px; }
    .filters button { margin-right: 8px; padding: 6px 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #eee; cursor: pointer; }
    .filters button.active { border-color: #6c63ff; color: #6c63ff; }
  </style>
</head>
<body>
  <h1>DeepSight Test Report</h1>
  <div class="meta">${escapeHtml(data.projectName)} · ${escapeHtml(data.executionTimestamp)} · ${passRate}% pass rate</div>
  <div class="cards">
    <div class="card"><span>Total</span><strong>${summary.totalRun}</strong></div>
    <div class="card"><span>Passed</span><strong style="color:#00d4aa">${summary.passed}</strong></div>
    <div class="card"><span>Failed</span><strong style="color:#ff6b6b">${summary.failed}</strong></div>
    <div class="card"><span>Skipped</span><strong>${summary.skipped}</strong></div>
  </div>
  <div class="filters">
    <button type="button" class="active" onclick="filterRows('all', this)">All</button>
    <button type="button" onclick="filterRows('passed', this)">Passed</button>
    <button type="button" onclick="filterRows('failed', this)">Failed</button>
  </div>
  <table>
    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Duration</th><th>Spec</th><th>Category</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No test results.</td></tr>'}</tbody>
  </table>
  <script>
    function toggleDetail(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
    }
    function filterRows(status, btn) {
      document.querySelectorAll('.filters button').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('tbody tr[data-status]').forEach(function(tr) {
        tr.style.display = status === 'all' || tr.getAttribute('data-status') === status ? '' : 'none';
      });
      document.querySelectorAll('.detail-row').forEach(function(tr) { tr.style.display = 'none'; });
    }
  </script>
</body>
</html>`;

  const htmlPath = path.resolve(projectPath, PATHS.TEST_REPORT_HTML);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return htmlPath;
}