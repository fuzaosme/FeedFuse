import { z } from 'zod';
import { countEnglishWords, cleanVocabularyTerm, ENGLISH_LEARNING_MAX_TEXT_LENGTH } from '@/lib/englishLearning';
import { numericIdSchema } from '@/server/infra/http/idSchemas';

export const vocabularyCreateSchema = z.object({
  articleId: numericIdSchema,
  term: z.string().trim().max(200).transform(cleanVocabularyTerm).refine(
    (term) => countEnglishWords(term) >= 1 && countEnglishWords(term) <= 3,
    '请选择 1–3 个英文词',
  ),
  definition: z.string().trim().max(10_000).default(''),
  sourceSentence: z.string().trim().min(1).max(ENGLISH_LEARNING_MAX_TEXT_LENGTH),
});

export const vocabularyUpdateSchema = z.object({
  definition: z.string().trim().max(10_000),
});

const sentenceListSchema = z.array(z.string().trim().min(1).max(ENGLISH_LEARNING_MAX_TEXT_LENGTH))
  .min(1).max(100)
  .refine((sentences) => sentences.join('\n').length <= ENGLISH_LEARNING_MAX_TEXT_LENGTH,
    '所选句子过长，请缩小选区');

export const englishLearningSchema = z.object({
  selectedText: z.string().trim().min(1).max(ENGLISH_LEARNING_MAX_TEXT_LENGTH).refine(
    (text) => countEnglishWords(text) >= 4, '请选择至少 4 个英文词',
  ),
  sentences: sentenceListSchema,
  /** 旧客户端不传语境，服务端按无语境降级处理。 */
  context: z.string().trim().max(ENGLISH_LEARNING_MAX_TEXT_LENGTH).default(''),
});

export const wordDetailSchema = z.object({
  term: z.string().trim().max(200).transform(cleanVocabularyTerm).refine(
    (term) => countEnglishWords(term) >= 1 && countEnglishWords(term) <= 3,
    '请选择 1–3 个英文词',
  ),
  selectedText: z.string().trim().max(ENGLISH_LEARNING_MAX_TEXT_LENGTH).default(''),
  sentences: sentenceListSchema,
  context: z.string().trim().max(ENGLISH_LEARNING_MAX_TEXT_LENGTH).default(''),
});

export function inputErrorFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    fields[key] ??= issue.message;
  }
  return fields;
}
