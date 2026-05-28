import fs from 'fs';
import { InitializationInputSchema, type DeepSightConfig } from '../schemas.js';
import { PATHS, DOT_DIR } from '../paths.js';
import {
  ensureDirs, saveConfig, readConfig, normalizeAbsolutePath,
  ensureGitignoreEntry
} from '../utils/file.js';

/**
 * deepsight_bootstrap tool:
 * First-time project setup. Creates folder structure and config.
 */
export async function initialization(params: unknown) {
  const args = InitializationInputSchema.parse(params);
  const type = args.type;
  const projectPath = normalizeAbsolutePath(args.projectPath);
  let pathname = '';

  if (args.pathname && args.pathname !== '/') {
    pathname = args.pathname.startsWith('/') ? args.pathname.slice(1) : args.pathname;
  }

  ensureDirs(projectPath);

  let config: DeepSightConfig;
  const configPath = getConfigPath(projectPath);
  if (!fs.existsSync(configPath)) {
    config = { status: 'init' };
  } else {
    config = await readConfig(projectPath);
    config.status = 'init';
  }

  config.scope = args.testScope;
  config.type = type;
  config.localEndpoint = 'http://localhost:' + args.localPort + '/' + pathname;
  await saveConfig(projectPath, config);
  ensureGitignoreEntry(projectPath);

  const data = {
    next_action: [
      {
        type: 'instructions',
        message: 'DeepSight initialized for project at ' + projectPath + '\n\n' +
          'Project type: ' + type + '\n' +
          'Local endpoint: ' + config.localEndpoint + '\n' +
          'Test scope: ' + args.testScope + '\n\n' +
          '- Directory structure created at ' + projectPath + '/' + PATHS.DEEPSIGHT_DIR + '\n' +
          '- Config saved at ' + projectPath + '/' + DOT_DIR + '/config.json\n\n' +
          'Next steps:\n' +
          '1. Call deepsight_generate_code_summary\n' +
          '2. Then deepsight_generate_standardized_prd\n' +
          '3. Then deepsight_generate_frontend_test_plan (or backend)\n' +
          '4. Finally deepsight_generate_code_and_execute'
      }
    ]
  };
  return data;
}

function getConfigPath(projectPath: string) {
  return projectPath + '/' + DOT_DIR + '/config.json';
}
