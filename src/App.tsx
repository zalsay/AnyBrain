import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { Bot, ChevronDown, ChevronUp, Copy, Globe, Home, KeyRound, Plus, RefreshCw, SendHorizonal, Sparkles, Star, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import './App.css';
import appLogo from '../src-tauri/icons/128x128.png';

const AI_CHAT_TAB_ID = '__ai_chat_flow__';
const AI_CHAT_TAB = {
  id: AI_CHAT_TAB_ID,
  name: 'AI 对话',
  url: ''
};

// Preload all SVG/PNG icons from the assets folder using Vite
const iconModules = import.meta.glob('/src/assets/icons/*.{svg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const getIconUrl = (id: string, name: string) => {
  const normalizedId = id.toLowerCase();
  const normalizedName = name.toLowerCase();

  // Custom mapping for aliases (e.g. Chatgpt -> openai)
  const searchTerms = [normalizedId, normalizedName];
  if (normalizedId.includes('chatgpt') || normalizedName.includes('chatgpt')) searchTerms.push('openai');
  if (normalizedId.includes('tongyi') || normalizedName.includes('tongyi')) searchTerms.push('qwen');
  if (normalizedName.includes('minimax') || normalizedId.includes('minimax')) searchTerms.push('minimax');

  for (const path in iconModules) {
    const filename = path.split('/').pop()?.toLowerCase() || '';
    if (searchTerms.some(term => filename.includes(term))) {
      return iconModules[path];
    }
  }
  return null;
};

interface Platform {
  id: string;
  name: string;
  url: string;
  hidden?: boolean;
}

type ExecMode = 'shell_with_output' | 'shell_status_only' | 'external_terminal';
type CommandExecMode = ExecMode | 'inherit';

interface ShortcutCommand {
  id: string;
  name: string;
  cmd: string;
  execMode?: CommandExecMode;
}

interface ShortcutCommandSettings {
  defaultExecMode: ExecMode;
}

interface AiModelConfig {
  id: string;
  modelId: string;
  contextLength: string;
}

interface AiProviderSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  models: AiModelConfig[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'error';
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const EXEC_MODE_OPTIONS: Array<{ value: ExecMode; label: string }> = [
  { value: 'shell_with_output', label: '本地 shell（显示输出）' },
  { value: 'shell_status_only', label: '本地 shell（仅状态）' },
  { value: 'external_terminal', label: '外部终端执行' }
];

const COMMAND_STATUS_LABELS: Record<'running' | 'success' | 'error', string> = {
  running: '运行中',
  success: '成功',
  error: '失败'
};

const POPULAR_PLATFORMS = [
  { id: 'openai', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'qwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'zhipu', name: '智谱清言', url: 'https://chatglm.cn/' },
  { id: 'minimax', name: 'MiniMax', url: 'https://api.minimax.chat/' },
];

const STORAGE_KEY = 'ai-chaty-platforms';
const SETTINGS_DEFAULTS = { useSystemProxy: true, speechRate: 0.9 };
const COMMAND_SETTINGS_DEFAULTS: ShortcutCommandSettings = { defaultExecMode: 'shell_with_output' };
const AI_MODEL_CONTEXT_DEFAULT = '200k';

function createAiModelConfig(modelId = '', contextLength = AI_MODEL_CONTEXT_DEFAULT): AiModelConfig {
  return {
    id: `ai-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    modelId,
    contextLength,
  };
}

function normalizeAiProviderSettings(
  value?: Partial<AiProviderSettings> & { models?: Array<Partial<AiModelConfig>> }
): AiProviderSettings {
  const models = Array.isArray(value?.models)
    ? value.models.map((model, index) => ({
      id: model?.id?.trim() || `ai-model-${index}-${Math.random().toString(36).slice(2, 8)}`,
      modelId: model?.modelId?.trim() || '',
      contextLength: model?.contextLength?.trim() || AI_MODEL_CONTEXT_DEFAULT,
    }))
    : [];

  return {
    enabled: Boolean(value?.enabled),
    baseUrl: value?.baseUrl?.trim() || '',
    apiKey: value?.apiKey?.trim() || '',
    modelId: value?.modelId?.trim() || models.find(model => model.modelId)?.modelId || '',
    models: models.length > 0 ? models : [createAiModelConfig()],
  };
}

const AI_PROVIDER_DEFAULTS: AiProviderSettings = normalizeAiProviderSettings({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  modelId: '',
  models: [],
});
const CHAT_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我已经准备好了。开启 AI 对话流后，你可以在这里直接进行多轮对话。',
};

async function loadPlatformsAsync(): Promise<Platform[]> {
  try {
    const data: string = await invoke('load_platforms');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        invoke('save_platforms', { data: saved }).catch(() => { });
        return parsed;
      }
    }
  } catch { }
  return [];
}

function savePlatformsToFile(platforms: Platform[]) {
  const data = JSON.stringify(platforms);
  invoke('save_platforms', { data }).catch(console.error);
  localStorage.setItem(STORAGE_KEY, data);
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function deriveNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '') || '新标签';
  } catch {
    return '新标签';
  }
}

function joinBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/$/, '');
}

function buildChatApiUrl(baseUrl: string) {
  const normalized = joinBaseUrl(normalizeUrl(baseUrl));
  if (!normalized) return '';
  if (/\/((v\d+\/)?chat\/completions|(v\d+\/)?responses)$/.test(normalized)) return normalized;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function buildResponsesApiUrl(baseUrl: string) {
  const normalized = joinBaseUrl(normalizeUrl(baseUrl));
  if (!normalized) return '';
  if (/\/(v\d+\/)?responses$/.test(normalized)) return normalized;
  if (/\/(v\d+\/)?chat\/completions$/.test(normalized)) return normalized.replace(/chat\/completions$/, 'responses');
  if (/\/v\d+$/.test(normalized)) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

function buildChatCompletionsPayload(messages: ChatMessage[], model: string) {
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

function buildResponsesPayload(messages: ChatMessage[], model: string) {
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
  };
}

function parseSseEventChunks(rawText: string) {
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

function extractStreamingDelta(payload: unknown) {
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

function extractErrorMessage(payload: unknown, fallback: string) {
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

function extractAssistantReply(payload: unknown) {
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

function createChatSession(title = '新会话'): ChatSession {
  const now = Date.now();
  return {
    id: `chat-session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [CHAT_WELCOME_MESSAGE],
    createdAt: now,
    updatedAt: now,
  };
}

function deriveChatSessionTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  return normalized.slice(0, 18);
}

function PlatformIcon({ platformId, platformName, url, size = 16 }: { platformId: string; platformName: string; url?: string; size?: number }) {
  const [error, setError] = useState(false);
  const iconUrl = getIconUrl(platformId, platformName);

  if (!iconUrl || error) {
    if (url) {
      try {
        const domain = new URL(url).hostname;
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`;
        return (
          <img
            src={faviconUrl}
            alt="favicon"
            width={size}
            height={size}
            className="platform-icon"
            onError={() => setError(true)}
          />
        );
      } catch {
      }
    }
    return <Globe size={size} />;
  }

  return (
    <img
      src={iconUrl}
      alt="icon"
      width={size}
      height={size}
      className="platform-icon"
      onError={() => {
        setError(true);
      }}
    />
  );
}

function App() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [tempTabs, setTempTabs] = useState<Platform[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [useSystemProxy, setUseSystemProxy] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.9);
  const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommand[]>([]);
  const [commandSettings, setCommandSettings] = useState<ShortcutCommandSettings>(COMMAND_SETTINGS_DEFAULTS);
  const [showCommandAddForm, setShowCommandAddForm] = useState(false);
  const [commandDraftName, setCommandDraftName] = useState('');
  const [commandDraftValue, setCommandDraftValue] = useState('');
  const [commandOutputs, setCommandOutputs] = useState<Record<string, { output: string; error: string; exitCode: number | null }>>({});
  const [expandedCommandOutputs, setExpandedCommandOutputs] = useState<Record<string, boolean>>({});
  const [commandStatuses, setCommandStatuses] = useState<Record<string, 'running' | 'success' | 'error'>>({});
  const [aiProvider, setAiProvider] = useState<AiProviderSettings>(AI_PROVIDER_DEFAULTS);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatCopyState, setChatCopyState] = useState<Record<string, 'success' | 'error'>>({});
  const [chatSpeakingId, setChatSpeakingId] = useState<string | null>(null);
  const [showAiModelAddForm, setShowAiModelAddForm] = useState(false);
  const [aiModelDraft, setAiModelDraft] = useState('');
  const [aiContextDraft, setAiContextDraft] = useState(AI_MODEL_CONTEXT_DEFAULT);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const quickAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const hoveredTabRef = useRef<HTMLDivElement | null>(null);
  const hoverMenuHideTimeoutRef = useRef<number | null>(null);

  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickUrl, setQuickUrl] = useState('');
  const [quickAddPosition, setQuickAddPosition] = useState({ top: 0, left: 0 });
  const [tabHoverMenuPosition, setTabHoverMenuPosition] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const allVisibleTabs = useMemo(() => {
    const visiblePlatforms = platforms.filter(p => !p.hidden);
    const aiTabs = aiProvider.enabled ? [AI_CHAT_TAB] : [];
    return [...aiTabs, ...visiblePlatforms, ...tempTabs];
  }, [platforms, tempTabs, aiProvider.enabled]);

  const isActiveAiChat = activeTab === AI_CHAT_TAB_ID;
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

  const handleCreateChatSession = () => {
    const nextSession = createChatSession();
    setChatSessions(prev => [nextSession, ...prev]);
    setActiveChatSessionId(nextSession.id);
    setChatError('');
    setChatInput('');
  };

  useEffect(() => {
    loadPlatformsAsync().then(loaded => {
      setPlatforms(loaded);
      if (loaded.length > 0) {
        setActiveTab(loaded[0].id);
      } else {
        setShowSettings(true);
      }
      setInitialized(true);
    });

    invoke('load_settings').then((data: unknown) => {
      try {
        const parsed = JSON.parse(data as string);
        const settings = { ...SETTINGS_DEFAULTS, ...parsed };
        setUseSystemProxy(settings.useSystemProxy);
        setSpeechRate(settings.speechRate);
        const loadedCommands = Array.isArray(parsed?.shortcutCommands) ? parsed.shortcutCommands : [];
        const loadedCommandSettings = { ...COMMAND_SETTINGS_DEFAULTS, ...(parsed?.shortcutCommandSettings || {}) };
        const loadedAiProvider = normalizeAiProviderSettings(parsed?.aiProvider || {});
        setShortcutCommands(loadedCommands);
        setCommandSettings(loadedCommandSettings);
        setAiProvider(loadedAiProvider);
        setSettingsLoaded(true);
      } catch {
        setSettingsLoaded(true);
      }
    }).catch(() => {
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!showQuickAdd) return;

    updateQuickAddPosition();
    const handleWindowChange = () => updateQuickAddPosition();
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);

    return () => {
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [showQuickAdd]);

  useEffect(() => {
    const shouldShowHoverMenu = hoveredTab !== null && hoveredTab === activeTab;
    if (!shouldShowHoverMenu || !hoveredTabRef.current) return;

    const handleWindowChange = () => {
      if (!hoveredTabRef.current) return;
      updateTabHoverMenuPosition(hoveredTabRef.current);
    };

    handleWindowChange();
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);

    return () => {
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [hoveredTab, activeTab]);

  useEffect(() => {
    if (allVisibleTabs.length > 0 && (!activeTab || !allVisibleTabs.some(tab => tab.id === activeTab))) {
      setActiveTab(allVisibleTabs[0].id);
    }
  }, [allVisibleTabs, activeTab]);

  useEffect(() => {
    if (initialized) {
      savePlatformsToFile(platforms);
    }
  }, [platforms, initialized]);

  useEffect(() => {
    if (showSettings || !activeTab) return;
    const platform = tempTabs.find(p => p.id === activeTab) || platforms.find(p => p.id === activeTab);
    if (activeTab === AI_CHAT_TAB_ID) {
      invoke('hide_all_webviews').catch(console.error);
      return;
    }
    if (!platform) return;
    if (!platform.url || !platform.url.trim()) {
      invoke('hide_all_webviews').catch(console.error);
      return;
    }
    invoke('create_or_show_webview', {
      platformId: platform.id,
      url: platform.url,
      topOffset: 70.0
    })
      .then(() => invoke('set_tts_rate', { rate: speechRate }))
      .catch(console.error);
  }, [activeTab, platforms, tempTabs, showSettings, speechRate]);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke('set_tts_rate', { rate: speechRate }).catch(console.error);
  }, [speechRate, settingsLoaded]);

  useEffect(() => {
    const unlistenPromise = (async () => {
      // @ts-ignore: dynamic import for event APIs
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<string>('new_tab_request', (event) => {
        const url = event.payload || '';
        if (!url) return;
        const id = `tmp-${Date.now()}`;
        const name = deriveNameFromUrl(url);
        setTempTabs(prev => [...prev, { id, name, url }]);
        setActiveTab(id);
      });
      return unlisten;
    })();
    return () => {
      unlistenPromise.then(u => { try { u(); } catch { } });
    };
  }, []);

  useEffect(() => {
    if (chatSessions.length === 0) {
      const nextSession = createChatSession();
      setChatSessions([nextSession]);
      setActiveChatSessionId(nextSession.id);
      return;
    }

    if (!activeChatSessionId || !chatSessions.some(session => session.id === activeChatSessionId)) {
      setActiveChatSessionId(chatSessions[0].id);
    }
  }, [chatSessions, activeChatSessionId]);

  useEffect(() => {
    if (isActiveAiChat && !showSettings) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChatMessages, isActiveAiChat, showSettings]);

  useEffect(() => {
    return () => {
      clearHoverMenuHideTimeout();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const saveSettings = (next: Record<string, unknown>) => {
    invoke('save_settings', { data: JSON.stringify(next) }).catch(console.error);
  };

  const persistSettings = (overrides: Partial<{
    useSystemProxy: boolean;
    speechRate: number;
    shortcutCommands: ShortcutCommand[];
    shortcutCommandSettings: ShortcutCommandSettings;
    aiProvider: AiProviderSettings;
  }> = {}) => {
    saveSettings({
      useSystemProxy: overrides.useSystemProxy ?? useSystemProxy,
      speechRate: overrides.speechRate ?? speechRate,
      shortcutCommands: overrides.shortcutCommands ?? shortcutCommands,
      shortcutCommandSettings: overrides.shortcutCommandSettings ?? commandSettings,
      aiProvider: overrides.aiProvider ?? aiProvider,
    });
  };

  const updateAiProvider = (partial: Partial<AiProviderSettings>) => {
    setAiProvider(prev => {
      const next = normalizeAiProviderSettings({ ...prev, ...partial });
      persistSettings({ aiProvider: next });
      return next;
    });
  };

  const resetAiModelDraft = () => {
    setAiModelDraft('');
    setAiContextDraft(AI_MODEL_CONTEXT_DEFAULT);
  };

  const handleAddAiModel = () => {
    if (!aiModelDraft.trim()) return;
    const nextModel = createAiModelConfig(aiModelDraft.trim(), aiContextDraft.trim() || AI_MODEL_CONTEXT_DEFAULT);
    updateAiProvider({
      models: [...(Array.isArray(aiProvider.models) ? aiProvider.models : []), nextModel],
      modelId: aiProvider.modelId.trim() || nextModel.modelId,
    });
    setShowAiModelAddForm(false);
    resetAiModelDraft();
  };

  const handleUpdateAiModel = (modelId: string, partial: Partial<AiModelConfig>) => {
    const currentModels = Array.isArray(aiProvider.models) ? aiProvider.models : [];
    const nextModels = currentModels.map(model => (
      model.id === modelId
        ? {
          ...model,
          ...partial,
          contextLength: (partial.contextLength ?? model.contextLength).trim() || AI_MODEL_CONTEXT_DEFAULT,
        }
        : model
    ));
    const activeExists = nextModels.some(model => model.modelId.trim() && model.modelId === aiProvider.modelId);
    updateAiProvider({
      models: nextModels,
      modelId: activeExists ? aiProvider.modelId : (nextModels.find(model => model.modelId.trim())?.modelId ?? ''),
    });
  };

  const handleRemoveAiModel = (modelId: string) => {
    const currentModels = Array.isArray(aiProvider.models) ? aiProvider.models : [];
    const nextModels = currentModels.filter(model => model.id !== modelId);
    updateAiProvider({
      models: nextModels.length > 0 ? nextModels : [createAiModelConfig('', AI_MODEL_CONTEXT_DEFAULT)],
      modelId: nextModels.some(model => model.modelId === aiProvider.modelId)
        ? aiProvider.modelId
        : (nextModels.find(model => model.modelId.trim())?.modelId ?? ''),
    });
  };

  const toggleSettings = () => {
    if (!showSettings) {
      invoke('hide_all_webviews').catch(console.error);
      setShowSettings(true);
      setShowQuickAdd(false);
      setShowCommandAddForm(false);
    } else {
      setShowSettings(false);
      setShowAddForm(false);
      resetAddForm();
      setShowCommandAddForm(false);
      resetCommandDraft();
      const platform = platforms.find(p => p.id === activeTab && !p.hidden);
      if (platform) {
        invoke('create_or_show_webview', {
          platformId: platform.id,
          url: platform.url,
          topOffset: 78.0
        }).catch(console.error);
      }
    }
  };

  const resetAddForm = () => {
    setSelectedPreset('');
    setNewName('');
    setNewUrl('');
  };

  const resetQuickAdd = () => {
    setQuickName('');
    setQuickUrl('');
  };

  const updateQuickAddPosition = () => {
    const buttonRect = quickAddButtonRef.current?.getBoundingClientRect();
    if (!buttonRect) return;

    const popoverWidth = 260;
    const popoverHeight = 188;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.min(
      Math.max(gap, buttonRect.right - popoverWidth),
      Math.max(gap, viewportWidth - popoverWidth - gap)
    );

    const preferredTop = buttonRect.bottom + gap;
    const top = preferredTop + popoverHeight <= viewportHeight - gap
      ? preferredTop
      : Math.max(gap, buttonRect.top - popoverHeight - gap);

    setQuickAddPosition({ top, left });
  };

  const updateTabHoverMenuPosition = (tabElement: HTMLDivElement) => {
    const tabRect = tabElement.getBoundingClientRect();

    const viewportWidth = window.innerWidth;
    const width = Math.round(tabRect.width);
    const height = Math.round(tabRect.height);
    const left = tabRect.right + width <= viewportWidth
      ? Math.round(tabRect.right - 1)
      : Math.max(0, Math.round(tabRect.left - width + 1));
    const top = Math.max(0, Math.round(tabRect.top));

    setTabHoverMenuPosition({ top, left, width, height });
  };

  const clearHoverMenuHideTimeout = () => {
    if (hoverMenuHideTimeoutRef.current === null) return;
    window.clearTimeout(hoverMenuHideTimeoutRef.current);
    hoverMenuHideTimeoutRef.current = null;
  };

  const scheduleHoverMenuHide = () => {
    clearHoverMenuHideTimeout();
    hoverMenuHideTimeoutRef.current = window.setTimeout(() => {
      setHoveredTab(null);
      hoverMenuHideTimeoutRef.current = null;
    }, 500);
  };


  const resetCommandDraft = () => {
    setCommandDraftName('');
    setCommandDraftValue('');
  };

  const updateCommandSettings = (partial: Partial<ShortcutCommandSettings>) => {
    setCommandSettings(prev => {
      const next = { ...prev, ...partial };
      persistSettings({ shortcutCommandSettings: next });
      return next;
    });
  };

  const updateShortcutCommands = (updater: (prev: ShortcutCommand[]) => ShortcutCommand[]) => {
    setShortcutCommands(prev => {
      const next = updater(prev);
      persistSettings({ shortcutCommands: next });
      return next;
    });
  };

  const resolveCommandExecMode = (command: ShortcutCommand): ExecMode => {
    if (command.execMode && command.execMode !== 'inherit') return command.execMode;
    return commandSettings.defaultExecMode;
  };

  const formatCommandOutput = (value?: string | null) => (value ?? '').trim();

  const handleAddShortcutCommand = () => {
    if (!commandDraftName.trim() || !commandDraftValue.trim()) return;
    const id = `cmd-${Date.now()}`;
    const nextCommand: ShortcutCommand = {
      id,
      name: commandDraftName.trim(),
      cmd: commandDraftValue.trim(),
      execMode: 'inherit'
    };
    updateShortcutCommands(prev => [...prev, nextCommand]);
    setShowCommandAddForm(false);
    resetCommandDraft();
  };

  const handleRemoveShortcutCommand = (id: string) => {
    updateShortcutCommands(prev => prev.filter(cmd => cmd.id !== id));
    setCommandOutputs(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpandedCommandOutputs(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCommandStatuses(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleCommandExecModeChange = (id: string, execMode: CommandExecMode) => {
    updateShortcutCommands(prev => prev.map(cmd => cmd.id === id ? { ...cmd, execMode } : cmd));
  };

  const showCommandStatus = (id: string, status: 'success' | 'error') => {
    setCommandStatuses(prev => ({ ...prev, [id]: status }));
    window.setTimeout(() => {
      setCommandStatuses(prev => {
        const next = { ...prev };
        if (next[id] === status) delete next[id];
        return next;
      });
    }, 1500);
  };

  const handleExecuteCommand = async (command: ShortcutCommand) => {
    const execMode = resolveCommandExecMode(command);
    setCommandStatuses(prev => ({ ...prev, [command.id]: 'running' }));
    try {
      const result = await invoke('run_shortcut_command', {
        command: command.cmd,
        execMode
      }) as { stdout?: string; stderr?: string; exitCode?: number | null; error?: string | null };

      if (execMode === 'shell_with_output') {
        setCommandOutputs(prev => ({
          ...prev,
          [command.id]: {
            output: formatCommandOutput(result.stdout),
            error: formatCommandOutput(result.stderr || result.error),
            exitCode: result.exitCode ?? null
          }
        }));
        setExpandedCommandOutputs(prev => ({ ...prev, [command.id]: true }));
      }

      if (result.exitCode === 0 || result.exitCode === null) {
        showCommandStatus(command.id, 'success');
      } else {
        showCommandStatus(command.id, 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (execMode === 'shell_with_output') {
        setCommandOutputs(prev => ({
          ...prev,
          [command.id]: {
            output: '',
            error: message,
            exitCode: null
          }
        }));
        setExpandedCommandOutputs(prev => ({ ...prev, [command.id]: true }));
      }
      showCommandStatus(command.id, 'error');
    }
  };

  const handlePresetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedPreset(val);

    if (val === 'custom' || val === '') {
      setNewName('');
      setNewUrl('');
    } else {
      const preset = POPULAR_PLATFORMS[Number.parseInt(val, 10)];
      if (preset) {
        setNewName(preset.name);
        setNewUrl(preset.url);
      }
    }
  };

  const handleAddPlatform = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const id = `${newName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const finalUrl = normalizeUrl(newUrl);
    const newPlatform: Platform = { id, name: newName.trim(), url: finalUrl };
    setPlatforms(prev => [...prev, newPlatform]);
    setShowAddForm(false);
    resetAddForm();
    setActiveTab(id);
  };

  const handleQuickAdd = () => {
    if (!quickUrl.trim()) return;
    const finalUrl = normalizeUrl(quickUrl);
    const displayName = quickName.trim() || deriveNameFromUrl(finalUrl);
    const baseId = (quickName.trim() || displayName).toLowerCase().replace(/\s+/g, '-') || 'tmp';
    const id = `tmp-${baseId}-${Date.now()}`;

    const newPlatform: Platform = { id, name: displayName, url: finalUrl };
    setTempTabs(prev => [...prev, newPlatform]);
    setShowQuickAdd(false);
    resetQuickAdd();
    setActiveTab(id);
  };

  const handleRemovePlatform = (id: string) => {
    invoke('destroy_webview', { platformId: id }).catch(console.error);
    setPlatforms(prev => {
      const updated = prev.filter(p => p.id !== id);
      if (activeTab === id) {
        const fallback = aiProvider.enabled ? AI_CHAT_TAB_ID : (updated[0]?.id || '');
        setActiveTab(fallback);
      }
      return updated;
    });
  };

  const handleReloadPlatform = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === AI_CHAT_TAB_ID) {
      if (!activeChatSessionId) {
        handleCreateChatSession();
      } else {
        updateChatSession(activeChatSessionId, session => ({
          ...session,
          title: '新会话',
          messages: [CHAT_WELCOME_MESSAGE],
          updatedAt: Date.now(),
        }));
        setChatError('');
      }
      return;
    }
    const platform = tempTabs.find(p => p.id === id) || platforms.find(p => p.id === id);
    if (!platform) return;
    const isExternal = platform.url?.startsWith('http');
    const isLocal = platform.url?.startsWith('http://localhost') || platform.url?.startsWith('http://127.0.0.1');
    if (isExternal || isLocal) {
      invoke('reload_webview', { platformId: id }).catch(console.error);
    } else {
      invoke('reload_webview_url', { platformId: id, url: platform.url }).catch(console.error);
    }
  };

  const handleMovePlatform = (index: number, direction: 'up' | 'down') => {
    setPlatforms(prev => {
      const updated = [...prev];
      if (direction === 'up' && index > 0) {
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
      } else if (direction === 'down' && index < updated.length - 1) {
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
      }
      return updated;
    });
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === AI_CHAT_TAB_ID) {
      updateAiProvider({ enabled: false });
      const fallback = platforms.filter(p => !p.hidden)[0]?.id || tempTabs[0]?.id || '';
      setActiveTab(fallback);
      return;
    }
    invoke('destroy_webview', { platformId: id }).catch(console.error);
    const isTemp = tempTabs.some(p => p.id === id);
    if (isTemp) {
      const tempAfter = tempTabs.filter(p => p.id !== id);
      if (activeTab === id) {
        const combined = [...(aiProvider.enabled ? [AI_CHAT_TAB] : []), ...platforms.filter(p => !p.hidden), ...tempAfter];
        setActiveTab(combined.length ? combined[0].id : '');
      }
      setTempTabs(tempAfter);
      return;
    }
    setPlatforms(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, hidden: true } : p);
      if (activeTab === id) {
        const visibleAfter = updated.filter(p => !p.hidden);
        const combined = [...(aiProvider.enabled ? [AI_CHAT_TAB] : []), ...visibleAfter, ...tempTabs];
        setActiveTab(combined.length ? combined[0].id : '');
      }
      return updated;
    });
  };

  const handleMenuHome = (id: string, url: string) => {
    invoke('reload_webview_url', { platformId: id, url }).catch(console.error);
  };

  const handleMenuSaveToFavorites = (platform: Platform) => {
    const p = { ...platform, id: platform.id.replace('tmp-', 'fixed-') };
    setPlatforms(prev => [...prev, p]);
    setTempTabs(prev => prev.filter(t => t.id !== platform.id));
    setActiveTab(p.id);
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
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

  const handleSpeakMessage = (messageId: string, content: string) => {
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
    utterance.onend = () => setChatSpeakingId((current: string | null) => (current === messageId ? null : current));
    utterance.onerror = () => {
      setChatSpeakingId((current: string | null) => (current === messageId ? null : current));
      setChatError('朗读失败，请检查浏览器语音能力是否可用。');
    };

    setChatError('');
    setChatSpeakingId(messageId);
    synth.speak(utterance);
  };

  const handleSendChat = async () => {
    if (chatSending) return;
    if (!aiProvider.enabled) {
      setChatError('请先在设置中开启 AI 对话流。');
      return;
    }
    if (!aiProvider.baseUrl.trim() || !aiProvider.apiKey.trim() || !aiProvider.modelId.trim()) {
      setChatError('请先在设置中配置 baseUrl、apiKey 与 modelId。');
      return;
    }
    const content = chatInput.trim();
    if (!content) return;

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
      content,
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
    updateChatSession(targetSessionId, session => ({
      ...session,
      title: session.messages.length <= 1 ? deriveChatSessionTitle(content) : session.title,
      messages: [...nextMessages, assistantPlaceholder],
      updatedAt: Date.now(),
    }));
    setChatInput('');
    setChatSending(true);
    setChatError('');

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
      const requestPlans = preferResponses
        ? [
          {
            label: 'responses',
            url: responsesUrl,
            body: buildResponsesPayload(nextMessages, aiProvider.modelId.trim()),
          },
          {
            label: 'chat_completions',
            url: completionUrl,
            body: buildChatCompletionsPayload(nextMessages, aiProvider.modelId.trim()),
          }
        ]
        : [
          {
            label: 'chat_completions',
            url: completionUrl,
            body: buildChatCompletionsPayload(nextMessages, aiProvider.modelId.trim()),
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

          const contentType = response.headers.get('content-type') || '';
          const rawText = await response.text();
          console.log('[AnyBrain][AI] response meta', {
            mode: plan.label,
            url: plan.url,
            status: response.status,
            ok: response.ok,
            contentType,
          });
          console.log('[AnyBrain][AI] raw response preview', rawText.slice(0, 2000));

          const isSseResponse = contentType.includes('text/event-stream') || rawText.includes('data:');
          let payload: unknown = null;
          let currentReply = '';

          if (isSseResponse) {
            const events = parseSseEventChunks(rawText);
            console.log('[AnyBrain][AI] parsed sse events', events.slice(0, 20));

            for (const eventData of events) {
              if (eventData === '[DONE]') break;
              try {
                const eventPayload = JSON.parse(eventData) as unknown;
                const delta = extractStreamingDelta(eventPayload);
                if (delta) {
                  currentReply += delta;
                  updateChatSession(targetSessionId, session => ({
                    ...session,
                    messages: session.messages.map(message => (
                      message.id === assistantId
                        ? { ...message, content: currentReply, status: 'streaming' }
                        : message
                    )),
                    updatedAt: Date.now(),
                  }));
                }
                payload = eventPayload;
              } catch (parseError) {
                console.warn('[AnyBrain][AI] failed to parse sse chunk', eventData, parseError);
              }
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

      updateChatSession(targetSessionId, session => ({
        ...session,
        messages: session.messages.map(message => (
          message.id === assistantId
            ? { ...message, content: reply, status: undefined }
            : message
        )),
        updatedAt: Date.now(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(message);
      updateChatSession(targetSessionId, session => ({
        ...session,
        messages: session.messages.map(item => (
          item.id === assistantId
            ? { ...item, content: `请求失败：${message}`, status: 'error' }
            : item
        )),
        updatedAt: Date.now(),
      }));
    } finally {
      setChatSending(false);
    }
  };

  return (
    <div className="app-container">
      <div className="titlebar">
        <div className="tabs-container">
          <button className="icon-button settings-logo-btn" onClick={toggleSettings} aria-label="设置">
            <img src={appLogo} alt="Brainer Logo" className="app-logo-small" />
          </button>

          {aiProvider.enabled && (
            <div
              key={AI_CHAT_TAB.id}
              className={`tab-button ai-tab-button ${activeTab === AI_CHAT_TAB.id ? 'active' : ''}`}
              onClick={() => setActiveTab(AI_CHAT_TAB.id)}
            >
              {activeTab === AI_CHAT_TAB.id && (
                <button
                  className="tab-refresh-btn tab-refresh-left"
                  onClick={(e) => handleReloadPlatform(e, AI_CHAT_TAB.id)}
                  title="清空对话"
                  aria-label="清空对话"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <div className="tab-info">
                <Sparkles size={16} className="ai-tab-icon" />
                <span className="tab-name-text">{AI_CHAT_TAB.name}</span>
              </div>
              <button
                className="tab-close-btn"
                onClick={(e) => handleCloseTab(e, AI_CHAT_TAB.id)}
                title="关闭"
                aria-label="关闭 AI 对话流"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {platforms.filter(p => !p.hidden).map((platform) => {
            const showTabActions = activeTab === platform.id && hoveredTab === platform.id;
            return (
            <div
              key={platform.id}
              ref={showTabActions ? hoveredTabRef : null}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
              onMouseEnter={(e) => {
                clearHoverMenuHideTimeout();
                setHoveredTab(platform.id);
                updateTabHoverMenuPosition(e.currentTarget);
              }}
              onMouseLeave={scheduleHoverMenuHide}
            >
              <div className="tab-info">
                <PlatformIcon platformId={platform.id} platformName={platform.name} url={platform.url} size={16} />
                <span className="tab-name-text">{platform.name}</span>
              </div>
              <button
                className="tab-close-btn"
                onClick={(e) => handleCloseTab(e, platform.id)}
                title="关闭"
                aria-label="关闭标签"
              >
                <X size={12} />
              </button>
            </div>
            );
          })}

          {platforms.filter(p => !p.hidden).length > 0 && tempTabs.length > 0 && (
            <div className="tab-divider" aria-hidden="true" />
          )}

          {tempTabs.map((platform) => {
            const showTabActions = activeTab === platform.id && hoveredTab === platform.id;
            return (
            <div
              key={platform.id}
              ref={showTabActions ? hoveredTabRef : null}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
              onMouseEnter={(e) => {
                clearHoverMenuHideTimeout();
                setHoveredTab(platform.id);
                updateTabHoverMenuPosition(e.currentTarget);
              }}
              onMouseLeave={scheduleHoverMenuHide}
            >
              <div className="tab-info">
                <PlatformIcon platformId={platform.id} platformName={platform.name} url={platform.url} size={16} />
                <span className="tab-name-text">{platform.name}</span>
              </div>
              <button
                className="tab-close-btn"
                onClick={(e) => handleCloseTab(e, platform.id)}
                title="关闭"
                aria-label="关闭标签"
              >
                <X size={12} />
              </button>
            </div>
            );
          })}

          <div className="tab-add-wrapper">
            <button
              ref={quickAddButtonRef}
              className="tab-add-button"
              onClick={() => {
                if (showSettings) return;
                if (!showQuickAdd) {
                  const id = `tmp-new-${Date.now()}`;
                  setTempTabs(prev => [...prev, { id, name: '新标签', url: '' }]);
                  setActiveTab(id);
                }
                setShowQuickAdd(true);
              }}
              aria-label="新增标签"
              title="新增标签"
              disabled={showSettings}
            >
              <Plus size={16} />
            </button>
            {showQuickAdd && createPortal(
              <div
                className="tab-add-popover"
                style={{ top: `${quickAddPosition.top}px`, left: `${quickAddPosition.left}px` }}
                onClick={e => e.stopPropagation()}
              >
                <div className="tab-add-title">新增标签</div>
                <input
                  className="tab-add-input"
                  placeholder="名称（可选）"
                  value={quickName}
                  onChange={e => setQuickName(e.target.value)}
                />
                <input
                  className="tab-add-input"
                  placeholder="网址（如 https://chat.deepseek.com）"
                  value={quickUrl}
                  onChange={e => setQuickUrl(e.target.value)}
                  onFocus={() => {
                    if (!quickUrl.trim()) setQuickUrl('https://');
                  }}
                  onBlur={() => {
                    if (quickUrl.trim()) setQuickUrl(normalizeUrl(quickUrl));
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const currentTemp = tempTabs.find(p => p.id === activeTab);
                      if (currentTemp && (!currentTemp.url || !currentTemp.url.trim())) {
                        const finalUrl = normalizeUrl(quickUrl);
                        if (!finalUrl) return;
                        const displayName = quickName.trim() || deriveNameFromUrl(finalUrl);
                        setTempTabs(prev => prev.map(p => p.id === currentTemp.id ? ({ ...p, name: displayName, url: finalUrl }) : p));
                        setShowQuickAdd(false);
                        resetQuickAdd();
                        return;
                      }
                      handleQuickAdd();
                    }
                  }}
                  autoFocus
                />
                <div className="tab-add-actions">
                  <button
                    className="tab-add-cancel"
                    onClick={() => {
                      setShowQuickAdd(false);
                      resetQuickAdd();
                      const currentTemp = tempTabs.find(p => p.id === activeTab);
                      if (currentTemp && (!currentTemp.url || !currentTemp.url.trim())) {
                        setTempTabs(prev => {
                          const updated = prev.filter(p => p.id !== activeTab);
                          const next = [...(aiProvider.enabled ? [AI_CHAT_TAB] : []), ...platforms, ...updated];
                          setActiveTab(next.length ? next[0].id : '');
                          return updated;
                        });
                      }
                    }}
                  >
                    取消
                  </button>
                  <button
                    className="tab-add-confirm"
                    onClick={() => {
                      const currentTemp = tempTabs.find(p => p.id === activeTab);
                      if (currentTemp && (!currentTemp.url || !currentTemp.url.trim())) {
                        const finalUrl = normalizeUrl(quickUrl);
                        if (!finalUrl) return;
                        const displayName = quickName.trim() || deriveNameFromUrl(finalUrl);
                        setTempTabs(prev => prev.map(p => p.id === currentTemp.id ? ({ ...p, name: displayName, url: finalUrl }) : p));
                        setShowQuickAdd(false);
                        resetQuickAdd();
                        return;
                      }
                      handleQuickAdd();
                    }}
                    disabled={!quickUrl.trim()}
                  >
                    打开
                  </button>
                </div>
              </div>,
              document.body
            )}
            {hoveredTab !== null && hoveredTab === activeTab && createPortal(
              <div
                className="tab-hover-menu tab-hover-menu-side"
                style={{
                  top: `${tabHoverMenuPosition.top}px`,
                  left: `${tabHoverMenuPosition.left}px`,
                  width: `${tabHoverMenuPosition.width}px`,
                  height: `${tabHoverMenuPosition.height}px`
                }}
                onMouseEnter={() => {
                  clearHoverMenuHideTimeout();
                  setHoveredTab(activeTab);
                  if (hoveredTabRef.current) {
                    updateTabHoverMenuPosition(hoveredTabRef.current);
                  }
                }}
                onMouseLeave={scheduleHoverMenuHide}
                onClick={e => e.stopPropagation()}
              >
                <button
                  className="tab-hover-btn"
                  title="刷新"
                  onClick={(e) => handleReloadPlatform(e, activeTab)}
                  aria-label="刷新当前标签"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="tab-hover-btn"
                  title="返回主页"
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentPlatform = tempTabs.find(p => p.id === activeTab) || platforms.find(p => p.id === activeTab);
                    if (!currentPlatform) return;
                    handleMenuHome(currentPlatform.id, currentPlatform.url);
                  }}
                  aria-label="返回主页"
                >
                  <Home size={14} />
                </button>
                <button
                  className="tab-hover-btn"
                  title="保存到我的收藏"
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentPlatform = tempTabs.find(p => p.id === activeTab) || platforms.find(p => p.id === activeTab);
                    if (!currentPlatform) return;
                    handleMenuSaveToFavorites(currentPlatform);
                  }}
                  aria-label="保存到我的收藏"
                >
                  <Star size={14} />
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>

        <div className="titlebar-actions" />
      </div>

      {isActiveAiChat && !showSettings && (
        <main className="ai-workbuddy-shell">
          <aside className="ai-workbuddy-sidebar">
            <button className="ai-workbuddy-new-session" onClick={handleCreateChatSession} type="button">
              <Plus size={15} />
              <span>新开会话</span>
            </button>

            <div className="ai-workbuddy-session-list">
              {chatSessions.map(session => (
                <button
                  key={session.id}
                  className={`ai-workbuddy-session-item ${session.id === activeChatSessionId ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveChatSessionId(session.id);
                    setChatError('');
                  }}
                  type="button"
                >
                  <span className="ai-workbuddy-session-title">{session.title}</span>
                  <span className="ai-workbuddy-session-meta">{Math.max(session.messages.length - 1, 0)} 条消息</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="ai-workbuddy-main">
            <div className="ai-workbuddy-scroll">
              <div className="ai-workbuddy-stream">
                {activeChatMessages.map(message => (
                  <article key={message.id} className={`ai-workbuddy-message ${message.role} ${message.status === 'error' ? 'is-error' : ''}`}>
                    <div className="ai-workbuddy-message-meta">
                      <div className="ai-workbuddy-avatar">
                        {message.role === 'assistant' ? <Bot size={16} /> : <span>你</span>}
                      </div>
                      <div className="ai-workbuddy-meta-text">
                        <span className="ai-workbuddy-role">{message.role === 'assistant' ? 'AnyBrain' : '你'}</span>
                        <span className="ai-workbuddy-time">{message.status === 'streaming' ? '思考中' : message.status === 'error' ? '请求失败' : '刚刚'}</span>
                      </div>
                    </div>

                    <div className="ai-workbuddy-bubble-shell">
                      <div className="ai-workbuddy-bubble-glow" />
                      <div className="ai-workbuddy-bubble">
                        <div className="ai-workbuddy-content">{message.content}</div>
                      </div>
                    </div>

                    <div className="ai-workbuddy-actions">
                      <button
                        className={`ai-workbuddy-action-btn ${chatCopyState[message.id] ? `is-${chatCopyState[message.id]}` : ''}`}
                        onClick={() => void handleCopyMessage(message.id, message.content)}
                        title={chatCopyState[message.id] === 'success' ? '已复制' : chatCopyState[message.id] === 'error' ? '复制失败' : '复制消息'}
                        aria-label={chatCopyState[message.id] === 'success' ? '已复制' : chatCopyState[message.id] === 'error' ? '复制失败' : '复制消息'}
                      >
                        <Copy size={14} />
                        <span>{chatCopyState[message.id] === 'success' ? '已复制' : '复制'}</span>
                      </button>
                      <button
                        className={`ai-workbuddy-action-btn ${chatSpeakingId === message.id ? 'is-speaking' : ''}`}
                        onClick={() => handleSpeakMessage(message.id, message.content)}
                        title={chatSpeakingId === message.id ? '停止朗读' : '朗读消息'}
                        aria-label={chatSpeakingId === message.id ? '停止朗读' : '朗读消息'}
                      >
                        {chatSpeakingId === message.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        <span>{chatSpeakingId === message.id ? '停止' : '朗读'}</span>
                      </button>
                    </div>
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <footer className="ai-workbuddy-composer-wrap">
              <div className="ai-workbuddy-composer">
                <div className="ai-workbuddy-composer-top">
                  <div className="ai-workbuddy-composer-icons">
                    <button className="ai-workbuddy-icon-btn" type="button" onClick={toggleSettings} title="模型配置">
                      <Bot size={16} />
                    </button>
                    <button className="ai-workbuddy-icon-btn" type="button" onClick={toggleSettings} title="能力设置">
                      <KeyRound size={16} />
                    </button>
                  </div>
                  <div className="ai-workbuddy-composer-session">
                    <button
                      className="ai-workbuddy-reset"
                      onClick={() => {
                        if (!activeChatSessionId) return;
                        updateChatSession(activeChatSessionId, session => ({
                          ...session,
                          title: '新会话',
                          messages: [CHAT_WELCOME_MESSAGE],
                          updatedAt: Date.now(),
                        }));
                        setChatError('');
                      }}
                    >
                      <RefreshCw size={14} />
                      <span>清空当前会话</span>
                    </button>
                  </div>
                </div>

                {chatError && <div className="ai-workbuddy-error">{chatError}</div>}

                <div className="ai-workbuddy-input-row">
                  <textarea
                    className="ai-workbuddy-textarea"
                    placeholder="给 AnyBrain 发送消息…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendChat();
                      }
                    }}
                  />
                </div>

                <div className="ai-workbuddy-composer-bottom">
                  <div className="ai-workbuddy-model-pill">
                    <Bot size={14} />
                    <span>{aiProvider.modelId.trim() || '未配置模型'}</span>
                  </div>
                  <button className="ai-workbuddy-send" disabled={chatSending || !chatInput.trim()} onClick={() => void handleSendChat()}>
                    <SendHorizonal size={16} />
                  </button>
                </div>
              </div>

              <p className="ai-workbuddy-disclaimer">AnyBrain 可能偶尔会产生不准确的信息，重要内容请注意核实。</p>
            </footer>
          </section>
        </main>
      )}


      <div
        className={`tab-add-backdrop ${showQuickAdd ? 'open' : ''}`}
        onClick={() => {
          setShowQuickAdd(false);
          resetQuickAdd();
          const currentTemp = tempTabs.find(p => p.id === activeTab);
          if (currentTemp && (!currentTemp.url || !currentTemp.url.trim())) {
            setTempTabs(prev => {
              const updated = prev.filter(p => p.id !== activeTab);
              const next = [...(aiProvider.enabled ? [AI_CHAT_TAB] : []), ...platforms, ...updated];
              setActiveTab(next.length ? next[0].id : '');
              return updated;
            });
          }
        }}
      />

      <div className={`settings-backdrop ${showSettings ? 'open' : ''}`} onClick={toggleSettings} />
      <div className={`settings-panel ${showSettings ? 'open' : ''}`}>
        <div className="panel-header">
          <h3>管理标签页与能力设置</h3>
          <button className="icon-button" onClick={toggleSettings}>
            <X size={18} />
          </button>
        </div>

        <div className="panel-list">
          {platforms.length === 0 ? (
            <div className="empty-panel-msg">暂无标签页</div>
          ) : (
            platforms.map((p, index) => (
              <div
                key={p.id}
                className={`panel-item ${p.hidden ? 'is-hidden' : ''}`}
                onClick={() => {
                  if (p.hidden) {
                    setPlatforms(prev => prev.map(item => item.id === p.id ? { ...item, hidden: false } : item));
                    setActiveTab(p.id);
                  }
                }}
                style={{ cursor: p.hidden ? 'pointer' : 'default' }}
                title={p.hidden ? '点击重新显示并打开' : ''}
              >
                <div className="panel-item-info">
                  <PlatformIcon platformId={p.id} platformName={p.name} url={p.url} size={16} />
                  <span className="panel-item-name">{p.name}</span>
                  {p.hidden && <span className="panel-hidden-badge">已收起</span>}
                </div>
                <div className="panel-item-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="panel-item-action-btn"
                    onClick={() => handleMovePlatform(index, 'up')}
                    disabled={index === 0}
                    title="上移"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    className="panel-item-action-btn"
                    onClick={() => handleMovePlatform(index, 'down')}
                    disabled={index === platforms.length - 1}
                    title="下移"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    className="panel-item-delete"
                    onClick={() => handleRemovePlatform(p.id)}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}

          {!showAddForm ? (
            <button className="panel-add-btn" onClick={() => setShowAddForm(true)}>
              <Plus size={16} />
              <span>添加新标签</span>
            </button>
          ) : (
            <div className="add-form">
              <div className="select-container">
                <select
                  className="add-select"
                  value={selectedPreset}
                  onChange={handlePresetSelect}
                >
                  <option value="" disabled>选择 AI 平台</option>
                  {POPULAR_PLATFORMS.map((p, i) => (
                    <option key={i} value={i}>{p.name}</option>
                  ))}
                  <option value="custom">自定义标签页</option>
                </select>
                <ChevronDown className="select-icon" size={16} />
              </div>

              {selectedPreset === 'custom' && (
                <>
                  <input
                    className="add-input"
                    placeholder="名称（如 DeepSeek）"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="add-input"
                    placeholder="网址（如 https://chat.deepseek.com）"
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    onFocus={() => {
                      if (!newUrl.trim()) setNewUrl('https://');
                    }}
                    onBlur={() => {
                      if (newUrl.trim()) setNewUrl(normalizeUrl(newUrl));
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleAddPlatform()}
                  />
                </>
              )}

              <div className="add-form-actions">
                <button className="add-form-cancel" onClick={() => {
                  setShowAddForm(false);
                  resetAddForm();
                }}>取消</button>
                <button
                  className="add-form-confirm"
                  onClick={handleAddPlatform}
                  disabled={!newName.trim() || !newUrl.trim()}
                >
                  添加
                </button>
              </div>
            </div>
          )}

          <div className="panel-divider" />

          <div className="panel-section-header">
            <div className="panel-section-title">AI 对话流</div>
          </div>

          <div className="panel-ai-card">
            <div className="panel-ai-card-row">
              <div>
                <div className="panel-ai-title">开启 AI 对话页</div>
                <div className="panel-ai-desc">打开后会在顶部新增一个独立的现代感 AI 对话流页面。</div>
              </div>
              <button
                className={`toggle-switch ${aiProvider.enabled ? 'active' : ''}`}
                onClick={() => {
                  const enabled = !aiProvider.enabled;
                  updateAiProvider({ enabled });
                  if (enabled) {
                    setActiveTab(AI_CHAT_TAB_ID);
                    invoke('hide_all_webviews').catch(console.error);
                  } else if (activeTab === AI_CHAT_TAB_ID) {
                    const fallback = platforms.filter(p => !p.hidden)[0]?.id || tempTabs[0]?.id || '';
                    setActiveTab(fallback);
                  }
                }}
                role="switch"
                aria-checked={aiProvider.enabled}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="panel-ai-grid">
              <label className="panel-ai-field">
                <span>Base URL</span>
                <div className="panel-ai-input-wrap">
                  <Globe size={14} />
                  <input
                    className="add-input panel-ai-input"
                    placeholder="如 https://api.openai.com/v1"
                    value={aiProvider.baseUrl}
                    onChange={e => updateAiProvider({ baseUrl: e.target.value })}
                  />
                </div>
              </label>

              <label className="panel-ai-field">
                <span>API Key</span>
                <div className="panel-ai-input-wrap">
                  <KeyRound size={14} />
                  <input
                    className="add-input panel-ai-input"
                    type="password"
                    placeholder="输入你的 API Key"
                    value={aiProvider.apiKey}
                    onChange={e => updateAiProvider({ apiKey: e.target.value })}
                  />
                </div>
              </label>
            </div>

            <div className="panel-ai-model-selector">
              <div className="panel-section-header panel-section-header-tight">
                <div>
                  <div className="panel-ai-title">当前使用模型</div>
                  <div className="panel-ai-desc">聊天页会使用这里选中的模型发送请求。</div>
                </div>
              </div>
              <div className="select-container panel-ai-select-wrap">
                <select
                  className="panel-select panel-ai-select"
                  value={aiProvider.modelId}
                  onChange={e => updateAiProvider({ modelId: e.target.value })}
                >
                  <option value="">请选择模型</option>
                  {(Array.isArray(aiProvider.models) ? aiProvider.models : []).map(model => (
                    <option key={model.id} value={model.modelId} disabled={!model.modelId.trim()}>
                      {model.modelId.trim() || '未填写 Model ID'} · {model.contextLength.trim() || AI_MODEL_CONTEXT_DEFAULT}
                    </option>
                  ))}
                </select>
                <ChevronDown className="select-icon" size={14} />
              </div>
            </div>

            <div className="panel-ai-models">
              <div className="panel-section-header panel-section-header-tight">
                <div>
                  <div className="panel-ai-title">模型列表</div>
                  <div className="panel-ai-desc">可添加多个 Model ID，并为每个模型单独定义上下文长度。</div>
                </div>
                {!showAiModelAddForm && (
                  <button className="panel-item-action-btn panel-ai-add-inline" onClick={() => setShowAiModelAddForm(true)}>
                    <Plus size={14} />
                    <span>添加模型</span>
                  </button>
                )}
              </div>

              <div className="panel-ai-model-list">
                {(Array.isArray(aiProvider.models) ? aiProvider.models : []).map((model, index) => {
                  const isActiveModel = model.modelId.trim() && model.modelId === aiProvider.modelId;
                  return (
                    <div key={model.id} className={`panel-ai-model-item ${isActiveModel ? 'is-active' : ''}`}>
                      <div className="panel-ai-model-head">
                        <div className="panel-ai-model-meta">
                          <span className="panel-ai-model-index">模型 {index + 1}</span>
                          {isActiveModel && <span className="panel-ai-model-badge">当前</span>}
                        </div>
                        <button
                          className="panel-item-delete"
                          onClick={() => handleRemoveAiModel(model.id)}
                          title="删除模型"
                          aria-label="删除模型"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="panel-ai-model-grid">
                        <label className="panel-ai-field">
                          <span>Model ID</span>
                          <div className="panel-ai-input-wrap">
                            <Bot size={14} />
                            <input
                              className="add-input panel-ai-input"
                              placeholder="如 gpt-4.1-mini / deepseek-chat"
                              value={model.modelId}
                              onChange={e => handleUpdateAiModel(model.id, { modelId: e.target.value })}
                            />
                          </div>
                        </label>

                        <label className="panel-ai-field">
                          <span>上下文长度</span>
                          <input
                            className="add-input panel-ai-input panel-ai-context-input"
                            placeholder="默认 200k"
                            value={model.contextLength}
                            onChange={e => handleUpdateAiModel(model.id, { contextLength: e.target.value })}
                            onBlur={e => {
                              if (!e.target.value.trim()) handleUpdateAiModel(model.id, { contextLength: AI_MODEL_CONTEXT_DEFAULT });
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              {showAiModelAddForm && (
                <div className="add-form panel-ai-add-form">
                  <input
                    className="add-input panel-ai-input"
                    placeholder="新增 Model ID"
                    value={aiModelDraft}
                    onChange={e => setAiModelDraft(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="add-input panel-ai-input"
                    placeholder="上下文长度，默认 200k"
                    value={aiContextDraft}
                    onChange={e => setAiContextDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddAiModel()}
                  />
                  <div className="add-form-actions">
                    <button className="add-form-cancel" onClick={() => {
                      setShowAiModelAddForm(false);
                      resetAiModelDraft();
                    }}>取消</button>
                    <button className="add-form-confirm" onClick={handleAddAiModel} disabled={!aiModelDraft.trim()}>
                      添加模型
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="panel-ai-tips">
              保存方式为自动持久化；推荐填写兼容 OpenAI Chat Completions 的接口地址。每个模型的上下文长度默认值为 200k。
            </div>
          </div>

          <div className="panel-divider" />

          <div className="panel-section-header">
            <div className="panel-section-title">语音朗读</div>
          </div>

          <div className="panel-setting-item">
            <span className="panel-setting-label">语音朗读速度</span>
            <div className="panel-setting-control panel-setting-control-rate">
              <input
                className="panel-range"
                type="range"
                min={0.7}
                max={1.3}
                step={0.05}
                value={speechRate}
                onChange={e => {
                  const nextRate = Number.parseFloat(e.target.value);
                  setSpeechRate(nextRate);
                  invoke('set_tts_rate', { rate: nextRate }).catch(console.error);
                  persistSettings({ speechRate: nextRate });
                }}
              />
              <input
                className="panel-number"
                type="number"
                min={0.7}
                max={1.3}
                step={0.05}
                value={speechRate}
                onChange={e => {
                  const nextRate = Number.parseFloat(e.target.value || '0');
                  if (Number.isNaN(nextRate)) return;
                  const clamped = Math.min(1.3, Math.max(0.7, nextRate));
                  setSpeechRate(clamped);
                  invoke('set_tts_rate', { rate: clamped }).catch(console.error);
                  persistSettings({ speechRate: clamped });
                }}
              />
            </div>
          </div>

          <div className="panel-divider" />

          <div className="panel-section-header">
            <div className="panel-section-title">快捷命令</div>
          </div>

          <div className="panel-setting-item">
            <span className="panel-setting-label">默认执行方式</span>
            <div className="panel-setting-control">
              <select
                className="panel-select"
                value={commandSettings.defaultExecMode}
                onChange={e => updateCommandSettings({ defaultExecMode: e.target.value as ExecMode })}
              >
                {EXEC_MODE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown className="select-icon" size={14} />
            </div>
          </div>

          {shortcutCommands.length === 0 ? (
            <div className="empty-panel-msg">暂无快捷命令</div>
          ) : (
            shortcutCommands.map(command => {
              const execMode = resolveCommandExecMode(command);
              const output = commandOutputs[command.id];
              const expanded = expandedCommandOutputs[command.id];
              const status = commandStatuses[command.id];
              return (
                <div key={command.id} className="panel-command-item">
                  <div className="panel-command-row">
                    <div className="panel-command-info">
                      <span className="panel-command-name">{command.name}</span>
                      <span className="panel-command-text">{command.cmd}</span>
                    </div>
                    <div className="panel-command-actions">
                      <div className="panel-command-select">
                        <select
                          className="panel-select"
                          value={command.execMode ?? 'inherit'}
                          onChange={e => handleCommandExecModeChange(command.id, e.target.value as CommandExecMode)}
                        >
                          <option value="inherit">跟随默认</option>
                          {EXEC_MODE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="select-icon" size={14} />
                      </div>
                      <button
                        className={`panel-command-run ${status ? `is-${status}` : ''}`}
                        onClick={() => handleExecuteCommand(command)}
                      >
                        {status ? COMMAND_STATUS_LABELS[status] : '执行'}
                      </button>
                      <button
                        className="panel-item-delete"
                        onClick={() => handleRemoveShortcutCommand(command.id)}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {execMode === 'shell_with_output' && output && (
                    <div className="panel-command-output">
                      <button
                        className="panel-command-output-toggle"
                        onClick={() => setExpandedCommandOutputs(prev => ({ ...prev, [command.id]: !expanded }))}
                      >
                        <span>{expanded ? '收起输出' : '展开输出'}</span>
                        <ChevronDown size={14} className={expanded ? 'is-expanded' : ''} />
                      </button>
                      {expanded && (
                        <div className="panel-command-output-body">
                          {output.output && (
                            <pre className="panel-command-output-text">{output.output}</pre>
                          )}
                          {output.error && (
                            <pre className="panel-command-output-error">{output.error}</pre>
                          )}
                          {output.exitCode !== null && (
                            <div className="panel-command-output-exit">退出码：{output.exitCode}</div>
                          )}
                          {!output.output && !output.error && (
                            <div className="panel-command-output-empty">无输出</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {!showCommandAddForm ? (
            <button className="panel-add-btn" onClick={() => setShowCommandAddForm(true)}>
              <Plus size={16} />
              <span>添加快捷命令</span>
            </button>
          ) : (
            <div className="add-form">
              <input
                className="add-input"
                placeholder="名称（如 清理缓存）"
                value={commandDraftName}
                onChange={e => setCommandDraftName(e.target.value)}
                autoFocus
              />
              <input
                className="add-input"
                placeholder="命令（如 npm run build）"
                value={commandDraftValue}
                onChange={e => setCommandDraftValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddShortcutCommand()}
              />
              <div className="add-form-actions">
                <button className="add-form-cancel" onClick={() => {
                  setShowCommandAddForm(false);
                  resetCommandDraft();
                }}>取消</button>
                <button
                  className="add-form-confirm"
                  onClick={handleAddShortcutCommand}
                  disabled={!commandDraftName.trim() || !commandDraftValue.trim()}
                >
                  添加
                </button>
              </div>
            </div>
          )}

          <div className="panel-divider" />

          <div className="panel-setting-item">
            <span className="panel-setting-label">使用系统代理</span>
            <button
              className={`toggle-switch ${useSystemProxy ? 'active' : ''}`}
              onClick={() => {
                const newVal = !useSystemProxy;
                setUseSystemProxy(newVal);
                persistSettings({ useSystemProxy: newVal });
              }}
              role="switch"
              aria-checked={useSystemProxy}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
