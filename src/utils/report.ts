import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import { PATHS, ABS_PATHS } from '../paths.js';

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