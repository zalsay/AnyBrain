import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';

interface PlatformItem {
  id: string;
  name: string;
  url: string;
  hidden?: boolean;
}

interface TabsSettingsTabProps {
  platforms: PlatformItem[];
  activeTab: string;
  onRestorePlatform: (platformId: string) => void;
  onMovePlatform: (index: number, direction: 'up' | 'down') => void;
  onRemovePlatform: (platformId: string) => void;
  onUpdatePlatform: (platformId: string, partial: Partial<PlatformItem>) => void;
  renderPlatformIcon: (platform: PlatformItem) => React.ReactNode;
  showAddForm: boolean;
  onShowAddForm: () => void;
  selectedPreset: string;
  popularPlatforms: Array<{ id: string; name: string; url: string }>;
  onPresetSelect: (value: string) => void;
  newName: string;
  onNewNameChange: (value: string) => void;
  newUrl: string;
  onNewUrlChange: (value: string) => void;
  onNewUrlFocus: () => void;
  onNewUrlBlur: () => void;
  onAddPlatform: () => void;
  onCancelAddPlatform: () => void;
}

function TabsSettingsTab(props: TabsSettingsTabProps) {
  const [editingPlatformId, setEditingPlatformId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingUrl, setEditingUrl] = useState('');
  const visiblePlatforms = props.platforms.filter(platform => !platform.hidden);
  const hiddenPlatforms = props.platforms.filter(platform => platform.hidden);

  useEffect(() => {
    if (editingPlatformId && !props.platforms.some(platform => platform.id === editingPlatformId && !platform.hidden)) {
      setEditingPlatformId('');
      setEditingName('');
      setEditingUrl('');
    }
  }, [props.platforms, editingPlatformId]);

  const resetEditingState = () => {
    setEditingPlatformId('');
    setEditingName('');
    setEditingUrl('');
  };

  const handleStartEditing = (platform: PlatformItem) => {
    setEditingPlatformId(platform.id);
    setEditingName(platform.name);
    setEditingUrl(platform.url);
  };

  const handleSaveEditing = () => {
    if (!editingPlatformId || !editingName.trim() || !editingUrl.trim()) return;
    props.onUpdatePlatform(editingPlatformId, {
      name: editingName.trim(),
      url: editingUrl.trim(),
    });
    resetEditingState();
  };

  const renderPlatformList = (platforms: PlatformItem[], hidden: boolean) => {
    if (platforms.length === 0) {
      return <div className="empty-panel-msg">{hidden ? '暂无已收起标签页' : '暂无标签页'}</div>;
    }

    return platforms.map(platform => {
      const index = props.platforms.findIndex(item => item.id === platform.id);
      const isActive = !hidden && props.activeTab === platform.id;
      const isEditing = !hidden && editingPlatformId === platform.id;

      return (
        <div
          key={platform.id}
          className={`panel-item panel-item-platform ${hidden ? 'is-hidden' : ''} ${isActive ? 'is-active' : ''} ${isEditing ? 'is-editing' : ''}`}
          onClick={() => {
            if (hidden) {
              props.onRestorePlatform(platform.id);
            }
          }}
          style={{ cursor: hidden ? 'pointer' : isEditing ? 'text' : 'default' }}
          title={hidden ? '点击重新显示并打开' : ''}
        >
          {isEditing ? (
            <div className="panel-item-platform-editor" onClick={event => event.stopPropagation()}>
              <div className="panel-item-info panel-item-info-platform">
                <div className="panel-item-icon-shell">
                  {props.renderPlatformIcon(platform)}
                </div>
                <div className="panel-item-edit-fields">
                  <input
                    className="panel-item-edit-input"
                    value={editingName}
                    onChange={event => setEditingName(event.target.value)}
                    placeholder="标签名称"
                    autoFocus
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleSaveEditing();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        resetEditingState();
                      }
                    }}
                  />
                  <input
                    className="panel-item-edit-input is-url"
                    value={editingUrl}
                    onChange={event => setEditingUrl(event.target.value)}
                    placeholder="https://example.com"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleSaveEditing();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        resetEditingState();
                      }
                    }}
                  />
                </div>
              </div>
              <div className="panel-item-actions panel-item-edit-actions">
                <button
                  className="panel-item-action-btn panel-item-action-btn-confirm"
                  onClick={handleSaveEditing}
                  title="保存"
                  disabled={!editingName.trim() || !editingUrl.trim()}
                >
                  <Check size={16} />
                </button>
                <button
                  className="panel-item-action-btn"
                  onClick={resetEditingState}
                  title="取消"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="panel-item-platform-main">
              <div className="panel-item-info panel-item-info-platform">
                <div className="panel-item-icon-shell">
                  {props.renderPlatformIcon(platform)}
                </div>
                <div className="panel-item-texts">
                  <div className="panel-item-title-row">
                    <span className="panel-item-name">{platform.name}</span>
                    {isActive && <span className="panel-status-badge">当前显示</span>}
                    {hidden && <span className="panel-hidden-badge">已收起</span>}
                  </div>
                  <div className="panel-item-subline">
                    <span className="panel-item-url">{platform.url}</span>
                    {hidden && <span className="panel-item-restore-tip">点击恢复并打开</span>}
                  </div>
                </div>
              </div>

              <div className="panel-item-actions panel-item-actions-soft" onClick={event => event.stopPropagation()}>
                {!hidden && (
                  <>
                    <button
                      className="panel-item-action-btn"
                      onClick={() => handleStartEditing(platform)}
                      title="编辑"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="panel-item-action-btn"
                      onClick={() => props.onMovePlatform(index, 'up')}
                      disabled={index === 0}
                      title="上移"
                    >
                      <ChevronUp size={18} />
                    </button>
                    <button
                      className="panel-item-action-btn"
                      onClick={() => props.onMovePlatform(index, 'down')}
                      disabled={index === props.platforms.length - 1}
                      title="下移"
                    >
                      <ChevronDown size={18} />
                    </button>
                  </>
                )}
                <button
                  className="panel-item-delete"
                  onClick={() => props.onRemovePlatform(platform.id)}
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="panel-list">
      <div className="panel-section-block panel-section-block-platforms">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">常用标签页</div>
            <div className="panel-section-caption">当前可见的标签页会显示在顶部 tab 栏中。</div>
          </div>
          <span className="panel-section-count">{visiblePlatforms.length}</span>
        </div>
        <div className="panel-section-stack">
          {renderPlatformList(visiblePlatforms, false)}
        </div>
      </div>

      <div className="panel-section-block panel-section-block-platforms is-muted">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">已收起</div>
            <div className="panel-section-caption">收起的标签页不会显示在顶部，点击卡片可恢复。</div>
          </div>
          <span className="panel-section-count">{hiddenPlatforms.length}</span>
        </div>
        <div className="panel-section-stack">
          {renderPlatformList(hiddenPlatforms, true)}
        </div>
      </div>

      {!props.showAddForm ? (
        <button className="panel-add-btn panel-add-btn-platform" onClick={props.onShowAddForm}>
          <Plus size={16} />
          <span>添加新标签</span>
        </button>
      ) : (
        <div className="add-form add-form-platform">
          <div className="select-container">
            <select
              className="add-select"
              value={props.selectedPreset}
              onChange={event => props.onPresetSelect(event.target.value)}
            >
              <option value="" disabled>选择 AI 平台</option>
              {props.popularPlatforms.map((platform, index) => (
                <option key={`${platform.id}-${index}`} value={index}>{platform.name}</option>
              ))}
              <option value="custom">自定义标签页</option>
            </select>
            <ChevronDown className="select-icon" size={16} />
          </div>

          {props.selectedPreset === 'custom' && (
            <>
              <input
                className="add-input"
                placeholder="名称（如 DeepSeek）"
                value={props.newName}
                onChange={event => props.onNewNameChange(event.target.value)}
                autoFocus
              />
              <input
                className="add-input"
                placeholder="网址（如 https://chat.deepseek.com）"
                value={props.newUrl}
                onChange={event => props.onNewUrlChange(event.target.value)}
                onFocus={props.onNewUrlFocus}
                onBlur={props.onNewUrlBlur}
                onKeyDown={event => event.key === 'Enter' && props.onAddPlatform()}
              />
            </>
          )}

          <div className="add-form-actions">
            <button className="add-form-cancel" onClick={props.onCancelAddPlatform}>取消</button>
            <button
              className="add-form-confirm"
              onClick={props.onAddPlatform}
              disabled={!props.newName.trim() || !props.newUrl.trim()}
            >
              添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TabsSettingsTab;
