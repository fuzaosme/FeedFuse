import { describe, expect, it } from 'vitest';
import { completeLearningSelection, isGlueWord, resolveLookupPlan, resolveSelectionMode, type SelectionPiece } from '@/features/english-learning/utils/lookupTerms';
import type { LearningSelection } from '@/features/english-learning/utils/selection';
import { countEnglishWords } from '@/lib/englishLearning';

function piece(context: string, selected: string): SelectionPiece {
  const start = context.indexOf(selected);
  if (start < 0) throw new Error(`selection "${selected}" not found in "${context}"`);
  return { text: selected, context, start, end: start + selected.length };
}

function plan(context: string, selected: string) {
  return resolveLookupPlan([piece(context, selected)]);
}

function selection(context: string, selected = context): LearningSelection {
  return {
    pieces: [piece(context, selected)], selectedText: selected, wordCount: countEnglishWords(selected),
    sentences: [context], rect: { left: 0, right: 10, top: 0, bottom: 10 },
  };
}

describe('isGlueWord', () => {
  it('仍识别功能词，但不据此跳过用户选择', () => {
    for (const word of ['that', 'of', 'is', 'very', 'There']) expect(isGlueWord(word)).toBe(true);
    for (const word of ['arguing', 'quickly', 'Chinese']) expect(isGlueWord(word)).toBe(false);
  });
});

describe('resolveLookupPlan', () => {
  it.each([
    ['arguing that', 'uing th', 'arguing that', ['arguing', 'that']],
    ['arguing quickly', 'uing quickl', 'arguing quickly', ['arguing', 'quickly']],
    ['that arguing', 'hat argui', 'that arguing', ['that', 'arguing']],
    ['arguing that', 'uing that', 'arguing that', ['arguing', 'that']],
    ['give up now', 'ive u', 'give up', ['give']],
    ['in spite of that', 'n spite o', 'in spite of', ['spite']],
    ['arguing that quickly', 'uing that quickl', 'arguing that quickly', ['arguing', 'that', 'quickly']],
  ])('补全后优先尝试整个词组：%s / %s', (context, selected, phrase, fallbackTerms) => {
    expect(plan(context, selected)).toEqual({ terms: [phrase], fallbackTerms });
  });

  it.each([
    ['arguing q', ['arguing']],
    ['g quickly', ['quickly']],
    ['arguing qu', ['arguing', 'quickly']],
    ['ng quickly', ['arguing', 'quickly']],
    ['g q', ['arguing', 'quickly']],
  ])('仅忽略最多一个字母的边缘词：%s', (selected, fallbackTerms) => {
    expect(plan('arguing quickly', selected)).toEqual({ terms: ['arguing quickly'], fallbackTerms });
  });

  it.each([
    ['arguing', 'rguin', 'arguing'],
    ['arguing', 'g', 'arguing'],
    ['arguing that', 'that', 'that'],
    ['of which', 'whic', 'which'],
    ['military’s power', 'military’s', 'military'],
    ["military's power", "military's", 'military'],
    ['military’s power', 'itary’s', 'military'],
    ["it's fine", "it's", "it's"],
    ["don't stop", "don't", "don't"],
    ['soldiers’ equipment', 'soldiers’', 'soldiers'],
  ])('单词与所有格：%s / %s', (context, selected, term) => {
    expect(plan(context, selected)).toEqual({ terms: [term], fallbackTerms: [] });
  });

  it.each([
    ['give up', ['give', 'up']],
    ['Chinese company', ['Chinese', 'company']],
    ['as well as', ['as', 'well']],
    ['of the', ['of', 'the']],
    ['company and company', ['company', 'and']],
    ['had had', ['had']],
  ])('完整词组回退保留功能词并按原文顺序去重：%s', (phrase, fallbackTerms) => {
    expect(plan(phrase, phrase)).toEqual({ terms: [phrase], fallbackTerms });
  });

  it('不能跨标点拼出词组，也不跳过选到两个字母的功能词', () => {
    expect(plan('arguing, that.', 'uing, th')).toEqual({ terms: ['arguing', 'that'], fallbackTerms: [] });
  });

  it('跨段落不能拼出不存在的词组', () => {
    expect(resolveLookupPlan([piece('arguing', 'arguing'), piece('that', 'that')]))
      .toEqual({ terms: ['arguing', 'that'], fallbackTerms: [] });
  });
});

describe('resolveSelectionMode', () => {
  it.each([
    ["I don't know.", "I don't know.", 'sentence'],
    ['Go now.', 'Go now.', 'sentence'],
    ['Hello.', 'Hello', 'word'],
    ['as a result of the change', 'as a result of', 'phrase-or-sentence'],
    ['in spite of that problem', 'in spite of t', 'word'],
    ['in spite of that problem', 'in spite of th', 'phrase-or-sentence'],
    ['The team kept arguing about the plan for hours.', 'kept arguing about the plan', 'phrase-or-sentence'],
    ['one two three four five six seven eight', 'one two three four five six seven', 'sentence'],
  ])('按完整句子、有效选词和词组候选决定模式：%s / %s', (context, selected, mode) => {
    expect(resolveSelectionMode(selection(context, selected))).toBe(mode);
  });

  it('跨句和跨段直接讲解', () => {
    const value = selection('The team changed its plan. Investors agreed.');
    value.sentences = ['The team changed its plan.', 'Investors agreed.'];
    expect(resolveSelectionMode(value)).toBe('sentence');
    value.pieces = [piece('The team changed its plan.', 'plan'), piece('Investors agreed.', 'Investors')];
    expect(resolveSelectionMode(value)).toBe('sentence');
  });
});

describe('completeLearningSelection', () => {
  it.each([
    ['arguing quickly', 'uing quickl', 'arguing quickly'],
    ['in spite of that', 'n spite of t', 'spite of'],
    ['arguing quickly', 'arguing q', 'arguing'],
    ['arguing quickly', 'arguing qu', 'arguing quickly'],
    ['arguing quickly', 'g quickly', 'quickly'],
    ['The team agreed.', 'he team agree', 'The team agreed'],
  ])('给 AI 的文本补全整词且去除一个字母的越界：%s / %s', (context, selected, expected) => {
    const result = completeLearningSelection(selection(context, selected));
    expect(result.selectedText).toBe(expected);
    expect(result.pieces[0].context.slice(result.pieces[0].start, result.pieces[0].end)).toBe(expected);
    expect(result.wordCount).toBe(countEnglishWords(expected));
  });
});
