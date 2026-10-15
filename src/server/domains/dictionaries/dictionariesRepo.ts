import type { Pool, PoolClient } from 'pg';
import type { DictionaryEntryInput } from './parsers';

type DbClient = Pool | PoolClient;

export type DictionaryStatusValue = 'available' | 'installing' | 'ready' | 'error';

export interface DictionaryRecord {
  id: string;
  name: string;
  description: string;
  language: string;
  license: string;
  attribution: string;
  homepage: string;
  sourceUrl: string;
  builtin: boolean;
  enabled: boolean;
  status: DictionaryStatusValue;
  error: string;
  totalEntries: number;
  entryCount: number;
  totalBytes: number;
  downloadedBytes: number;
  installedAt: string | null;
  updatedAt: string | null;
}

interface DictionaryRow {
  id: string;
  name: string;
  description: string;
  language: string;
  license: string;
  attribution: string;
  homepage: string;
  source_url: string;
  builtin: boolean;
  enabled: boolean;
  status: string;
  error_message: string;
  total_entries: number;
  imported_entries: number;
  total_bytes: string | number;
  downloaded_bytes: string | number;
  installed_at: Date | null;
  updated_at: Date | null;
}

const columns = `
  id, name, description, language, license, attribution, homepage,
  source_url, builtin, enabled, status, error_message,
  total_entries, imported_entries, total_bytes, downloaded_bytes,
  installed_at, updated_at
`;

function toNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRecord(row: DictionaryRow): DictionaryRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    language: row.language,
    license: row.license,
    attribution: row.attribution,
    homepage: row.homepage,
    sourceUrl: row.source_url,
    builtin: row.builtin,
    enabled: row.enabled,
    status: row.status as DictionaryStatusValue,
    error: row.error_message,
    totalEntries: row.total_entries,
    entryCount: row.imported_entries,
    totalBytes: toNumber(row.total_bytes),
    downloadedBytes: toNumber(row.downloaded_bytes),
    installedAt: row.installed_at ? row.installed_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

export async function listDictionaryRecords(pool: DbClient): Promise<DictionaryRecord[]> {
  const { rows } = await pool.query<DictionaryRow>(
    `select ${columns} from dictionaries order by priority desc, id asc`,
  );
  return rows.map(mapRecord);
}

