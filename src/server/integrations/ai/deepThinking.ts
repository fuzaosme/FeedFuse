const THINK_BLOCK_RES = [
  /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /<thought(?:s)?>[\s\S]*?<\/thought(?:s)?>/gi,
  /<analysis>[\s\S]*?<\/analysis>/gi,
  /```thinking[\s\S]*?```/gi,
] as const;
const OPEN_THINK_TAIL_RES = [
  /<think(?:ing)?>[\s\S]*$/i,
  /<reasoning>[\s\S]*$/i,
  /<thought(?:s)?>[\s\S]*$/i,
  /<analysis>[\s\S]*$/i,
  /```thinking[\s\S]*$/i,
] as const;
const STRAY_THINK_TAG_RE = /<\/?(?:think(?:ing)?|reasoning|thoughts?)>/gi;
const THINK_TAGS = [
  '<think>', '</think>', '<thinking>', '</thinking>',
  '<reasoning>', '</reasoning>', '<thought>', '</thought>', '<thoughts>', '</thoughts>',
  '<analysis>', '</analysis>', '```thinking',
] as const;
// 常见“先思考后作答”模型的行首思考前缀：整行都是思考标记时直接丢掉，
// 行内混排时只清前缀、保留正文，避免误删答案。
const THINK_PREFIX_LINE_RE = /^(?:思考过程|思维链|推理过程|解题思路|thinking|reasoning|chain-?of-?thought)\s*[:：].*$/gim;

function stripPartialThinkingTagTail(value: string): string {
  const lower = value.toLowerCase();

  for (const tag of THINK_TAGS) {
    for (let length = Math.min(tag.length - 1, lower.length); length > 0; length -= 1) {
      if (lower.endsWith(tag.slice(0, length))) {
        return value.slice(0, -length);
      }
    }
  }

  return value;
}

function sanitizeThinkingText(value: string): string {
  let next = stripPartialThinkingTagTail(value);
  for (const re of THINK_BLOCK_RES) {
    next = next.replace(re, '');
  }
  for (const re of OPEN_THINK_TAIL_RES) {
    next = next.replace(re, '');
  }
  next = next.replace(STRAY_THINK_TAG_RE, '').replace(THINK_PREFIX_LINE_RE, '');
  return stripPartialThinkingTagTail(next);
}

export function stripThinkingText(value: string): string {
  return sanitizeThinkingText(value).trim();
}

export function buildFinalOnlySystemPrompt(basePrompt: string, enabled: boolean, fast = false): string {
  if (!enabled) {
    return basePrompt;
  }

  const instruction = fast ? '直接输出最终结果' : '请先充分思考，再只输出最终结果';
  return `${basePrompt}\n\n${instruction}，不要输出思考过程、推理步骤、思维链、<think> 标签或额外分析。`;
}

export function createThinkingDeltaFilter() {
  let rawText = '';
  let visibleText = '';

  return {
    push(chunk: string): string {
      rawText += chunk;
      const nextVisibleText = sanitizeThinkingText(rawText);

      if (!nextVisibleText.startsWith(visibleText)) {
        // 思考块闭合导致已发送前缀被整体过滤掉（例如之前误发了块内文本）：
        // SSE 客户端只能累加、无法撤回，这里吞掉回退差量避免前端重复拼接，
        // 最终以 learning.done 定稿（getVisibleText）为准校准全文。
        visibleText = nextVisibleText;
        return '';
      }

      const delta = nextVisibleText.slice(visibleText.length);
      visibleText = nextVisibleText;
      return delta;
    },
    getVisibleText(): string {
      return stripThinkingText(visibleText);
    },
  };
}
