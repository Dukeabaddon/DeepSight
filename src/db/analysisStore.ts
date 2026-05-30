import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { CodeEntityDraft } from '../types/codeEntity.js';
import { deepsightDotDir } from '../utils/file.js';

export type AnalysisRunRecord = {
  id: string;
  projectId: string;
  projectPath: string;
  depth: string;
  durationMs: number;
  filesAnalyzed: number;
  routesFound: number;
  framework: string;
  createdAt: string;
};

type StoreBackend = 'sqlite' | 'json-stub';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  framework TEXT,
  language TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  depth TEXT NOT NULL,
  duration_ms INTEGER,
  files_analyzed INTEGER,
  functions_found INTEGER DEFAULT 0,
  components_found INTEGER DEFAULT 0,
  api_routes_found INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS code_entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  analysis_run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  name TEXT,
  line_start INTEGER,
  line_end INTEGER,
  signature TEXT,
  metadata TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs(id)
);
`;

function projectIdForPath(projectPath: string): string {
  return createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 16);
}

function jsonStorePath(projectPath: string): string {
  return path.join(deepsightDotDir(projectPath), 'analysis-runs.json');
}

function sqliteDbPath(projectPath: string): string {
  return path.join(deepsightDotDir(projectPath), 'analysis.db');
}

let sqliteModule: typeof import('node:sqlite') | null | undefined;

async function loadSqlite(): Promise<typeof import('node:sqlite') | null> {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    sqliteModule = await import('node:sqlite');
    return sqliteModule;
  } catch {
    sqliteModule = null;
    return null;
  }
}

function readJsonRuns(projectPath: string): AnalysisRunRecord[] {
  const fp = jsonStorePath(projectPath);
  if (!fs.existsSync(fp)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as { runs?: AnalysisRunRecord[] };
    return Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

function writeJsonRuns(projectPath: string, runs: AnalysisRunRecord[]) {
  const fp = jsonStorePath(projectPath);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify({ runs: runs.slice(-50) }, null, 2), 'utf-8');
}

export async function ensureAnalysisStore(projectPath: string): Promise<StoreBackend> {
  const dot = deepsightDotDir(projectPath);
  fs.mkdirSync(dot, { recursive: true });

  const sqlite = await loadSqlite();
  if (!sqlite?.DatabaseSync) return 'json-stub';

  try {
    const db = new sqlite.DatabaseSync(sqliteDbPath(projectPath));
    db.exec(SCHEMA_SQL);
    db.close();
    return 'sqlite';
  } catch {
    return 'json-stub';
  }
}

export async function recordAnalysisRun(
  projectPath: string,
  input: {
    depth: string;
    durationMs: number;
    filesAnalyzed: number;
    routesFound: number;
    functionsFound?: number;
    framework: string;
    projectName?: string;
  },
): Promise<{ runId: string; store: StoreBackend }> {
  const functionsFound = input.functionsFound ?? 0;
  const store = await ensureAnalysisStore(projectPath);
  const projectId = projectIdForPath(projectPath);
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const record: AnalysisRunRecord = {
    id: runId,
    projectId,
    projectPath: path.resolve(projectPath),
    depth: input.depth,
    durationMs: input.durationMs,
    filesAnalyzed: input.filesAnalyzed,
    routesFound: input.routesFound,
    framework: input.framework,
    createdAt,
  };

  if (store === 'sqlite') {
    const sqlite = (await loadSqlite())!;
    const db = new sqlite.DatabaseSync(sqliteDbPath(projectPath));
    db.exec(SCHEMA_SQL);
    db.prepare(
      `INSERT INTO projects (id, path, name, framework, language, updated_at)
       VALUES (?, ?, ?, ?, 'typescript', datetime('now'))
       ON CONFLICT(path) DO UPDATE SET
         name = excluded.name,
         framework = excluded.framework,
         updated_at = datetime('now')`,
    ).run(projectId, record.projectPath, input.projectName ?? path.basename(projectPath), input.framework);

    db.prepare(
      `INSERT INTO analysis_runs (
        id, project_id, depth, duration_ms, files_analyzed,
        functions_found, components_found, api_routes_found
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      runId,
      projectId,
      input.depth,
      input.durationMs,
      input.filesAnalyzed,
      functionsFound,
      input.routesFound,
    );
    db.close();
  } else {
    const runs = readJsonRuns(projectPath);
    runs.push(record);
    writeJsonRuns(projectPath, runs);
  }

  return { runId, store };
}

function jsonEntitiesPath(projectPath: string): string {
  return path.join(deepsightDotDir(projectPath), 'code-entities.json');
}

