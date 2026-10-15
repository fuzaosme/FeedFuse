import { z } from 'zod';

export const dictionaryIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, '词典 ID 不正确');

export const dictionaryInstallSchema = z.object({
  id: dictionaryIdSchema,
});

export const customDictionaryInstallSchema = z.object({
  sourceUrl: z.string().trim().url('请输入完整的 http(s) 链接').max(2048),
});

export const dictionaryPatchSchema = z.object({
  enabled: z.boolean(),
});

export const dictionaryLookupQuerySchema = z.object({
  term: z.string().trim().min(1).max(200),
});
