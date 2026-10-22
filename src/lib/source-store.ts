import { getRequestContext } from '@cloudflare/next-on-pages';

import { normalizeSources, VideoSource } from './sources';

export interface SourceDatabase {
  prepare(sql: string): {
    bind(...values: (string | number)[]): ReturnType<SourceDatabase['prepare']>;
    first<T>(): Promise<T | null>;
    run(): Promise<{ meta: { changes?: number } }>;
  };
}

export interface SourceSettings {
  sources: VideoSource[];
  revision: number;
  updatedAt: string | null;
}

export function getSourceDatabase(): SourceDatabase | null {
  try {
    return (
      (getRequestContext().env as { SOURCE_DB?: SourceDatabase }).SOURCE_DB ||
      null
    );
  } catch {
    return null;
  }
}

export async function readSourceSettings(
  db = getSourceDatabase()
): Promise<SourceSettings | null> {
  if (!db) return null;
  const row = await db
    .prepare(
      'SELECT sources_json, revision, updated_at FROM moontv_source_settings WHERE id = 1'
    )
    .first<{ sources_json: string; revision: number; updated_at: string }>();
  return row
    ? {
        sources: normalizeSources(JSON.parse(row.sources_json)),
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function saveSourceSettings(
  db: SourceDatabase,
  sources: unknown,
  revision: number
): Promise<boolean> {
  const normalized = normalizeSources(sources);
  const json = JSON.stringify(normalized);
  const now = new Date().toISOString();
  const statement =
    revision === 0
      ? db
          .prepare(
            'INSERT OR IGNORE INTO moontv_source_settings (id, sources_json, revision, updated_at) VALUES (1, ?, 1, ?)'
          )
          .bind(json, now)
      : db
          .prepare(
            'UPDATE moontv_source_settings SET sources_json = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?'
          )
          .bind(json, now, revision);
  const result = await statement.run();
  return result.meta.changes === 1;
}