export async function saveCodeEntities(
  projectPath: string,
  runId: string,
  entities: CodeEntityDraft[],
): Promise<{ stored: number; store: StoreBackend }> {
  const store = await ensureAnalysisStore(projectPath);
  const projectId = projectIdForPath(projectPath);

  if (store === 'sqlite') {
    const sqlite = (await loadSqlite())!;
    const db = new sqlite.DatabaseSync(sqliteDbPath(projectPath));
    db.exec(SCHEMA_SQL);
    const insert = db.prepare(
      `INSERT INTO code_entities (
        id, project_id, analysis_run_id, type, file_path, name,
        line_start, line_end, signature, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let stored = 0;
    for (const e of entities) {
      insert.run(
        randomUUID(),
        projectId,
        runId,
        e.type,
        e.file_path,
        e.name,
        e.line_start,
        e.line_end,
        e.signature,
        e.metadata,
      );
      stored += 1;
    }
    db.close();
    return { stored, store };
  }

  const fp = jsonEntitiesPath(projectPath);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const existing = fs.existsSync(fp)
    ? (JSON.parse(fs.readFileSync(fp, 'utf-8')) as { runs?: unknown[] }).runs ?? []
    : [];
  existing.push({ runId, projectId, entities });
  fs.writeFileSync(fp, JSON.stringify({ runs: existing.slice(-20) }, null, 2), 'utf-8');
  return { stored: entities.length, store };
}

export type StoredEntity = CodeEntityDraft & { id?: string };

export async function getCodeEntitiesForRun(
  projectPath: string,
  runId: string,
): Promise<StoredEntity[]> {
  const store = await ensureAnalysisStore(projectPath);
  if (store === 'sqlite') {
    const sqlite = await loadSqlite();
    if (!sqlite?.DatabaseSync) return [];
    const dbPath = sqliteDbPath(projectPath);
    if (!fs.existsSync(dbPath)) return [];
    const db = new sqlite.DatabaseSync(dbPath);
    const rows = db
      .prepare(
        `SELECT file_path, name, line_start, line_end, signature, metadata, type
         FROM code_entities WHERE analysis_run_id = ? ORDER BY file_path, line_start`,
      )
      .all(runId) as Array<{
        file_path: string;
        name: string | null;
        line_start: number;
        line_end: number;
        signature: string | null;
        metadata: string | null;
        type: string;
      }>;
    db.close();
    return rows.map((r) => ({
      type: 'function' as const,
      file_path: r.file_path,
      name: r.name,
      line_start: r.line_start,
      line_end: r.line_end,
      signature: r.signature,
      metadata: r.metadata,
    }));
  }
  const fp = jsonEntitiesPath(projectPath);
  if (!fs.existsSync(fp)) return [];
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as {
    runs?: Array<{ runId: string; entities: CodeEntityDraft[] }>;
  };
  return data.runs?.find((r) => r.runId === runId)?.entities ?? [];
}

export async function getCodeEntitiesForLatestRun(projectPath: string): Promise<StoredEntity[]> {
  const run = await getLatestAnalysisRun(projectPath);
  if (!run) return [];
  return getCodeEntitiesForRun(projectPath, run.id);
}

function snapshotPath(projectPath: string): string {
  return path.join(deepsightDotDir(projectPath), 'analysis-snapshot.json');
}

export type AnalysisSnapshot = {
  analysisRunId: string;
  framework: string;
  kind: string;
  routes: Array<{ path: string; file: string; description: string }>;
  savedAt: string;
  importGraph?: {
    edgeCount: number;
    nodeCount: number;
    artifactPath: string;
  };
};

export async function saveAnalysisSnapshot(
  projectPath: string,
  snapshot: AnalysisSnapshot,
): Promise<void> {
  const fp = snapshotPath(projectPath);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(snapshot, null, 2), 'utf-8');
}

export async function loadAnalysisSnapshot(
  projectPath: string,
  runId: string,
): Promise<AnalysisSnapshot | null> {
  const fp = snapshotPath(projectPath);
  if (!fs.existsSync(fp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as AnalysisSnapshot;
    return data.analysisRunId === runId ? data : null;
  } catch {
    return null;
  }
}

export async function countCodeEntitiesForRun(
  projectPath: string,
  runId: string,
): Promise<number> {
  const store = await ensureAnalysisStore(projectPath);
  if (store === 'sqlite') {
    const sqlite = await loadSqlite();
    if (!sqlite?.DatabaseSync) return 0;
    const dbPath = sqliteDbPath(projectPath);
    if (!fs.existsSync(dbPath)) return 0;
    const db = new sqlite.DatabaseSync(dbPath);
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM code_entities WHERE analysis_run_id = ?`)
      .get(runId) as { n: number };
    db.close();
    return row?.n ?? 0;
  }
  const fp = jsonEntitiesPath(projectPath);
  if (!fs.existsSync(fp)) return 0;
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as {
    runs?: Array<{ runId: string; entities: unknown[] }>;
  };
  const hit = data.runs?.find((r) => r.runId === runId);
  return hit?.entities?.length ?? 0;
}

export async function getLatestAnalysisRun(projectPath: string): Promise<AnalysisRunRecord | null> {
  const store = await ensureAnalysisStore(projectPath);
  if (store === 'sqlite') {
    const sqlite = await loadSqlite();
    if (!sqlite?.DatabaseSync) return null;
    const dbPath = sqliteDbPath(projectPath);
    if (!fs.existsSync(dbPath)) return null;
    try {
      const db = new sqlite.DatabaseSync(dbPath);
      const projectId = projectIdForPath(projectPath);
      const row = db
        .prepare(
          `SELECT id, project_id, depth, duration_ms, files_analyzed, api_routes_found, created_at
           FROM analysis_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(projectId) as {
          id: string;
          project_id: string;
          depth: string;
          duration_ms: number;
          files_analyzed: number;
          api_routes_found: number;
          created_at: string;
        } | undefined;
      db.close();
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        projectPath: path.resolve(projectPath),
        depth: row.depth,
        durationMs: row.duration_ms,
        filesAnalyzed: row.files_analyzed,
        routesFound: row.api_routes_found,
        framework: '',
        createdAt: row.created_at,
      };
    } catch {
      return null;
    }
  }
  const runs = readJsonRuns(projectPath);
  return runs.length ? runs[runs.length - 1]! : null;
}
