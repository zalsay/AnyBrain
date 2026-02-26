import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, Plus, Trash2, X, ChevronDown, ChevronUp, Globe, RefreshCw } from 'lucide-react';
import './App.css';

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
}

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


// Component to render platform favicon from local assets with fallback
function PlatformIcon({ platformId, platformName, size = 16 }: { platformId: string; platformName: string; size?: number }) {
  const [error, setError] = useState(false);
  const iconUrl = getIconUrl(platformId, platformName);

  // If no matching SVG was found, or if loading failed, show globe fallback
  if (!iconUrl || error) {
    return <Globe size={size} />;
  }

  return (
    <img
      src={iconUrl}
      alt="icon"
      width={size}
      height={size}
      className="platform-icon"
      onError={() => setError(true)}
    />
  );
}

function App() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Add form state
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  // Load platforms from file on startup
  useEffect(() => {
    loadPlatformsAsync().then(loaded => {
      setPlatforms(loaded);
      if (loaded.length > 0) setActiveTab(loaded[0].id);
      setInitialized(true);
    });
  }, []);

  // Make sure we have an active tab if platforms exist but activeTab is empty
  useEffect(() => {
    if (platforms.length > 0 && !activeTab) {
      setActiveTab(platforms[0].id);
    }
  }, [platforms, activeTab]);

  // Save platforms whenever they change (skip initial empty state)
  useEffect(() => {
    if (initialized) {
      savePlatformsToFile(platforms);
    }
  }, [platforms, initialized]);

  // Create or show webview when active tab changes (only if settings is closed)
  useEffect(() => {
    if (showSettings || !activeTab) return;
    const platform = platforms.find(p => p.id === activeTab);
    if (platform) {
      invoke('create_or_show_webview', {
        platformId: platform.id,
        url: platform.url,
        topOffset: 78.0
      }).catch(console.error);
    }
  }, [activeTab, platforms, showSettings]);

  const toggleSettings = () => {
    if (!showSettings) {
      // Opening settings: hide all child webviews so the panel is visible
      invoke('hide_all_webviews').catch(console.error);
      setShowSettings(true);
    } else {
      // Closing settings: re-show the active webview
      setShowSettings(false);
      setShowAddForm(false);
      resetAddForm();
      const platform = platforms.find(p => p.id === activeTab);
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
    let finalUrl = newUrl.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    const newPlatform: Platform = { id, name: newName.trim(), url: finalUrl };
    setPlatforms(prev => [...prev, newPlatform]);
    setShowAddForm(false);
    resetAddForm();
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

  const handleReloadPlatform = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    invoke('reload_webview', { platformId: id }).catch(console.error);
  };

  return (
    <div className="app-container">
      <div className="titlebar">
        <div className="tabs-container">
          {platforms.map((platform) => (
            <div
              key={platform.id}
              className={`tab-button ${activeTab === platform.id ? 'active' : ''}`}
              onClick={() => setActiveTab(platform.id)}
            >
              <PlatformIcon platformId={platform.id} platformName={platform.name} size={16} />
              <span>{platform.name}</span>
              {activeTab === platform.id && (
                <button
                  className="tab-refresh-btn"
                  onClick={(e) => handleReloadPlatform(e, platform.id)}
                  title="刷新"
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          ))}
          {platforms.length === 0 && (
            <div className="empty-tabs-msg">点击设置添加平台</div>
          )}
        </div>

        <div className="titlebar-actions">
          <button className="icon-button" onClick={toggleSettings}>
            <Settings size={18} />
          </button>
        </div>
      </div>

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
              <div key={p.id} className="panel-item">
                <div className="panel-item-info">
                  <PlatformIcon platformId={p.id} platformName={p.name} size={16} />
                  <span className="panel-item-name">{p.name}</span>
                </div>
                <div className="panel-item-actions">
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
        </div>

        <div className="panel-divider" />

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
                <option value="custom">自定义...</option>
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
      </div>
    </div>
  );
}

export default App;
