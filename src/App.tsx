import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, Trash2, X, ChevronDown, ChevronUp, Globe, RefreshCw, Home, Star } from 'lucide-react';
import './App.css';
import appLogo from '../src-tauri/icons/128x128.png';

// Preload all SVG/PNG icons from the assets folder using Vite
const iconModules = import.meta.glob('/src/assets/icons/*.{svg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const getIconUrl = (id: string, name: string) => {
  const normalizedId = id.toLowerCase();
  const normalizedName = name.toLowerCase();

  // Custom mapping for aliases (e.g. Chatgpt -> openai)
  let searchTerms = [normalizedId, normalizedName];
  if (normalizedId.includes('chatgpt') || normalizedName.includes('chatgpt')) searchTerms.push('openai');
  if (normalizedId.includes('tongyi') || normalizedName.includes('tongyi')) searchTerms.push('qwen');
  if (normalizedName.includes('minimax') || normalizedId.includes('minimax')) searchTerms.push('minimax');

  for (const path in iconModules) {
    const filename = path.split('/').pop()?.toLowerCase() || '';
    // If filename contains any of the search terms
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
const SETTINGS_DEFAULTS = { useSystemProxy: true };
const COMMAND_SETTINGS_DEFAULTS: ShortcutCommandSettings = { defaultExecMode: 'shell_with_output' };

// Try loading from Rust file first, fall back to localStorage for migration
async function loadPlatformsAsync(): Promise<Platform[]> {
  try {
    const data: string = await invoke('load_platforms');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { }
  // Fallback: migrate from localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Save to file backend for future use
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
  // Also keep localStorage in sync for dev mode
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


// Component to render platform favicon from local assets with fallback to website favicon
function PlatformIcon({ platformId, platformName, url, size = 16 }: { platformId: string; platformName: string; url?: string; size?: number }) {
  const [error, setError] = useState(false);
  const iconUrl = getIconUrl(platformId, platformName);

  // If no matching local SVG/PNG was found, or if local loading failed, try fetching website favicon
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
            onError={() => setError(true)} // If favicon also fails, it will hit error state again
          />
        );
      } catch {
        // Fallback to globe if URL is invalid
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
        // If local icon fails to load, the component will re-render and try the favicon/globe logic
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
  const [useSystemProxy, setUseSystemProxy] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommand[]>([]);
  const [commandSettings, setCommandSettings] = useState<ShortcutCommandSettings>(COMMAND_SETTINGS_DEFAULTS);
  const [showCommandAddForm, setShowCommandAddForm] = useState(false);
  const [commandDraftName, setCommandDraftName] = useState('');
  const [commandDraftValue, setCommandDraftValue] = useState('');
  const [commandOutputs, setCommandOutputs] = useState<Record<string, { output: string; error: string; exitCode: number | null }>>({});
  const [expandedCommandOutputs, setExpandedCommandOutputs] = useState<Record<string, boolean>>({});
  const [commandStatuses, setCommandStatuses] = useState<Record<string, 'running' | 'success' | 'error'>>({});

  // Hover state for tab actions (replacing dropdown context menu due to native webview clipping)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  // Add form state
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickUrl, setQuickUrl] = useState('');

  // Load platforms and settings from file on startup
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
    // Load settings
    invoke('load_settings').then((data: unknown) => {
      try {
        const parsed = JSON.parse(data as string);
        const settings = { ...SETTINGS_DEFAULTS, ...parsed };
        setUseSystemProxy(settings.useSystemProxy);
        const loadedCommands = Array.isArray(parsed?.shortcutCommands) ? parsed.shortcutCommands : [];
        const loadedCommandSettings = { ...COMMAND_SETTINGS_DEFAULTS, ...(parsed?.shortcutCommandSettings || {}) };
        setShortcutCommands(loadedCommands);
        setCommandSettings(loadedCommandSettings);
      } catch { }
    }).catch(() => { });
  }, []);

  // Make sure we have an active tab if platforms exist but activeTab is empty
  useEffect(() => {
    const visiblePlatforms = platforms.filter(p => !p.hidden);
    const all = [...visiblePlatforms, ...tempTabs];
    if (all.length > 0 && (!activeTab || (platforms.find(p => p.id === activeTab)?.hidden))) {
      setActiveTab(all[0].id);
    }
  }, [platforms, tempTabs, activeTab]);

  // Save platforms whenever they change (skip initial empty state)
  useEffect(() => {
    if (initialized) {
      savePlatformsToFile(platforms);
    }
  }, [platforms, initialized]);

  // Create or show webview when active tab changes (only if settings is closed)
  useEffect(() => {
    if (showSettings || !activeTab) return;
    const platform = tempTabs.find(p => p.id === activeTab) || platforms.find(p => p.id === activeTab);
    if (!platform) return;
    if (!platform.url || !platform.url.trim()) {
      invoke('hide_all_webviews').catch(console.error);
      return;
    }
    if (platform) {
      invoke('create_or_show_webview', {
        platformId: platform.id,
        url: platform.url,
        topOffset: 70.0
      }).catch(console.error);
    }
  }, [activeTab, platforms, tempTabs, showSettings]);

  // 监听来自子 WebView 的新窗口请求，转为应用内新建临时标签
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

  const toggleSettings = () => {
    if (!showSettings) {
      // Opening settings: hide all child webviews so the panel is visible
      invoke('hide_all_webviews').catch(console.error);
      setShowSettings(true);
      setShowQuickAdd(false);
      setShowCommandAddForm(false);
    } else {
      // Closing settings: re-show the active webview
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

  const resetCommandDraft = () => {
    setCommandDraftName('');
    setCommandDraftValue('');
  };

  const saveSettings = (next: Record<string, unknown>) => {
    invoke('save_settings', { data: JSON.stringify(next) }).catch(console.error);
  };

  const updateCommandSettings = (partial: Partial<ShortcutCommandSettings>) => {
    setCommandSettings(prev => {
      const next = { ...prev, ...partial };
      saveSettings({ useSystemProxy, shortcutCommands, shortcutCommandSettings: next });
      return next;
    });
  };

  const updateShortcutCommands = (updater: (prev: ShortcutCommand[]) => ShortcutCommand[]) => {
    setShortcutCommands(prev => {
      const next = updater(prev);
      saveSettings({ useSystemProxy, shortcutCommands: next, shortcutCommandSettings: commandSettings });
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
      const preset = POPULAR_PLATFORMS[parseInt(val)];
      if (preset) {
        setNewName(preset.name);
        setNewUrl(preset.url);
      }
    }
  };


  const handleAddPlatform = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const id = newName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();

    // Ensure URL has protocol
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
        setActiveTab(updated.length > 0 ? updated[0].id : '');
      }
      return updated;
    });
  };

  const handleReloadPlatform = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
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
    invoke('destroy_webview', { platformId: id }).catch(console.error);
    const isTemp = tempTabs.some(p => p.id === id);
    if (isTemp) {
      const tempAfter = tempTabs.filter(p => p.id !== id);
      if (activeTab === id) {
        const combined = [...platforms, ...tempAfter];
        setActiveTab(combined.length ? combined[0].id : '');
      }
      setTempTabs(tempAfter);
      return;
    }
    // For fixed platforms, we just hide them
    setPlatforms(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, hidden: true } : p);
      if (activeTab === id) {
        const visibleAfter = updated.filter(p => !p.hidden);
        const combined = [...visibleAfter, ...tempTabs];
        setActiveTab(combined.length ? combined[0].id : '');
      }
      return updated;
    });
  };

  const handleMenuHome = (id: string, url: string) => {
    invoke('reload_webview_url', { platformId: id, url }).catch(console.error);
  };

  const handleMenuSaveToFavorites = (platform: Platform) => {
    // move from temp tabs to platforms
    const p = { ...platform, id: platform.id.replace('tmp-', 'fixed-') };
    setPlatforms(prev => [...prev, p]);
    setTempTabs(prev => prev.filter(t => t.id !== platform.id));
    setActiveTab(p.id);
  };

  return (
    <div className="app-container">
      <div className="titlebar">
        <div className="tabs-container">
          <button className="icon-button settings-logo-btn" onClick={toggleSettings} aria-label="设置">
            <img src={appLogo} alt="Brainer Logo" className="app-logo-small" />
          </button>
          {platforms.filter(p => !p.hidden).map((platform) => (
            <div
              key={platform.id}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
              onMouseEnter={() => setHoveredTab(platform.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {activeTab === platform.id && (
                <button
                  className="tab-refresh-btn tab-refresh-left"
                  onClick={(e) => handleReloadPlatform(e, platform.id)}
                  title="刷新"
                  aria-label="刷新当前标签"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <div className="tab-info">
                <PlatformIcon platformId={platform.id} platformName={platform.name} url={platform.url} size={16} />
                <span className="tab-name-text" style={{ opacity: hoveredTab === platform.id ? 0 : 1 }}>{platform.name}</span>
                {hoveredTab === platform.id && (
                  <div className="tab-hover-menu">
                    <button
                      className="tab-hover-btn"
                      title="返回主页"
                      onClick={(e) => { e.stopPropagation(); handleMenuHome(platform.id, platform.url); }}
                      aria-label="返回主页"
                    >
                      <Home size={14} />
                    </button>
                  </div>
                )}
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
          ))}
          {platforms.filter(p => !p.hidden).length > 0 && tempTabs.length > 0 && (
            <div className="tab-divider" aria-hidden="true" />
          )}
          {tempTabs.map((platform) => (
            <div
              key={platform.id}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
              onMouseEnter={() => setHoveredTab(platform.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {activeTab === platform.id && (
                <button
                  className="tab-refresh-btn tab-refresh-left"
                  onClick={(e) => handleReloadPlatform(e, platform.id)}
                  title="刷新"
                  aria-label="刷新当前标签"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <div className="tab-info">
                <PlatformIcon platformId={platform.id} platformName={platform.name} url={platform.url} size={16} />
                <span className="tab-name-text" style={{ opacity: hoveredTab === platform.id ? 0 : 1 }}>{platform.name}</span>
                {hoveredTab === platform.id && (
                  <div className="tab-hover-menu">
                    <button
                      className="tab-hover-btn"
                      title="返回主页"
                      onClick={(e) => { e.stopPropagation(); handleMenuHome(platform.id, platform.url); }}
                      aria-label="返回主页"
                    >
                      <Home size={14} />
                    </button>
                    <button
                      className="tab-hover-btn"
                      title="保存到我的收藏"
                      onClick={(e) => { e.stopPropagation(); handleMenuSaveToFavorites(platform); }}
                      aria-label="保存到我的收藏"
                    >
                      <Star size={14} />
                    </button>
                  </div>
                )}
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
          ))}

          <div className="tab-add-wrapper">
            <button
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
            {showQuickAdd && (
              <div className="tab-add-popover">
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
                          const next = [...platforms, ...updated];
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
              </div>
            )}
          </div>
        </div>

        <div className="titlebar-actions">
          {/* Settings button moved to the left */}
        </div>
      </div>

      <div
        className={`tab-add-backdrop ${showQuickAdd ? 'open' : ''}`}
        onClick={() => {
          setShowQuickAdd(false);
          resetQuickAdd();
          const currentTemp = tempTabs.find(p => p.id === activeTab);
          if (currentTemp && (!currentTemp.url || !currentTemp.url.trim())) {
            setTempTabs(prev => {
              const updated = prev.filter(p => p.id !== activeTab);
              const next = [...platforms, ...updated];
              setActiveTab(next.length ? next[0].id : '');
              return updated;
            });
          }
        }}

      />

      {/* Settings Slide-in Panel + Backdrop */}
      <div className={`settings-backdrop ${showSettings ? 'open' : ''}`} onClick={toggleSettings} />
      <div className={`settings-panel ${showSettings ? 'open' : ''}`}>
        <div className="panel-header">
          <h3>管理标签页</h3>
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
                saveSettings({ useSystemProxy: newVal, shortcutCommands, shortcutCommandSettings: commandSettings });
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
