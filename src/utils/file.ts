import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import YAML from 'yaml';
import { PATHS, DEEPSIGHT_DIR, DOT_DIR, TMP_DIR } from '../paths.js';
import { DeepSightConfigSchema, type DeepSightConfig } from '../schemas.js';

/**
 * Resolve the .deepsight dir and tmp dir within a project.
 */
export function deepsightDir(projectPath: string) {
  return path.resolve(projectPath, DEEPSIGHT_DIR);
}

export function deepsightTmpDir(projectPath: string) {
  return path.resolve(projectPath, PATHS.TMP_DIR);
}

export function deepsightDotDir(projectPath: string) {
  return path.resolve(projectPath, DOT_DIR);
}

export function getConfigFilePath(projectPath: string) {
  return path.resolve(projectPath, DOT_DIR, 'config.json');
}

/**
 * Ensure DeepSight directories exist.
 */
export function ensureDirs(projectPath: string) {
  fse.ensureDirSync(deepsightDir(projectPath));
  fse.ensureDirSync(deepsightTmpDir(projectPath));
  fse.ensureDirSync(deepsightDotDir(projectPath));
  fse.ensureDirSync(path.resolve(projectPath, PATHS.RAW_PRD_DIR));
}

/**
 * Read config from .deepsight/config.json
 */
export async function readConfig(projectPath: string): Promise<DeepSightConfig> {
  const configPath = getConfigFilePath(projectPath);
  if (!fs.existsSync(configPath)) {
    return { status: 'init' };
  }
  try {
    const data = await fse.readJSON(configPath);
    return DeepSightConfigSchema.parse(data);
  } catch {
    return { status: 'init' };
  }
}

/**
 * Save config to .deepsight/config.json
 */
export async function saveConfig(projectPath: string, config: DeepSightConfig) {
  const dotDir = deepsightDotDir(projectPath);
  fse.ensureDirSync(dotDir);
  await fse.writeJSON(getConfigFilePath(projectPath), config, { spaces: 2 });
}

/**
 * Read a YAML file with auto-encoding detection.
 */
export function readYAMLWithAutoEncoding(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(content);
}

/**
 * Normalize an absolute path.
 */
export function normalizeAbsolutePath(p: string): string {
  return path.resolve(p);
}

/**
 * Ensure .gitignore has the DeepSight directory entry.
 */
export function ensureGitignoreEntry(projectPath: string) {
  const gitignorePath = path.resolve(projectPath, '.gitignore');
  const entry = `\n# DeepSight test artifacts\n${DEEPSIGHT_DIR}\n`;
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(DEEPSIGHT_DIR)) {
      fs.appendFileSync(gitignorePath, entry);
    }
  } else {
    fs.writeFileSync(gitignorePath, entry);
  }
}

/**
 * Normalize project path (cross-platform)
 */
export function normalizePath(p: string): string {
  return path.normalize(p);
}

/**
 * Check if a port is listening.
 */
export function checkPortListening(port: number, hostname: string = 'localhost', timeout: number = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const http = require('http');
      const req = http.get(`http://${hostname}:${port}`, (res: any) => {
        resolve(true);
        res.resume();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          resolve(false);
        } else {
          setTimeout(check, 300);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (Date.now() - start > timeout) {
          resolve(false);
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

/**
 * Wait for a file to become stable (no writes for 2 seconds) before triggering a callback.
 */
export function waitFileStable(filePath: string, callback: () => void) {
  let timeoutId: NodeJS.Timeout;
  const watcher = fs.watch(filePath, () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      watcher.close();
      callback();
    }, 2000);
  });
  // Also check if file already exists
  if (fs.existsSync(filePath)) {
    timeoutId = setTimeout(callback, 2000);
  }
}