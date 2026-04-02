import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, ArrowRight, ArrowUp, Bot, Brain, Copy, Globe, Home, Plus, RefreshCw, Sparkles, Square, Star, Volume2, VolumeX, X } from 'lucide-react';
import ComposerSelect from './components/chat/ComposerSelect';
import SettingsPanel from './components/settings/SettingsPanel';
import {
  AI_CHAT_TAB,
  AI_CHAT_TAB_ID,
  AI_PROVIDER_DEFAULTS,
  COMMAND_SETTINGS_DEFAULTS,
  COMMAND_STATUS_LABELS,
  EXEC_MODE_OPTIONS,
  POPULAR_PLATFORMS,
  SETTINGS_DEFAULTS,
  THINKING_DEPTH_OPTIONS,
} from './app/constants';
import { AI_MODEL_CONTEXT_DEFAULT, createAiModelConfig, normalizeAiProviderSettings } from './features/ai-chat/provider';
import PlatformIcon from './features/platforms/PlatformIcon';
import { deriveNameFromUrl, loadPlatformsAsync, normalizeUrl, savePlatformsToFile } from './features/platforms/platformUtils';
import { useAiChat } from './hooks/useAiChat';
import type {
  AiModelConfig,
  AiProviderSettings,
  BrowserNavigationState,
  CommandExecMode,
  ExecMode,
  Platform,
  PersistedChatHistory,
  ShortcutCommand,
  ShortcutCommandSettings,
  ThinkingDepth,
} from './types/app';
import './App.css';
import appLogo from '../src-tauri/icons/128x128.png';

interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  isTextExtracted: boolean;
}

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'kt', 'swift', 'html', 'css', 'scss', 'less', 'sql',
  'yaml', 'yml', 'xml', 'sh', 'bash', 'zsh', 'log'
]);

const MAX_ATTACHMENT_TEXT_BYTES = 200_000;
const MAX_ATTACHMENT_TEXT_CHARS = 20_000;

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function canExtractAttachmentText(file: File) {
  if (file.size > MAX_ATTACHMENT_TEXT_BYTES) return false;
  if (file.type.startsWith('text/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return TEXT_ATTACHMENT_EXTENSIONS.has(extension);
}

async function buildChatAttachment(file: File): Promise<ChatAttachment> {
  const isTextExtracted = canExtractAttachmentText(file);
  let content = '';

  if (isTextExtracted) {
    try {
      content = (await file.text()).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    } catch {
      content = '';
    }
  }

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
    type: file.type,
    content,
    isTextExtracted: Boolean(content),
  };
}

function buildAttachmentContext(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return '';

  return [
    '附件信息：',
    ...attachments.map((attachment, index) => {
      const header = `${index + 1}. ${attachment.name} (${formatAttachmentSize(attachment.size)})`;
      if (attachment.isTextExtracted && attachment.content) {
        return `${header}\n内容摘录：\n${attachment.content}`;
      }
      return `${header}\n说明：该附件仅附带文件名和大小，当前未提取正文内容。`;
    })
  ].join('\n\n');
}

type RenderContentBlock =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language: string };

function parseMessageContentBlocks(content: string): RenderContentBlock[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const blocks: RenderContentBlock[] = [];
  const codeBlockPattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of normalized.matchAll(codeBlockPattern)) {
    const matchIndex = match.index ?? 0;
    const [fullMatch, language = '', codeContent = ''] = match;

    if (matchIndex > lastIndex) {
      const textContent = normalized.slice(lastIndex, matchIndex);
      if (textContent) {
        blocks.push({ type: 'text', content: textContent });
      }
    }

    blocks.push({
      type: 'code',
      language: language.trim(),
      content: codeContent.replace(/\n$/, ''),
    });
    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < normalized.length) {
    const textContent = normalized.slice(lastIndex);
    if (textContent) {
      blocks.push({ type: 'text', content: textContent });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: normalized }];
}

