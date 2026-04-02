import { CHAT_WELCOME_MESSAGE } from '../../app/constants';
import { normalizeUrl } from '../platforms/platformUtils';
import type { ChatMessage, ChatSession, ThinkingDepth } from '../../types/app';

export interface ModelContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SUMMARY_MAX_MESSAGES = 12;
const SUMMARY_KEEP_RECENT_MESSAGES = 6;
const SUMMARY_MAX_CHARS = 6000;
const DEFAULT_RESPONSE_LANGUAGE_PROMPT = '请始终使用中文回复。';

function joinBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/$/, '');
}

export function buildChatApiUrl(baseUrl: string) {
  const normalized = joinBaseUrl(normalizeUrl(baseUrl));
  if (!normalized) return '';
  if (/\/(v\d+\/)?chat\/completions$/.test(normalized)) return normalized;
  if (/\/(v\d+\/)?responses$/.test(normalized)) return normalized.replace(/responses$/, 'chat/completions');
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

export function buildResponsesApiUrl(baseUrl: string) {
  const normalized = joinBaseUrl(normalizeUrl(baseUrl));
  if (!normalized) return '';
  if (/\/(v\d+\/)?responses$/.test(normalized)) return normalized;
  if (/\/(v\d+\/)?chat\/completions$/.test(normalized)) return normalized.replace(/chat\/completions$/, 'responses');
  if (/\/v\d+$/.test(normalized)) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

export function buildChatCompletionsPayload(messages: ModelContextMessage[], model: string) {
  return {
    model,
    messages: messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
    stream: true,
    temperature: 0.7,
  };
}

export function buildResponsesPayload(messages: ModelContextMessage[], model: string, reasoningEffort?: ThinkingDepth) {
  return {
    model,
    input: messages.map(message => ({
      role: message.role,
      content: [
        {
          type: 'input_text',
          text: message.content,
        }
      ]
    })),
    stream: true,
    temperature: 0.7,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };
}

export function parseSseEventChunks(rawText: string) {
  return rawText
    .split(/\n\n+/)
    .map(block => block
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
    .join('\n'))
    .filter(Boolean);
}

export function parseSseEventBuffer(rawText: string) {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\n+/);
  const hasTerminatingSeparator = /\n\n\s*$/.test(normalized);
  const remainder = hasTerminatingSeparator ? '' : (blocks.pop() ?? '');

  return {
    events: blocks
      .map(block => block
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n'))
      .filter(Boolean),
    remainder,
  };
}

export function extractStreamingDelta(payload: unknown) {
  const data = payload as {
    choices?: Array<{ delta?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    delta?: string;
    output_text?: string;
  };

  const choiceDelta = data?.choices?.[0]?.delta?.content;
  if (typeof choiceDelta === 'string') return choiceDelta;
  if (Array.isArray(choiceDelta)) {
    return choiceDelta
      .map(item => (item?.type === 'text' || !item?.type ? item?.text ?? '' : ''))
      .join('');
  }

  if (typeof data?.delta === 'string') return data.delta;
  if (typeof data?.output_text === 'string') return data.output_text;
  return '';
}

export function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;

  const maybePayload = payload as {
    error?: { message?: string; code?: string | number } | string;
    message?: string;
    detail?: string;
  };

  if (typeof maybePayload.error === 'string') return maybePayload.error;
  if (typeof maybePayload.error?.message === 'string') return maybePayload.error.message;
  if (typeof maybePayload.message === 'string') return maybePayload.message;
  if (typeof maybePayload.detail === 'string') return maybePayload.detail;
  return fallback;
}

export function extractAssistantReply(payload: unknown) {
  const data = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; delta?: { content?: string } }>;
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  const choiceContent = data?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.trim()) return choiceContent.trim();
  if (Array.isArray(choiceContent)) {
    const text = choiceContent
      .map(item => (item?.type === 'text' || !item?.type ? item?.text ?? '' : ''))
      .join('')
      .trim();
    if (text) return text;
  }

  const deltaContent = data?.choices?.[0]?.delta?.content;
  if (typeof deltaContent === 'string' && deltaContent.trim()) return deltaContent.trim();

  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  const outputText = data?.output
    ?.flatMap(item => item.content ?? [])
    .map(item => (item?.type === 'text' || !item?.type ? item?.text ?? '' : ''))
    .join('')
    .trim();
  if (outputText) return outputText;

  return '';
}

export function createChatSession(title = '新会话'): ChatSession {
  const now = Date.now();
  return {
    id: `chat-session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [CHAT_WELCOME_MESSAGE],
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveChatSessionTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  return normalized.slice(0, 18);
}

function normalizeSnippet(content: string, maxLength = 180) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function shouldCompressChatHistory(messages: ChatMessage[]) {
  const effectiveMessages = messages.filter(message => message.id !== CHAT_WELCOME_MESSAGE.id);
  const totalChars = effectiveMessages.reduce((sum, message) => sum + message.content.length, 0);
  return effectiveMessages.length > SUMMARY_MAX_MESSAGES || totalChars > SUMMARY_MAX_CHARS;
}

export function summarizeOlderMessages(messages: ChatMessage[]) {
  const effectiveMessages = messages.filter(message => message.id !== CHAT_WELCOME_MESSAGE.id);
  if (!shouldCompressChatHistory(effectiveMessages)) {
    return {
      summary: '',
      summarizedMessageCount: 0,
      summarySignature: '',
    };
  }

  const summarizedMessageCount = Math.max(0, effectiveMessages.length - SUMMARY_KEEP_RECENT_MESSAGES);
  const olderMessages = effectiveMessages.slice(0, summarizedMessageCount);
  const summaryLines = olderMessages
    .map(message => {
      const prefix = message.role === 'user' ? '用户' : '助手';
      const snippet = normalizeSnippet(message.content);
      return snippet ? `- ${prefix}：${snippet}` : '';
    })
    .filter(Boolean)
    .slice(-10);

  return {
    summary: summaryLines.length > 0
      ? `以下是更早对话的摘要，请在后续回答中延续这些上下文：\n${summaryLines.join('\n')}`
      : '',
    summarizedMessageCount,
    summarySignature: olderMessages
      .map(message => `${message.id}:${message.role}:${normalizeSnippet(message.content, 80)}`)
      .join('|'),
  };
}

export function buildModelContextMessages(session: ChatSession, messages: ChatMessage[]): ModelContextMessage[] {
  const safeMessages = messages.filter(message => message.status !== 'streaming' && message.id !== CHAT_WELCOME_MESSAGE.id);
  const summary = session.summary?.trim();
  const summarizedCount = Math.min(session.summarizedMessageCount ?? 0, safeMessages.length);
  const recentMessages = safeMessages.slice(summarizedCount);

  return [
    { role: 'system' as const, content: DEFAULT_RESPONSE_LANGUAGE_PROMPT },
    ...(summary ? [{ role: 'system' as const, content: summary }] : []),
    ...recentMessages.map(message => ({
      role: message.role,
      content: message.content,
    })),
  ];
}
