import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_WELCOME_MESSAGE } from '../app/constants';
import {
  buildModelContextMessages,
  buildChatApiUrl,
  buildChatCompletionsPayload,
  buildResponsesApiUrl,
  buildResponsesPayload,
  createChatSession,
  deriveChatSessionTitle,
  extractAssistantReply,
  extractErrorMessage,
  extractStreamingDelta,
  parseSseEventBuffer,
  parseSseEventChunks,
  summarizeOlderMessages,
} from '../features/ai-chat/chatApi';
import { normalizeUrl } from '../features/platforms/platformUtils';
import type { AiProviderSettings, ChatMessage, ChatSession, PersistedChatHistory, ThinkingDepth } from '../types/app';

interface UseAiChatOptions {
  aiProvider: AiProviderSettings;
  speechRate: number;
  persistedHistory?: PersistedChatHistory | null;
  historyLoaded?: boolean;
  onHistoryChange?: (history: PersistedChatHistory) => void;
}

interface SendChatOptions {
  reasoningEffort?: ThinkingDepth;
  attachmentContext?: string;
  overrideContent?: string;
}

interface RunModelRequestOptions {
  sessionId: string;
  sessionSnapshot: ChatSession;
  nextMessages: ChatMessage[];
  assistantId: string;
  reasoningEffort?: ThinkingDepth;
}

function joinBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/$/, '');
}

function sanitizeChatMessage(message: ChatMessage): ChatMessage | null {
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
    return null;
  }

  const isStreaming = message.status === 'streaming';
  const content = typeof message.content === 'string' ? message.content : '';
  const normalizedContent = isStreaming && (!content.trim() || content === '正在思考中…')
    ? '上一次回复未完成，请重试。'
    : content;

  return {
    id: message.id || `message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: message.role,
    content: normalizedContent,
    status: isStreaming ? 'error' : (message.status === 'error' ? 'error' : undefined),
  };
}

function sanitizeChatSession(session: ChatSession): ChatSession {
  const messages = Array.isArray(session.messages) && session.messages.length > 0
    ? session.messages
      .map(sanitizeChatMessage)
      .filter((message): message is ChatMessage => Boolean(message))
    : [CHAT_WELCOME_MESSAGE];

  const hasWelcomeMessage = messages.some(message => message.id === CHAT_WELCOME_MESSAGE.id);

  return {
    id: session.id || `chat-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: session.title?.trim() || '新会话',
    messages: hasWelcomeMessage ? messages : [CHAT_WELCOME_MESSAGE, ...messages],
    createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
    summary: typeof session.summary === 'string' ? session.summary : '',
    summarizedMessageCount: typeof session.summarizedMessageCount === 'number' ? session.summarizedMessageCount : 0,
    summaryUpdatedAt: typeof session.summaryUpdatedAt === 'number' ? session.summaryUpdatedAt : undefined,
    summarySignature: typeof session.summarySignature === 'string' ? session.summarySignature : '',
    summaryMode: session.summaryMode === 'hybrid' ? 'hybrid' : (session.summaryMode === 'local' ? 'local' : undefined),
    summaryModelId: typeof session.summaryModelId === 'string' ? session.summaryModelId : '',
  };
}

function normalizePersistedHistory(persistedHistory?: PersistedChatHistory | null): PersistedChatHistory | null {
  if (!persistedHistory || !Array.isArray(persistedHistory.sessions)) return null;

  const sessions = persistedHistory.sessions.map(sanitizeChatSession);
  if (sessions.length === 0) return null;

  const activeSessionId = sessions.some(session => session.id === persistedHistory.activeSessionId)
    ? persistedHistory.activeSessionId
    : sessions[0].id;

  return {
    sessions,
    activeSessionId,
  };
}

function createPersistedHistorySnapshot(
  chatSessions: ChatSession[],
  activeChatSessionId: string
): PersistedChatHistory | null {
  return normalizePersistedHistory({
    sessions: chatSessions,
    activeSessionId: activeChatSessionId,
  });
}

