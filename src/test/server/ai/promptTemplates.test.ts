import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGLISH_LEARNING_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  DEFAULT_WORD_DETAIL_PROMPT,
} from '@/lib/aiPromptDefaults';
import {
  resolveEnglishLearningPrompt,
  resolveSummaryPrompt,
} from '@/server/integrations/ai/promptTemplates';

describe('promptTemplates', () => {
  it('空提示词回退到内置默认模板', () => {
    expect(resolveSummaryPrompt('')).toBe(DEFAULT_SUMMARY_PROMPT);
    expect(resolveSummaryPrompt(undefined)).toBe(DEFAULT_SUMMARY_PROMPT);
    expect(resolveSummaryPrompt('   ')).toBe(DEFAULT_SUMMARY_PROMPT);
    expect(resolveEnglishLearningPrompt('')).toBe(DEFAULT_ENGLISH_LEARNING_PROMPT);
  });

  it('自定义提示词优先于内置模板', () => {
    expect(resolveSummaryPrompt('自定义摘要')).toBe('自定义摘要');
    expect(resolveEnglishLearningPrompt('自定义讲解')).toBe('自定义讲解');
  });

  it('句子讲解模板要求结合语境分析', () => {
    expect(DEFAULT_ENGLISH_LEARNING_PROMPT).toContain('语境');
  });

  it('详细解释模板是独立的单词用法模板', () => {
    expect(DEFAULT_WORD_DETAIL_PROMPT).toContain('语境用法详解');
    expect(DEFAULT_WORD_DETAIL_PROMPT).not.toBe(DEFAULT_ENGLISH_LEARNING_PROMPT);
    expect(DEFAULT_WORD_DETAIL_PROMPT).not.toContain('英语精读助手');
  });

  it('摘要与翻译模板保持原有的可编辑文案', () => {
    expect(DEFAULT_SUMMARY_PROMPT).toContain('中文摘要助手');
    expect(DEFAULT_TRANSLATION_PROMPT).toContain('翻译助手');
  });
});
