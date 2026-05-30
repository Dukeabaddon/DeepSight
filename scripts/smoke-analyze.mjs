import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { analyzeCodebase } = await import('../dist/tools/analyzeCodebase.js');

const projectPath = path.join(root, 'apps', 'web');
const depth = process.argv[2] === 'deep' ? 'deep' : 'surface';
const result = await analyzeCodebase({ projectPath, depth });
const routes = result.scan.routes;
if (routes.length < 1) {
  console.error('expected at least one route');
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  summary: result.summary,
  store: result.store,
  files: result.inventory.total,
  routes: routes.length,
  paths: routes.map((r) => r.path),
  kind: result.scan.kind,
  functionAnalysis: result.functionAnalysis,
}, null, 2));

if (depth === 'deep') {
  if (!result.functionAnalysis || result.functionAnalysis.totalFunctions < 1) {
    console.error('deep analyze expected functionAnalysis.totalFunctions >= 1');
    process.exit(1);
  }
}