export function useAiChat({
  aiProvider,
  speechRate,
  persistedHistory,
  historyLoaded = false,
  onHistoryChange,
}: UseAiChatOptions) {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatCopyState, setChatCopyState] = useState<Record<string, 'success' | 'error'>>({});
  const [chatSpeakingId, setChatSpeakingId] = useState<string | null>(null);
  const hasHydratedPersistedHistoryRef = useRef(false);

  const activeChatSession = useMemo(
    () => chatSessions.find(session => session.id === activeChatSessionId) ?? null,
    [chatSessions, activeChatSessionId]
  );

  const activeChatMessages = activeChatSession?.messages ?? [CHAT_WELCOME_MESSAGE];

  const updateChatSession = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setChatSessions(prev => prev.map(session => (
      session.id === sessionId
        ? updater(session)
        : session
    )));
  };

  const createSession = () => {
    const nextSession = createChatSession();
    setChatSessions(prev => [nextSession, ...prev]);
    setActiveChatSessionId(nextSession.id);
    setChatError('');
    setChatInput('');
  };

  const resetActiveSession = () => {
    if (!activeChatSessionId) return;

    updateChatSession(activeChatSessionId, session => ({
      ...session,
      title: '新会话',
      messages: [CHAT_WELCOME_MESSAGE],
      summary: '',
      summarizedMessageCount: 0,
      summaryUpdatedAt: undefined,
      summarySignature: '',
      summaryMode: undefined,
      summaryModelId: '',
      updatedAt: Date.now(),
    }));
    setChatError('');
  };

  const copyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setChatCopyState(prev => ({ ...prev, [messageId]: 'success' }));
    } catch {
      setChatCopyState(prev => ({ ...prev, [messageId]: 'error' }));
    } finally {
      window.setTimeout(() => {
        setChatCopyState(prev => {
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
      }, 1600);
    }
  };

  const speakMessage = (messageId: string, content: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setChatError('当前环境不支持浏览器朗读。');
      return;
    }

    const synth = window.speechSynthesis;
    const text = content.trim();
    if (!text) return;

    if (chatSpeakingId === messageId) {
      synth.cancel();
      setChatSpeakingId(null);
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = Math.min(Math.max(speechRate, 0.5), 2);
    utterance.lang = 'zh-CN';
    utterance.onend = () => setChatSpeakingId(current => (current === messageId ? null : current));
    utterance.onerror = () => {
      setChatSpeakingId(current => (current === messageId ? null : current));
      setChatError('朗读失败，请检查浏览器语音能力是否可用。');
    };

    setChatError('');
    setChatSpeakingId(messageId);
    synth.speak(utterance);
  };

  const applyAssistantDelta = (sessionId: string, assistantId: string, reply: string) => {
    updateChatSession(sessionId, session => ({
      ...session,
      messages: session.messages.map(message => (
        message.id === assistantId
          ? { ...message, content: reply, status: 'streaming' }
          : message
      )),
      updatedAt: Date.now(),
    }));
  };

  const consumeResponseStream = async (
    response: Response,
    sessionId: string,
    assistantId: string
  ) => {
    const contentType = response.headers.get('content-type') || '';
    const reader = response.body?.getReader();
    let rawText = '';
    let payload: unknown = null;
    let currentReply = '';

    const processSseEvents = (events: string[]) => {
      for (const eventData of events) {
        if (eventData === '[DONE]') break;
        try {
          const eventPayload = JSON.parse(eventData) as unknown;
          const delta = extractStreamingDelta(eventPayload);
          if (delta) {
            currentReply += delta;
            applyAssistantDelta(sessionId, assistantId, currentReply);
          }
          payload = eventPayload;
        } catch (parseError) {
          console.warn('[AnyBrain][AI] failed to parse sse chunk', eventData, parseError);
        }
      }
    };

    if (!reader) {
      rawText = await response.text();
      const isSseFallback = contentType.includes('text/event-stream') || rawText.includes('data:');
      if (isSseFallback) {
        processSseEvents(parseSseEventChunks(rawText));
      } else {
        try {
          payload = rawText ? JSON.parse(rawText) : null;
        } catch {
          payload = rawText;
        }
        currentReply = typeof payload === 'string'
          ? payload.trim()
          : extractAssistantReply(payload);
      }

      return { contentType, rawText, payload, currentReply };
    }

    const decoder = new TextDecoder();
    let sseBuffer = '';
    let isSseResponse = contentType.includes('text/event-stream');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;

      if (isSseResponse) {
        sseBuffer += chunk;
      } else if (rawText.includes('data:')) {
        isSseResponse = true;
        sseBuffer = rawText;
      }

      if (isSseResponse) {
        const { events, remainder } = parseSseEventBuffer(sseBuffer);
        sseBuffer = remainder;
        processSseEvents(events);
      }
    }

    const tail = decoder.decode();
    if (tail) {
      rawText += tail;
      if (isSseResponse) {
        sseBuffer += tail;
      }
    }

    if (isSseResponse) {
      if (sseBuffer.trim()) {
        processSseEvents(parseSseEventChunks(sseBuffer));
      }
    } else {
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = rawText;
      }
      currentReply = typeof payload === 'string'
        ? payload.trim()
        : extractAssistantReply(payload);
    }

    return { contentType, rawText, payload, currentReply };
  };

  const buildHybridSummaryPrompt = (messages: ChatMessage[], localSummary: string) => {
    const effectiveMessages = messages.filter(message => message.id !== CHAT_WELCOME_MESSAGE.id);
    const summarizedMessageCount = Math.max(0, effectiveMessages.length - 6);
    const olderMessages = effectiveMessages.slice(0, summarizedMessageCount);
    const transcript = olderMessages
      .map(message => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
      .join('\n\n')
      .slice(0, 12000);

    return [
      '你是一个对话上下文压缩助手。',
      '请把以下较早的对话压缩成一段简洁中文摘要，用于后续继续对话。',
      '保留：用户目标、明确约束、已完成修改、未完成事项、关键错误、重要决定。',
      '不要输出标题、不要解释你的过程、不要使用 markdown 列表。',
      '',
      '当前本地规则摘要：',
      localSummary || '无',
      '',
      '较早对话原文：',
      transcript || '无',
    ].join('\n');
  };

  const generateHybridSummary = async (messages: ChatMessage[], localSummary: string): Promise<string> => {
    const compressionModelId = aiProvider.compressionModelId.trim();
    if (!compressionModelId || !aiProvider.baseUrl.trim() || !aiProvider.apiKey.trim()) {
      return localSummary;
    }

    const completionUrl = buildChatApiUrl(aiProvider.baseUrl);
    const responsesUrl = buildResponsesApiUrl(aiProvider.baseUrl);
    const rawBaseUrl = joinBaseUrl(normalizeUrl(aiProvider.baseUrl));
    const preferResponses = /\/(v\d+\/)?responses$/.test(rawBaseUrl);
    const prompt = buildHybridSummaryPrompt(messages, localSummary);
    const requestPlans = preferResponses
      ? [
        {
          url: responsesUrl,
          body: {
            model: compressionModelId,
            input: [
              {
                role: 'system',
                content: [{ type: 'input_text', text: '请输出一段精炼中文摘要。' }],
              },
              {
                role: 'user',
                content: [{ type: 'input_text', text: prompt }],
              }
            ],
            stream: false,
            temperature: 0.2,
          }
        },
        {
          url: completionUrl,
          body: {
            model: compressionModelId,
            messages: [
              { role: 'system', content: '请输出一段精炼中文摘要。' },
              { role: 'user', content: prompt },
            ],
            stream: false,
            temperature: 0.2,
          }
        }
      ]
      : [
        {
          url: completionUrl,
          body: {
            model: compressionModelId,
            messages: [
              { role: 'system', content: '请输出一段精炼中文摘要。' },
              { role: 'user', content: prompt },
            ],
            stream: false,
            temperature: 0.2,
          }
        },
        {
          url: responsesUrl,
          body: {
            model: compressionModelId,
            input: [
              {
                role: 'system',
                content: [{ type: 'input_text', text: '请输出一段精炼中文摘要。' }],
              },
              {
                role: 'user',
                content: [{ type: 'input_text', text: prompt }],
              }
            ],
            stream: false,
            temperature: 0.2,
          }
        }
      ];

    let lastError = '';
    for (const plan of requestPlans) {
      try {
        const response = await fetch(plan.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiProvider.apiKey.trim()}`,
          },
          body: JSON.stringify(plan.body),
        });
        const rawText = await response.text();
        let payload: unknown = null;
        try {
          payload = rawText ? JSON.parse(rawText) : null;
        } catch {
          payload = rawText;
        }

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, rawText || `摘要压缩失败（${response.status}）`));
        }

        const reply = typeof payload === 'string'
          ? payload.trim()
          : extractAssistantReply(payload);
        if (reply) return reply.trim();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (lastError) {
      console.warn('[AnyBrain][AI] hybrid summary fallback to local', lastError);
    }
    return localSummary;
  };

  const resolveSessionSummary = async (session: ChatSession, messages: ChatMessage[]): Promise<ChatSession> => {
    const nextSummaryState = summarizeOlderMessages(messages);
    const compressionModelId = aiProvider.compressionModelId.trim();
    const nextSessionBase: ChatSession = {
      ...session,
      summary: nextSummaryState.summary,
      summarizedMessageCount: nextSummaryState.summarizedMessageCount,
      summaryUpdatedAt: nextSummaryState.summary ? Date.now() : undefined,
      summarySignature: nextSummaryState.summarySignature,
      summaryMode: nextSummaryState.summary ? 'local' : undefined,
      summaryModelId: nextSummaryState.summary ? '' : '',
    };

    if (!nextSummaryState.summary) {
      return {
        ...nextSessionBase,
        summaryMode: undefined,
        summaryModelId: '',
      };
    }

    if (
      compressionModelId &&
      session.summary &&
      session.summarySignature === nextSummaryState.summarySignature &&
      session.summaryMode === 'hybrid' &&
      session.summaryModelId === compressionModelId
    ) {
      return {
        ...nextSessionBase,
        summary: session.summary,
        summaryMode: 'hybrid',
        summaryModelId: compressionModelId,
        summaryUpdatedAt: session.summaryUpdatedAt ?? Date.now(),
      };
    }

    if (!compressionModelId) {
      return nextSessionBase;
    }

    const hybridSummary = await generateHybridSummary(messages, nextSummaryState.summary);
    return {
      ...nextSessionBase,
      summary: hybridSummary || nextSummaryState.summary,
      summaryMode: hybridSummary && hybridSummary !== nextSummaryState.summary ? 'hybrid' : 'local',
      summaryModelId: hybridSummary && hybridSummary !== nextSummaryState.summary ? compressionModelId : '',
      summaryUpdatedAt: Date.now(),
    };
  };

  const runModelRequest = async ({
    sessionId,
    sessionSnapshot,
    nextMessages,
    assistantId,
    reasoningEffort,
  }: RunModelRequestOptions): Promise<boolean> => {
    try {
      const completionUrl = buildChatApiUrl(aiProvider.baseUrl);
      const responsesUrl = buildResponsesApiUrl(aiProvider.baseUrl);
      const baseHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiProvider.apiKey.trim()}`,
      };

      if (!completionUrl) {
        throw new Error('Base URL 无效，请检查设置。');
      }

      const rawBaseUrl = joinBaseUrl(normalizeUrl(aiProvider.baseUrl));
      const preferResponses = /\/(v\d+\/)?responses$/.test(rawBaseUrl);
      const contextMessages = buildModelContextMessages(sessionSnapshot, nextMessages);
      const requestPlans = preferResponses
        ? [
          {
            label: 'responses',
            url: responsesUrl,
            body: buildResponsesPayload(contextMessages, aiProvider.modelId.trim(), reasoningEffort),
          },
          {
            label: 'chat_completions',
            url: completionUrl,
            body: buildChatCompletionsPayload(contextMessages, aiProvider.modelId.trim()),
          }
        ]
        : [
          {
            label: 'chat_completions',
            url: completionUrl,
            body: buildChatCompletionsPayload(contextMessages, aiProvider.modelId.trim()),
          }
        ];

      let reply = '';
      let handled = false;
      let lastError = '';

      for (const plan of requestPlans) {
        if (!plan.url) continue;

        try {
          const response = await fetch(plan.url, {
            method: 'POST',
            headers: baseHeaders,
            body: JSON.stringify(plan.body)
          });

          const { contentType, rawText, payload, currentReply } = await consumeResponseStream(
            response,
            sessionId,
            assistantId
          );
          console.log('[AnyBrain][AI] response meta', {
            mode: plan.label,
            url: plan.url,
            status: response.status,
            ok: response.ok,
            contentType,
          });
          console.log('[AnyBrain][AI] raw response preview', rawText.slice(0, 2000));

          if (!response.ok) {
            const detail = extractErrorMessage(payload, rawText || `请求失败（${response.status}）`);
            throw new Error(`HTTP ${response.status}: ${detail}`);
          }

          reply = currentReply || '接口已返回，但未获取到有效内容。';
          handled = true;
          break;
        } catch (requestError) {
          lastError = requestError instanceof Error ? requestError.message : String(requestError);
          console.warn('[AnyBrain][AI] request failed', { mode: plan.label, url: plan.url, error: lastError });
        }
      }

      if (!handled) {
        throw new Error(lastError || '请求失败，请检查模型接口配置。');
      }

      updateChatSession(sessionId, session => ({
        ...session,
        messages: session.messages.map(message => (
          message.id === assistantId
            ? { ...message, content: reply, status: undefined }
            : message
        )),
        updatedAt: Date.now(),
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(message);
      updateChatSession(sessionId, session => ({
        ...session,
        messages: session.messages.map(item => (
          item.id === assistantId
            ? { ...item, content: `请求失败：${message}`, status: 'error' }
            : item
        )),
        updatedAt: Date.now(),
      }));
      return false;
    }
  };

  const sendChat = async ({
    reasoningEffort,
    attachmentContext,
    overrideContent,
  }: SendChatOptions = {}): Promise<boolean> => {
    if (chatSending) return false;
    if (!aiProvider.enabled) {
      setChatError('请先在设置中开启 AI 对话流。');
      return false;
    }
    if (!aiProvider.baseUrl.trim() || !aiProvider.apiKey.trim() || !aiProvider.modelId.trim()) {
      setChatError('请先在设置中配置 baseUrl、apiKey 与 modelId。');
      return false;
    }

    const content = (overrideContent ?? chatInput).trim();
    const attachmentBlock = attachmentContext?.trim() || '';
    if (!content && !attachmentBlock) return false;
    const composedContent = [content, attachmentBlock].filter(Boolean).join('\n\n');
    const shouldResetComposerInput = typeof overrideContent !== 'string';

    let targetSessionId = activeChatSessionId;
    if (!targetSessionId) {
      const nextSession = createChatSession();
      setChatSessions([nextSession]);
      setActiveChatSessionId(nextSession.id);
      targetSessionId = nextSession.id;
    }

    const currentSession = chatSessions.find(session => session.id === targetSessionId);
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: composedContent,
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '正在思考中…',
      status: 'streaming'
    };

    const baseMessages = currentSession?.messages ?? [CHAT_WELCOME_MESSAGE];
    const nextMessages = [...baseMessages, userMessage];
    const currentSessionSnapshot = currentSession ?? createChatSession();
    updateChatSession(targetSessionId, session => ({
      ...session,
      title: session.messages.length <= 1 ? deriveChatSessionTitle(content || '附件消息') : session.title,
      messages: [...nextMessages, assistantPlaceholder],
      updatedAt: Date.now(),
    }));
    if (shouldResetComposerInput) {
      setChatInput('');
    }
    setChatSending(true);
    setChatError('');
    try {
      const sessionSnapshot = await resolveSessionSummary(currentSessionSnapshot, nextMessages);
      updateChatSession(targetSessionId, session => ({
        ...session,
        summary: sessionSnapshot.summary,
        summarizedMessageCount: sessionSnapshot.summarizedMessageCount,
        summaryUpdatedAt: sessionSnapshot.summaryUpdatedAt,
        summarySignature: sessionSnapshot.summarySignature,
        summaryMode: sessionSnapshot.summaryMode,
        summaryModelId: sessionSnapshot.summaryModelId,
        updatedAt: session.updatedAt,
      }));
      return await runModelRequest({
        sessionId: targetSessionId,
        sessionSnapshot,
        nextMessages,
        assistantId,
        reasoningEffort,
      });
    } finally {
      setChatSending(false);
    }
  };

  const retryMessage = async (messageId: string, reasoningEffort?: ThinkingDepth): Promise<boolean> => {
    if (chatSending) return false;
    if (!activeChatSessionId) return false;
    if (!aiProvider.enabled) {
      setChatError('请先在设置中开启 AI 对话流。');
      return false;
    }
    if (!aiProvider.baseUrl.trim() || !aiProvider.apiKey.trim() || !aiProvider.modelId.trim()) {
      setChatError('请先在设置中配置 baseUrl、apiKey 与 modelId。');
      return false;
    }

    const currentSession = chatSessions.find(session => session.id === activeChatSessionId);
    if (!currentSession) return false;

    const messageIndex = currentSession.messages.findIndex(message => message.id === messageId && message.role === 'user');
    if (messageIndex < 0) return false;

    const baseMessages = currentSession.messages.slice(0, messageIndex + 1).map(message => ({
      ...message,
      status: undefined,
    }));
    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '正在思考中…',
      status: 'streaming'
    };

    updateChatSession(activeChatSessionId, session => ({
      ...session,
      messages: [...baseMessages, assistantPlaceholder],
      updatedAt: Date.now(),
    }));
    setChatSending(true);
    setChatError('');

    try {
      const sessionSnapshot = await resolveSessionSummary(currentSession, baseMessages);
      updateChatSession(activeChatSessionId, session => ({
        ...session,
        summary: sessionSnapshot.summary,
        summarizedMessageCount: sessionSnapshot.summarizedMessageCount,
        summaryUpdatedAt: sessionSnapshot.summaryUpdatedAt,
        summarySignature: sessionSnapshot.summarySignature,
        summaryMode: sessionSnapshot.summaryMode,
        summaryModelId: sessionSnapshot.summaryModelId,
        updatedAt: session.updatedAt,
      }));
      return await runModelRequest({
        sessionId: activeChatSessionId,
        sessionSnapshot,
        nextMessages: baseMessages,
        assistantId,
        reasoningEffort,
      });
    } finally {
      setChatSending(false);
    }
  };

  useEffect(() => {
    if (!historyLoaded || hasHydratedPersistedHistoryRef.current) return;

    const normalizedHistory = normalizePersistedHistory(persistedHistory);
    if (normalizedHistory) {
      setChatSessions(normalizedHistory.sessions);
      setActiveChatSessionId(normalizedHistory.activeSessionId);
    } else {
      const nextSession = createChatSession();
      setChatSessions([nextSession]);
      setActiveChatSessionId(nextSession.id);
    }

    hasHydratedPersistedHistoryRef.current = true;
  }, [historyLoaded, persistedHistory]);

  useEffect(() => {
    if (!historyLoaded || !hasHydratedPersistedHistoryRef.current) return;

    if (chatSessions.length === 0) {
      const nextSession = createChatSession();
      setChatSessions([nextSession]);
      setActiveChatSessionId(nextSession.id);
      return;
    }

    if (!activeChatSessionId || !chatSessions.some(session => session.id === activeChatSessionId)) {
      setActiveChatSessionId(chatSessions[0].id);
    }
  }, [chatSessions, activeChatSessionId, historyLoaded]);

  useEffect(() => {
    if (!historyLoaded || !hasHydratedPersistedHistoryRef.current || !onHistoryChange) return;
    if (chatSessions.length === 0 || !activeChatSessionId) return;

    const nextHistory = createPersistedHistorySnapshot(chatSessions, activeChatSessionId);
    if (!nextHistory) return;

    onHistoryChange(nextHistory);
  }, [chatSessions, activeChatSessionId, historyLoaded, onHistoryChange]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    chatSessions,
    activeChatSessionId,
    activeChatMessages,
    chatInput,
    chatSending,
    chatError,
    chatCopyState,
    chatSpeakingId,
    setActiveChatSessionId,
    setChatInput,
    setChatError,
    createSession,
    resetActiveSession,
    copyMessage,
    speakMessage,
    sendChat,
    retryMessage,
  };
}
