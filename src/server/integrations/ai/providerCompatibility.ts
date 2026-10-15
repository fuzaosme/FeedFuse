import OpenAI from 'openai';
import { stripThinkingText } from '@/server/integrations/ai/deepThinking';

const DEEPSEEK_HOST_RE = /(^|\.)deepseek\.com$/i;

type ChatRequest = OpenAI.Chat.ChatCompletionCreateParams;
type StreamingChatRequest = OpenAI.Chat.ChatCompletionCreateParamsStreaming;
type NonStreamingChatRequest = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

interface StreamChunkLike {
  choices?: Array<{
    delta?: {
      content?: unknown;
      // 注意：reasoning_content 是思维链专用通道，必须永远丢弃、绝不能拼进正文，
      // 否则思考过程会直接外露给用户。这里声明出来就是为了明确“已处理（忽略）”。
      reasoning_content?: unknown;
    };
  }>;
}

interface AssistantMessageLike {
  content?: unknown;
  reasoning_content?: unknown;
}

function getProviderHostname(apiBaseUrl: string): string {
  try {
    return new URL(apiBaseUrl).hostname;
  } catch {
    return '';
  }
}

function isDeepSeekProvider(apiBaseUrl: string): boolean {
  const hostname = getProviderHostname(apiBaseUrl);
  // 只按 provider host 判断，避免把第三方 OpenAI-compatible 网关误判成原生 DeepSeek。
  return DEEPSEEK_HOST_RE.test(hostname);
}

export function applyProviderThinkingConfig<T extends StreamingChatRequest>(input: {
  apiBaseUrl: string;
  model: string;
  deepThinkingEnabled: boolean;
  /**
   * 精读等低延迟链路强制走快速通道：无视 deepThinkingEnabled，
   * 按服务商能力关闭思考，不向未知兼容接口发送推理参数。
   */
  forceFast?: boolean;
  request: T;
}): T;
export function applyProviderThinkingConfig<T extends NonStreamingChatRequest>(input: {
  apiBaseUrl: string;
  model: string;
  deepThinkingEnabled: boolean;
  /**
   * 精读等低延迟链路强制走快速通道：无视 deepThinkingEnabled，
   * 按服务商能力关闭思考，不向未知兼容接口发送推理参数。
   */
  forceFast?: boolean;
  request: T;
}): T;
export function applyProviderThinkingConfig<T extends ChatRequest>(input: {
  apiBaseUrl: string;
  model: string;
  deepThinkingEnabled: boolean;
  /**
   * 精读等低延迟链路强制走快速通道：无视 deepThinkingEnabled，
   * 按服务商能力关闭思考，不向未知兼容接口发送推理参数。
   */
  forceFast?: boolean;
  request: T;
}): T {
  const request = { ...input.request } as T;
  const extra = request as T & Record<string, unknown>;
  if (isDeepSeekProvider(input.apiBaseUrl)) {
    const thinking = !input.forceFast && input.deepThinkingEnabled;
    extra.thinking = { type: thinking ? 'enabled' : 'disabled' };
    request.reasoning_effort = thinking ? 'high' : 'none';
    if (thinking) {
      delete request.temperature;
      delete request.top_p;
      delete request.presence_penalty;
      delete request.frequency_penalty;
    }
    return request;
  }
  if (input.forceFast) {
    delete extra.thinking;
    delete request.reasoning_effort;
    const hostname = getProviderHostname(input.apiBaseUrl);
    if (/(^|\.)dashscope\.aliyuncs\.com$/i.test(hostname)) {
      extra.enable_thinking = false;
    } else if (hostname === 'api.openai.com') {
      // 推理档位随模型变化；普通 GPT-4 系列不支持 reasoning_effort。
      if (/^gpt-5(?:[.-]|$)/i.test(input.model) && !/-(?:chat|pro)(?:-|$)/i.test(input.model)) {
        request.reasoning_effort = /^gpt-5(?:-(?:mini|nano)|$|-(?:20\d{2}))/i.test(input.model)
          ? 'minimal' : 'none';
      } else if (/^(?:gpt-6|o[134])(?:[.-]|$)/i.test(input.model)) {
        request.reasoning_effort = 'low';
      }
      if (request.reasoning_effort) {
        delete request.temperature;
        delete request.top_p;
        if (request.max_tokens !== undefined) {
          extra.max_completion_tokens = request.max_tokens;
          delete request.max_tokens;
        }
      }
    }
    return request;
  }
  if (!input.deepThinkingEnabled) {
    return request;
  }

  request.reasoning_effort = 'high';
  return request;
}

function readOptionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function extractAssistantText(message: AssistantMessageLike | null | undefined): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = readOptionalText((message as AssistantMessageLike).content).trim();
  if (content) {
    return stripThinkingText(content);
  }

  const reasoningContent = readOptionalText(
    (message as AssistantMessageLike).reasoning_content,
  ).trim();
  return stripThinkingText(reasoningContent);
}

export function extractStreamTextDelta(chunk: StreamChunkLike): string {
  const delta = chunk.choices?.[0]?.delta;
  // 只取 content；reasoning_content（思维链）一律丢弃，绝不能外露。
  // 混在 content 里的 <think> 等标签由 createThinkingDeltaFilter / stripThinkingText 处理。
  return typeof delta?.content === 'string' ? delta.content : '';
}
