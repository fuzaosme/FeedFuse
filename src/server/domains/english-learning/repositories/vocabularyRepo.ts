import type { Pool, PoolClient } from 'pg';
import type { VocabularyEntry } from '@/types';

type DbClient = Pool | PoolClient;

const columns = `
  id::text as id,
  term,
  normalized_term as "normalizedTerm",
  definition,
  source_article_id::text as "sourceArticleId",
  source_title as "sourceTitle",
  source_url as "sourceUrl",
  source_sentence as "sourceSentence",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function listVocabulary(pool: DbClient, userId: string): Promise<VocabularyEntry[]> {
  const { rows } = await pool.query<VocabularyEntry>(`
    select ${columns} from vocabulary_entries
    where user_id = $1 order by created_at desc, id desc
  `, [userId]);
  return rows;
}

export async function saveVocabulary(pool: DbClient, input: {
  userId: string;
  term: string;
  normalizedTerm: string;
  definition: string;
  sourceArticleId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceSentence: string;
}): Promise<VocabularyEntry> {
  const { rows } = await pool.query<VocabularyEntry>(`
    insert into vocabulary_entries (
      user_id, term, normalized_term, definition,
      source_article_id, source_title, source_url, source_sentence
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (user_id, normalized_term)
    do update set normalized_term = vocabulary_entries.normalized_term
    returning ${columns}
  `, [
    input.userId, input.term, input.normalizedTerm, input.definition,
    input.sourceArticleId, input.sourceTitle, input.sourceUrl, input.sourceSentence,
  ]);
  // 重复收藏只返回现有记录，不覆盖用户修改过的释义和出处。
  return rows[0];
}

export async function updateVocabularyDefinition(
  pool: DbClient, userId: string, id: string, definition: string,
): Promise<VocabularyEntry | null> {
  const { rows } = await pool.query<VocabularyEntry>(`
    update vocabulary_entries set definition = $3, updated_at = now()
    where user_id = $1 and id = $2 returning ${columns}
  `, [userId, id, definition]);
  return rows[0] ?? null;
}

export async function deleteVocabulary(pool: DbClient, userId: string, id: string): Promise<boolean> {
  const result = await pool.query(
    'delete from vocabulary_entries where user_id = $1 and id = $2', [userId, id],
  );
  return (result.rowCount ?? 0) > 0;
}