export async function getDictionaryRecord(
  pool: DbClient,
  id: string,
): Promise<DictionaryRecord | null> {
  const { rows } = await pool.query<DictionaryRow>(
    `select ${columns} from dictionaries where id = $1`,
    [id],
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

export interface DictionaryUpsertInput {
  id: string;
  name: string;
  description: string;
  language: string;
  license: string;
  attribution: string;
  homepage: string;
  sourceUrl: string;
  priority: number;
  totalEntries: number;
  totalBytes: number;
}

export async function upsertDictionary(
  pool: DbClient,
  input: DictionaryUpsertInput,
): Promise<DictionaryRecord> {
  const { rows } = await pool.query<DictionaryRow>(`
    insert into dictionaries (
      id, name, description, language, license, attribution, homepage, source_url,
      priority, total_entries, total_bytes, builtin, enabled, status,
      error_message, imported_entries, downloaded_bytes, updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, true, 'installing', '', 0, 0, now())
    on conflict (id) do update set
      name = excluded.name,
      description = excluded.description,
      language = excluded.language,
      license = excluded.license,
      attribution = excluded.attribution,
      homepage = excluded.homepage,
      source_url = excluded.source_url,
      priority = excluded.priority,
      total_entries = excluded.total_entries,
      total_bytes = excluded.total_bytes,
      status = 'installing',
      error_message = '',
      imported_entries = 0,
      downloaded_bytes = 0,
      updated_at = now()
    returning ${columns}
  `, [
    input.id, input.name, input.description, input.language, input.license,
    input.attribution, input.homepage, input.sourceUrl, input.priority,
    input.totalEntries, input.totalBytes,
  ]);
  return mapRecord(rows[0]);
}

export interface DictionaryPatch {
  status?: DictionaryStatusValue;
  error?: string;
  totalEntries?: number;
  entryCount?: number;
  totalBytes?: number;
  downloadedBytes?: number;
  enabled?: boolean;
  markInstalled?: boolean;
}

export async function patchDictionary(
  pool: DbClient,
  id: string,
  patch: DictionaryPatch,
): Promise<DictionaryRecord | null> {
  const assignments: string[] = [];
  const values: unknown[] = [id];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    assignments.push(`${sql} = $${values.length}`);
  };

  if (patch.status !== undefined) push('status', patch.status);
  if (patch.error !== undefined) push('error_message', patch.error);
  if (patch.totalEntries !== undefined) push('total_entries', patch.totalEntries);
  if (patch.entryCount !== undefined) push('imported_entries', patch.entryCount);
  if (patch.totalBytes !== undefined) push('total_bytes', patch.totalBytes);
  if (patch.downloadedBytes !== undefined) push('downloaded_bytes', patch.downloadedBytes);
  if (patch.enabled !== undefined) push('enabled', patch.enabled);
  if (patch.markInstalled) assignments.push('installed_at = now()');
  if (!assignments.length) return getDictionaryRecord(pool, id);

  assignments.push('updated_at = now()');
  const { rows } = await pool.query<DictionaryRow>(
    `update dictionaries set ${assignments.join(', ')} where id = $1 returning ${columns}`,
    values,
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

export async function deleteDictionary(pool: DbClient, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'delete from dictionaries where id = $1 and builtin = false',
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function clearDictionaryEntries(pool: DbClient, id: string): Promise<void> {
  await pool.query('delete from dictionary_entries where dictionary_id = $1', [id]);
}

const INSERT_BATCH_SIZE = 5_000;

export async function insertDictionaryEntries(
  pool: DbClient,
  dictionaryId: string,
  entries: readonly DictionaryEntryInput[],
): Promise<number> {
  if (!entries.length) return 0;
  const result = await pool.query(
    `insert into dictionary_entries (dictionary_id, term, meanings, phonetic)
     select $1, batch.term, batch.meanings::jsonb, batch.phonetic
     from unnest($2::text[], $3::text[], $4::text[]) as batch(term, meanings, phonetic)
     on conflict (dictionary_id, term) do nothing`,
    [
      dictionaryId,
      entries.map((entry) => entry.term),
      entries.map((entry) => JSON.stringify(entry.meanings)),
      entries.map((entry) => entry.phonetic),
    ],
  );
  // 归一化后重复的词条会被 on conflict 跳过，实际写入行数才是真实词条数。
  return result.rowCount ?? 0;
}

export async function countDictionaryEntries(pool: DbClient, id: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*)::text as count from dictionary_entries where dictionary_id = $1',
    [id],
  );
  return toNumber(rows[0]?.count ?? '0');
}

export const dictionaryInsertBatchSize = INSERT_BATCH_SIZE;

export interface DictionaryEntryRow {
  dictionaryId: string;
  term: string;
  meanings: string[];
  phonetic: string;
}

function toEntryRow(row: {
  dictionary_id: string;
  term: string;
  meanings: unknown;
  phonetic: string;
}): DictionaryEntryRow | null {
  const meanings = Array.isArray(row.meanings)
    ? row.meanings.filter((meaning): meaning is string => typeof meaning === 'string')
    : [];
  if (!meanings.length) return null;
  return { dictionaryId: row.dictionary_id, term: row.term, meanings, phonetic: row.phonetic ?? '' };
}

/**
 * 批量命中：短语回退的多个候选一次往返全部查出，由调用方按候选顺序 + 优先级择优。
 * 覆盖索引 dictionary_entries_term_covering_idx 让 term 等值查询走索引扫描，
 * INCLUDE 列避免回表，候选数 ≤4 时与单查同为 1 次索引查找量级。
 */
export async function findDictionaryEntries(
  pool: DbClient,
  terms: readonly string[],
): Promise<DictionaryEntryRow[]> {
  if (!terms.length) return [];
  const { rows } = await pool.query<{
    dictionary_id: string;
    term: string;
    meanings: unknown;
    phonetic: string;
  }>(`
    select e.dictionary_id, e.term, e.meanings, e.phonetic
    from dictionary_entries e
    join dictionaries d on d.id = e.dictionary_id
    where e.term = any($1) and d.enabled = true and d.status = 'ready'
    order by d.priority desc, d.installed_at desc nulls last, d.id asc
  `, [terms]);
  const entries: DictionaryEntryRow[] = [];
  for (const row of rows) {
    const entry = toEntryRow(row);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 按优先级取一条命中的词条：用户词典优先于内置词典。 */
export async function findDictionaryEntry(
  pool: DbClient,
  term: string,
): Promise<DictionaryEntryRow | null> {
  const entries = await findDictionaryEntries(pool, [term]);
  return entries[0] ?? null;
}

export async function countReadyDictionaries(pool: DbClient): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "select count(*)::text as count from dictionaries where status = 'ready' and enabled = true",
  );
  return toNumber(rows[0]?.count ?? '0');
}