function renderInlineCode(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlineCodePattern = /`([^`\n]+)`/g;
  let lastIndex = 0;

  for (const match of content.matchAll(inlineCodePattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      nodes.push(content.slice(lastIndex, matchIndex));
    }

    nodes.push(
      <code
        key={`inline-code-${matchIndex}-${match[1]}`}
        className="ai-workbuddy-inline-code"
      >
        {match[1]}
      </code>
    );
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [content];
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
  const [persistedChatHistory, setPersistedChatHistory] = useState<PersistedChatHistory | null>(null);
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);
  const [showAiModelAddForm, setShowAiModelAddForm] = useState(false);
  const [aiModelDraft, setAiModelDraft] = useState('');
  const [aiContextDraft, setAiContextDraft] = useState(AI_MODEL_CONTEXT_DEFAULT);
  const [browserNavStates, setBrowserNavStates] = useState<Record<string, BrowserNavigationState>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const quickAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatPersistTimeoutRef = useRef<number | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickUrl, setQuickUrl] = useState('');
  const [quickAddPosition, setQuickAddPosition] = useState({ top: 0, left: 0 });
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('high');
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [codeBlockCopyState, setCodeBlockCopyState] = useState<Record<string, 'success' | 'error'>>({});
  const {
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
  } = useAiChat({
    aiProvider,
    speechRate,
    persistedHistory: persistedChatHistory,
    historyLoaded: chatHistoryLoaded,
    onHistoryChange: setPersistedChatHistory,
  });

  const allVisibleTabs = useMemo(() => {
    const visiblePlatforms = platforms.filter(p => !p.hidden);
    const aiTabs = aiProvider.enabled ? [AI_CHAT_TAB] : [];
    return [...aiTabs, ...visiblePlatforms, ...tempTabs];
  }, [platforms, tempTabs, aiProvider.enabled]);

  const isActiveAiChat = activeTab === AI_CHAT_TAB_ID;
  const activeBrowserPlatform = useMemo(
    () => tempTabs.find(p => p.id === activeTab) || platforms.find(p => p.id === activeTab) || null,
    [activeTab, platforms, tempTabs]
  );
  const activePinnedPlatform = useMemo(
    () => platforms.find(platform => platform.id === activeTab) ?? null,
    [platforms, activeTab]
  );
  const activeTempPlatform = useMemo(
    () => tempTabs.find(platform => platform.id === activeTab) ?? null,
    [tempTabs, activeTab]
  );
  const activeBrowserUrl = activeBrowserPlatform?.url?.trim() || '';
  const activeBrowserNavState = activeTab ? browserNavStates[activeTab] : undefined;
  const activeBrowserDisplayUrl = activeBrowserNavState?.currentUrl || activeBrowserUrl || (isActiveAiChat ? 'AnyBrain AI 对话' : '输入网址或在标签页中打开页面');
  const activeFavoriteUrl = useMemo(
    () => normalizeUrl(activeBrowserNavState?.currentUrl || activeBrowserUrl),
    [activeBrowserNavState?.currentUrl, activeBrowserUrl]
  );
  const matchingPinnedPlatform = useMemo(
    () => {
      if (!activeFavoriteUrl) return null;
      return platforms.find(platform => normalizeUrl(platform.url) === activeFavoriteUrl) ?? null;
    },
    [platforms, activeFavoriteUrl]
  );
  const isActiveTabFavorited = Boolean(activePinnedPlatform || matchingPinnedPlatform);
  const canFavoriteActiveTab = !isActiveAiChat && Boolean(activeBrowserPlatform && activeFavoriteUrl);
  const availableAiModels = useMemo(
    () => (Array.isArray(aiProvider.models) ? aiProvider.models.filter(model => model.modelId.trim()) : []),
    [aiProvider.models]
  );
  const lastUserMessageId = useMemo(() => {
    for (let index = activeChatMessages.length - 1; index >= 0; index -= 1) {
      const message = activeChatMessages[index];
      if (message.role === 'user') {
        return message.id;
      }
    }
    return '';
  }, [activeChatMessages]);
  const aiModelOptions = useMemo(
    () => availableAiModels.map(model => ({
      value: model.modelId,
      label: model.modelId,
    })),
    [availableAiModels]
  );

  const handleCreateChatSession = () => {
    createSession();
  };

  const handleUploadChatFile = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const nextAttachments = await Promise.all(files.map(buildChatAttachment));
    setChatAttachments(prev => [...prev, ...nextAttachments]);
    event.target.value = '';
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setChatAttachments(prev => prev.filter(attachment => attachment.id !== attachmentId));
  };

  const handleSendComposer = async () => {
    const sent = await sendChat({
      reasoningEffort: thinkingDepth,
      attachmentContext: buildAttachmentContext(chatAttachments),
    });

    if (sent) {
      setChatAttachments([]);
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    await retryMessage(messageId, thinkingDepth);
  };

  const copyCodeBlock = async (blockId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCodeBlockCopyState(prev => ({ ...prev, [blockId]: 'success' }));
    } catch {
      setCodeBlockCopyState(prev => ({ ...prev, [blockId]: 'error' }));
    } finally {
      window.setTimeout(() => {
        setCodeBlockCopyState(prev => {
          const next = { ...prev };
          delete next[blockId];
          return next;
        });
      }, 1600);
    }
  };

  const renderMessageContent = (messageId: string, content: string) => {
    const blocks = parseMessageContentBlocks(content);

    return blocks.map((block, index) => {
      if (block.type === 'code') {
        const blockId = `${messageId}-code-${index}`;
        const copyState = codeBlockCopyState[blockId];
        const copyLabel = copyState === 'success' ? '已复制' : copyState === 'error' ? '复制失败' : '复制';

        return (
          <div key={blockId} className="ai-workbuddy-code-block">
            <div className="ai-workbuddy-code-header">
              <span className="ai-workbuddy-code-language">{block.language || 'code'}</span>
              <button
                className={`ai-workbuddy-code-copy-btn ${copyState ? `is-${copyState}` : ''}`}
                type="button"
                onClick={() => void copyCodeBlock(blockId, block.content)}
                title={copyLabel}
                aria-label={copyLabel}
              >
                <Copy size={12} />
                <span>{copyLabel}</span>
              </button>
            </div>
            <pre className="ai-workbuddy-code-pre">
              <code>{block.content}</code>
            </pre>
          </div>
        );
      }

      return (
        <div key={`${messageId}-text-${index}`} className="ai-workbuddy-text-block">
          {renderInlineCode(block.content)}
        </div>
      );
    });
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
        const loadedChatHistory = parsed?.chatHistory && typeof parsed.chatHistory === 'object'
          ? parsed.chatHistory as PersistedChatHistory
          : null;
        setShortcutCommands(loadedCommands);
        setCommandSettings(loadedCommandSettings);
        setAiProvider(loadedAiProvider);
        setPersistedChatHistory(loadedChatHistory);
        setChatHistoryLoaded(true);
        setSettingsLoaded(true);
      } catch {
        setChatHistoryLoaded(true);
        setSettingsLoaded(true);
      }
    }).catch(() => {
      setChatHistoryLoaded(true);
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
      const [unlistenNewTab, unlistenNavState, unlistenNavRemoved] = await Promise.all([
        listen<string>('new_tab_request', (event) => {
          const url = event.payload || '';
          if (!url) return;
          const id = `tmp-${Date.now()}`;
          const name = deriveNameFromUrl(url);
          setTempTabs(prev => [...prev, { id, name, url }]);
          setActiveTab(id);
        }),
        listen<BrowserNavigationState>('browser_navigation_state', (event) => {
          const payload = event.payload;
          if (!payload?.platformId) return;
          setBrowserNavStates(prev => ({ ...prev, [payload.platformId]: payload }));
        }),
        listen<string>('browser_navigation_state_removed', (event) => {
          const platformId = event.payload;
          if (!platformId) return;
          setBrowserNavStates(prev => {
            const next = { ...prev };
            delete next[platformId];
            return next;
          });
        })
      ]);

      return () => {
        try { unlistenNewTab(); } catch { }
        try { unlistenNavState(); } catch { }
        try { unlistenNavRemoved(); } catch { }
      };
    })();
    return () => {
      unlistenPromise.then(u => { try { u(); } catch { } });
    };
  }, []);

  useEffect(() => {
    if (isActiveAiChat && !showSettings) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChatMessages, isActiveAiChat, showSettings]);

  const saveSettings = (next: Record<string, unknown>) => {
    invoke('save_settings', { data: JSON.stringify(next) }).catch(console.error);
  };

  const persistSettings = (overrides: Partial<{
    useSystemProxy: boolean;
    speechRate: number;
    shortcutCommands: ShortcutCommand[];
    shortcutCommandSettings: ShortcutCommandSettings;
    aiProvider: AiProviderSettings;
    chatHistory: PersistedChatHistory | null;
  }> = {}) => {
    saveSettings({
      useSystemProxy: overrides.useSystemProxy ?? useSystemProxy,
      speechRate: overrides.speechRate ?? speechRate,
      shortcutCommands: overrides.shortcutCommands ?? shortcutCommands,
      shortcutCommandSettings: overrides.shortcutCommandSettings ?? commandSettings,
      aiProvider: overrides.aiProvider ?? aiProvider,
      chatHistory: overrides.chatHistory ?? persistedChatHistory,
    });
  };

  useEffect(() => {
    if (!settingsLoaded || !chatHistoryLoaded || !persistedChatHistory) return;

    if (chatPersistTimeoutRef.current) {
      window.clearTimeout(chatPersistTimeoutRef.current);
    }

    chatPersistTimeoutRef.current = window.setTimeout(() => {
      persistSettings({ chatHistory: persistedChatHistory });
      chatPersistTimeoutRef.current = null;
    }, 300);

    return () => {
      if (chatPersistTimeoutRef.current) {
        window.clearTimeout(chatPersistTimeoutRef.current);
        chatPersistTimeoutRef.current = null;
      }
    };
  }, [persistedChatHistory, settingsLoaded, chatHistoryLoaded]);

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
    const currentModel = currentModels.find(model => model.id === modelId);
    const previousModelId = currentModel?.modelId ?? '';
    const nextModels = currentModels.map(model => (
      model.id === modelId
        ? {
          ...model,
          ...partial,
          contextLength: (partial.contextLength ?? model.contextLength).trim() || AI_MODEL_CONTEXT_DEFAULT,
        }
        : model
    ));
    const updatedModelId = nextModels.find(model => model.id === modelId)?.modelId.trim() ?? '';
    const fallbackModelId = nextModels.find(model => model.modelId.trim())?.modelId ?? '';
    const nextActiveModelId = aiProvider.modelId === previousModelId
      ? (updatedModelId || fallbackModelId)
      : (nextModels.some(model => model.modelId.trim() && model.modelId === aiProvider.modelId)
        ? aiProvider.modelId
        : fallbackModelId);
    const nextCompressionModelId = aiProvider.compressionModelId === previousModelId
      ? updatedModelId
      : (nextModels.some(model => model.modelId.trim() && model.modelId === aiProvider.compressionModelId)
        ? aiProvider.compressionModelId
        : '');

    updateAiProvider({
      models: nextModels,
      modelId: nextActiveModelId,
      compressionModelId: nextCompressionModelId,
    });
  };

  const handleRemoveAiModel = (modelId: string) => {
    const currentModels = Array.isArray(aiProvider.models) ? aiProvider.models : [];
    const removedModel = currentModels.find(model => model.id === modelId);
    const removedModelId = removedModel?.modelId ?? '';
    const nextModels = currentModels.filter(model => model.id !== modelId);
    const fallbackModelId = nextModels.find(model => model.modelId.trim())?.modelId ?? '';
    updateAiProvider({
      models: nextModels.length > 0 ? nextModels : [createAiModelConfig('', AI_MODEL_CONTEXT_DEFAULT)],
      modelId: nextModels.some(model => model.modelId === aiProvider.modelId)
        ? aiProvider.modelId
        : fallbackModelId,
      compressionModelId: aiProvider.compressionModelId === removedModelId
        ? ''
        : (nextModels.some(model => model.modelId === aiProvider.compressionModelId)
          ? aiProvider.compressionModelId
          : ''),
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

  const handlePresetSelect = (e: ChangeEvent<HTMLSelectElement>) => {
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

  const handleFavoriteActiveTab = () => {
    if (!activeBrowserPlatform || isActiveAiChat) return;

    const favoriteUrl = activeFavoriteUrl;
    if (!favoriteUrl) return;

    const duplicatePlatform = platforms.find(platform => normalizeUrl(platform.url) === favoriteUrl) ?? null;
    if (duplicatePlatform) {
      if (duplicatePlatform.hidden) {
        setPlatforms(prev => prev.map(platform => (
          platform.id === duplicatePlatform.id
            ? { ...platform, hidden: false }
            : platform
        )));
      }

      if (activeTempPlatform) {
        invoke('destroy_webview', { platformId: activeTempPlatform.id }).catch(console.error);
        setTempTabs(prev => prev.filter(platform => platform.id !== activeTempPlatform.id));
      }

      setActiveTab(duplicatePlatform.id);
      return;
    }

    const nextName = activeBrowserPlatform.name.trim() && activeBrowserPlatform.name !== '新标签'
      ? activeBrowserPlatform.name.trim()
      : deriveNameFromUrl(favoriteUrl);
    const nextPlatform: Platform = {
      id: `${nextName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: nextName,
      url: favoriteUrl,
    };

    setPlatforms(prev => [...prev, nextPlatform]);

    if (activeTempPlatform) {
      invoke('destroy_webview', { platformId: activeTempPlatform.id }).catch(console.error);
      setTempTabs(prev => prev.filter(platform => platform.id !== activeTempPlatform.id));
    }

    setActiveTab(nextPlatform.id);
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

  const handleReloadPlatform = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === AI_CHAT_TAB_ID) {
      if (!activeChatSessionId) {
        handleCreateChatSession();
      } else {
        resetActiveSession();
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

  const handleCloseTab = (e: MouseEvent, id: string) => {
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

  const handleMenuHome = (id: string) => {
    invoke('navigate_webview_home', { platformId: id }).catch(console.error);
  };

  const handleNavigateBack = () => {
    if (!activeBrowserPlatform) return;
    invoke('navigate_webview_back', { platformId: activeBrowserPlatform.id }).catch(console.error);
  };

  const handleNavigateForward = () => {
    if (!activeBrowserPlatform) return;
    invoke('navigate_webview_forward', { platformId: activeBrowserPlatform.id }).catch(console.error);
  };

  return (
    <div className="app-container">
      <div className={`top-shell ${isActiveAiChat ? 'without-browser-toolbar' : ''}`}>
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
            return (
            <div
              key={platform.id}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
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
            return (
            <div
              key={platform.id}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
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
          </div>
        </div>

        <div className="titlebar-actions" />
      </div>

      {!isActiveAiChat && (
        <div className={`browser-toolbar ${showSettings ? 'is-hidden' : ''}`}>
          <div className="browser-toolbar-nav">
            <button
              className="browser-toolbar-btn"
              type="button"
              aria-label="后退"
              title="后退"
              onClick={handleNavigateBack}
              disabled={!activeBrowserPlatform || isActiveAiChat || !activeBrowserNavState?.canGoBack}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              className="browser-toolbar-btn"
              type="button"
              aria-label="前进"
              title="前进"
              onClick={handleNavigateForward}
              disabled={!activeBrowserPlatform || isActiveAiChat || !activeBrowserNavState?.canGoForward}
            >
              <ArrowRight size={16} />
            </button>
            <button
              className="browser-toolbar-btn"
              type="button"
              aria-label={isActiveAiChat ? '清空当前会话' : '刷新当前标签'}
              title={isActiveAiChat ? '清空当前会话' : '刷新当前标签'}
              onClick={(e) => handleReloadPlatform(e, activeTab)}
              disabled={!activeTab}
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="browser-toolbar-btn"
              type="button"
              aria-label="返回主页"
              title="返回主页"
              onClick={() => {
                if (!activeBrowserPlatform) return;
                handleMenuHome(activeBrowserPlatform.id);
              }}
              disabled={!activeBrowserPlatform || isActiveAiChat}
            >
              <Home size={16} />
            </button>
            <button
              className={`browser-toolbar-btn ${isActiveTabFavorited ? 'is-active' : ''}`}
              type="button"
              aria-label={activePinnedPlatform ? '当前标签已收藏' : matchingPinnedPlatform ? '跳转到已收藏标签' : '保存到固定标签页'}
              title={activePinnedPlatform ? '当前标签已收藏' : matchingPinnedPlatform ? '跳转到已收藏标签' : '保存到固定标签页'}
              onClick={handleFavoriteActiveTab}
              disabled={!canFavoriteActiveTab || Boolean(activePinnedPlatform)}
            >
              <Star size={16} />
            </button>
          </div>

          <div className={`browser-toolbar-address ${isActiveAiChat ? 'is-ai-chat' : ''}`}>
            <Globe size={16} className="browser-toolbar-address-icon" />
            <input
              className="browser-toolbar-address-input"
              value={activeBrowserDisplayUrl}
              readOnly
              aria-label="当前地址"
            />
            {activeBrowserNavState?.isLoading && !isActiveAiChat && (
              <span className="browser-toolbar-loading" aria-label="页面加载中">加载中</span>
            )}
          </div>
        </div>
      )}
      </div>

      {isActiveAiChat && !showSettings && (
        <main className="ai-workbuddy-shell">
          <aside className="ai-workbuddy-sidebar">
            <button className="ai-workbuddy-new-session" onClick={handleCreateChatSession} type="button">
              <Plus size={15} />
              <span>开启新会话</span>
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
                      <div className={`ai-workbuddy-avatar ${message.role === 'assistant' && message.status === 'streaming' ? 'is-streaming' : ''}`}>
                        {message.role === 'assistant' ? <Bot size={16} /> : <span>你</span>}
                      </div>
                      <div className="ai-workbuddy-meta-text">
                        <span className="ai-workbuddy-role">{message.role === 'assistant' ? 'AnyBrain' : '你'}</span>
                        <span className="ai-workbuddy-time">{message.status === 'streaming' ? '思考中' : message.status === 'error' ? '请求失败' : '刚刚'}</span>
                      </div>
                    </div>

                    <div className="ai-workbuddy-bubble-stack">
                      <div className="ai-workbuddy-bubble-shell">
                        <div className="ai-workbuddy-bubble-glow" />
                        <div className="ai-workbuddy-bubble">
                          <div className="ai-workbuddy-content">{renderMessageContent(message.id, message.content)}</div>
                        </div>
                      </div>

                      <div className="ai-workbuddy-actions">
                        {message.role === 'user' && message.id === lastUserMessageId && (
                          <button
                            className="ai-workbuddy-action-btn"
                            onClick={() => void handleRetryMessage(message.id)}
                            title="重试调用模型"
                            aria-label="重试调用模型"
                            disabled={chatSending}
                          >
                            <RefreshCw size={12} />
                            <span>重试</span>
                          </button>
                        )}
                        <button
                          className={`ai-workbuddy-action-btn ${chatCopyState[message.id] ? `is-${chatCopyState[message.id]}` : ''}`}
                          onClick={() => void copyMessage(message.id, message.content)}
                          title={chatCopyState[message.id] === 'success' ? '已复制' : chatCopyState[message.id] === 'error' ? '复制失败' : '复制消息'}
                          aria-label={chatCopyState[message.id] === 'success' ? '已复制' : chatCopyState[message.id] === 'error' ? '复制失败' : '复制消息'}
                        >
                          <Copy size={12} />
                          <span>{chatCopyState[message.id] === 'success' ? '已复制' : '复制'}</span>
                        </button>
                        <button
                          className={`ai-workbuddy-action-btn ${chatSpeakingId === message.id ? 'is-speaking' : ''}`}
                          onClick={() => speakMessage(message.id, message.content)}
                          title={chatSpeakingId === message.id ? '停止朗读' : '朗读消息'}
                          aria-label={chatSpeakingId === message.id ? '停止朗读' : '朗读消息'}
                        >
                          {chatSpeakingId === message.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                          <span>{chatSpeakingId === message.id ? '停止' : '朗读'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <footer className="ai-workbuddy-composer-wrap">
              <div className="ai-workbuddy-composer">
                {chatError && <div className="ai-workbuddy-error">{chatError}</div>}

                {chatAttachments.length > 0 && (
                  <div className="ai-workbuddy-attachment-list">
                    {chatAttachments.map(attachment => (
                      <div key={attachment.id} className="ai-workbuddy-attachment-chip">
                        <div className="ai-workbuddy-attachment-meta">
                          <span className="ai-workbuddy-attachment-name">{attachment.name}</span>
                          <span className="ai-workbuddy-attachment-size">
                            {formatAttachmentSize(attachment.size)}
                            {attachment.isTextExtracted ? ' · 已读取' : ' · 元数据'}
                          </span>
                        </div>
                        <button
                          className="ai-workbuddy-attachment-remove"
                          type="button"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          aria-label={`移除附件 ${attachment.name}`}
                          title="移除附件"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ai-workbuddy-input-row">
                  <textarea
                    className="ai-workbuddy-textarea"
                    placeholder="Ask for follow-up changes"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendComposer();
                      }
                    }}
                  />
                </div>

                <div className="ai-workbuddy-composer-bottom">
                  <div className="ai-workbuddy-composer-controls">
                    <button
                      className="ai-workbuddy-icon-btn ai-workbuddy-attach-trigger"
                      type="button"
                      onClick={handleUploadChatFile}
                      title="添加附件"
                      aria-label="添加附件"
                    >
                      <Plus size={16} />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="ai-workbuddy-file-input"
                      tabIndex={-1}
                      aria-hidden="true"
                      multiple
                      onChange={handleAttachmentSelect}
                    />

                    <div className="ai-workbuddy-model-pill ai-workbuddy-model-picker">
                      <Bot size={13} />
                      <ComposerSelect
                        title="Select model"
                        value={aiProvider.modelId}
                        placeholder="No model"
                        options={aiModelOptions}
                        onChange={value => updateAiProvider({ modelId: value })}
                        disabled={aiModelOptions.length === 0}
                        className="ai-workbuddy-composer-select"
                      />
                    </div>

                    <div className="ai-workbuddy-model-pill ai-workbuddy-depth-picker">
                      <Brain size={13} />
                      <ComposerSelect
                        title="Reasoning effort"
                        value={thinkingDepth}
                        placeholder="High"
                        options={THINKING_DEPTH_OPTIONS}
                        onChange={value => setThinkingDepth(value as ThinkingDepth)}
                        className="ai-workbuddy-composer-select"
                      />
                    </div>
                  </div>

                  <p className="ai-workbuddy-disclaimer ai-workbuddy-disclaimer-inline">AnyBrain 可能偶尔会产生不准确的信息，重要内容请注意核实。</p>

                  <button
                    className={`ai-workbuddy-send-btn ${chatSending ? 'is-sending' : ''}`}
                    type="button"
                    onClick={() => void handleSendComposer()}
                    disabled={chatSending || (!chatInput.trim() && chatAttachments.length === 0)}
                    aria-label={chatSending ? '发送中' : '发送消息'}
                    title={chatSending ? '发送中' : '发送消息'}
                  >
                    {chatSending ? <Square size={16} /> : <ArrowUp size={18} />}
                  </button>
                </div>
              </div>
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

      <SettingsPanel
        showSettings={showSettings}
        onClose={toggleSettings}
        platforms={platforms}
        activeTab={activeTab}
        onRestorePlatform={platformId => {
          setPlatforms(prev => prev.map(item => item.id === platformId ? { ...item, hidden: false } : item));
          setActiveTab(platformId);
        }}
        onMovePlatform={handleMovePlatform}
        onRemovePlatform={handleRemovePlatform}
        renderPlatformIcon={platform => <PlatformIcon platformId={platform.id} platformName={platform.name} url={platform.url} size={16} />}
        showAddForm={showAddForm}
        onShowAddForm={() => setShowAddForm(true)}
        selectedPreset={selectedPreset}
        popularPlatforms={POPULAR_PLATFORMS}
        onPresetSelect={value => handlePresetSelect({ target: { value } } as ChangeEvent<HTMLSelectElement>)}
        newName={newName}
        onNewNameChange={setNewName}
        newUrl={newUrl}
        onNewUrlChange={setNewUrl}
        onNewUrlFocus={() => {
          if (!newUrl.trim()) setNewUrl('https://');
        }}
        onNewUrlBlur={() => {
          if (newUrl.trim()) setNewUrl(normalizeUrl(newUrl));
        }}
        onAddPlatform={handleAddPlatform}
        onCancelAddPlatform={() => {
          setShowAddForm(false);
          resetAddForm();
        }}
        aiChatTabId={AI_CHAT_TAB_ID}
        aiProvider={aiProvider}
        onToggleAiEnabled={() => {
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
        onUpdateAiProvider={updateAiProvider}
        showAiModelAddForm={showAiModelAddForm}
        onShowAiModelAddForm={() => setShowAiModelAddForm(true)}
        onCancelAiModelAddForm={() => {
          setShowAiModelAddForm(false);
          resetAiModelDraft();
        }}
        aiModelDraft={aiModelDraft}
        onAiModelDraftChange={setAiModelDraft}
        aiContextDraft={aiContextDraft}
        onAiContextDraftChange={setAiContextDraft}
        onAddAiModel={handleAddAiModel}
        onUpdateAiModel={handleUpdateAiModel}
        onRemoveAiModel={handleRemoveAiModel}
        aiModelContextDefault={AI_MODEL_CONTEXT_DEFAULT}
        commandSettings={commandSettings}
        execModeOptions={EXEC_MODE_OPTIONS}
        onUpdateCommandSettings={partial => updateCommandSettings(partial)}
        shortcutCommands={shortcutCommands}
        commandOutputs={commandOutputs}
        expandedCommandOutputs={expandedCommandOutputs}
        commandStatuses={commandStatuses}
        commandStatusLabels={COMMAND_STATUS_LABELS}
        onToggleCommandOutput={commandId => setExpandedCommandOutputs(prev => ({ ...prev, [commandId]: !prev[commandId] }))}
        onCommandExecModeChange={(commandId, execMode) => handleCommandExecModeChange(commandId, execMode ?? 'inherit')}
        onExecuteCommand={handleExecuteCommand}
        onRemoveShortcutCommand={handleRemoveShortcutCommand}
        resolveCommandExecMode={resolveCommandExecMode}
        showCommandAddForm={showCommandAddForm}
        onShowCommandAddForm={() => setShowCommandAddForm(true)}
        onCancelCommandAddForm={() => {
          setShowCommandAddForm(false);
          resetCommandDraft();
        }}
        commandDraftName={commandDraftName}
        onCommandDraftNameChange={setCommandDraftName}
        commandDraftValue={commandDraftValue}
        onCommandDraftValueChange={setCommandDraftValue}
        onAddShortcutCommand={handleAddShortcutCommand}
        speechRate={speechRate}
        onSpeechRateChange={value => {
          setSpeechRate(value);
          invoke('set_tts_rate', { rate: value }).catch(console.error);
          persistSettings({ speechRate: value });
        }}
        useSystemProxy={useSystemProxy}
        onToggleSystemProxy={() => {
          const newVal = !useSystemProxy;
          setUseSystemProxy(newVal);
          persistSettings({ useSystemProxy: newVal });
        }}
      />
    </div>
  );
}

export default App;
