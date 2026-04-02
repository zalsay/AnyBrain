import { Bot, ChevronDown, Globe, KeyRound, Plus, Trash2 } from 'lucide-react';

interface AiModelItem {
  id: string;
  modelId: string;
  contextLength: string;
}

interface AiSettingsTabProps {
  aiChatTabId: string;
  activeTab: string;
  aiProvider: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    compressionModelId: string;
    models: AiModelItem[];
  };
  onToggleAiEnabled: () => void;
  onUpdateAiProvider: (partial: Partial<{ enabled: boolean; baseUrl: string; apiKey: string; modelId: string; compressionModelId: string; models: AiModelItem[] }>) => void;
  showAiModelAddForm: boolean;
  onShowAiModelAddForm: () => void;
  onCancelAiModelAddForm: () => void;
  aiModelDraft: string;
  onAiModelDraftChange: (value: string) => void;
  aiContextDraft: string;
  onAiContextDraftChange: (value: string) => void;
  onAddAiModel: () => void;
  onUpdateAiModel: (modelId: string, partial: Partial<AiModelItem>) => void;
  onRemoveAiModel: (modelId: string) => void;
  aiModelContextDefault: string;
}

function AiSettingsTab(props: AiSettingsTabProps) {
  const models = Array.isArray(props.aiProvider.models) ? props.aiProvider.models : [];
  const modelCount = models.length;
  const activeModelLabel = props.aiProvider.modelId.trim() || '未选择';
  const compressionModelLabel = props.aiProvider.compressionModelId.trim() || '未配置';

  return (
    <div className="panel-list">
      <div className="panel-section-block panel-section-block-settings">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">主要设置</div>
            <div className="panel-section-caption">管理 AI 对话页开关和接口连接信息。</div>
          </div>
          <span className={`panel-inline-badge ${props.aiProvider.enabled ? 'is-active' : ''}`}>
            {props.aiProvider.enabled ? '已开启' : '未开启'}
          </span>
        </div>

        <div className="panel-section-stack">
          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">开启 AI 对话页</span>
              <span className="panel-setting-hint">打开后会在顶部新增一个独立的现代感 AI 对话流页面。</span>
            </div>
            <button
              className={`toggle-switch panel-ai-toggle-switch ${props.aiProvider.enabled ? 'active' : ''}`}
              onClick={props.onToggleAiEnabled}
              role="switch"
              aria-checked={props.aiProvider.enabled}
            >
              <span className="toggle-knob" />
            </button>
          </div>

          <div className="panel-item panel-ai-connection-card">
            <div className="panel-subsection-header panel-subsection-header-row">
              <div>
                <div className="panel-ai-title">接口连接</div>
                <div className="panel-ai-desc">填写兼容 OpenAI 风格的 Base URL 与 API Key。</div>
              </div>
            </div>

            <div className="panel-ai-grid">
              <label className="panel-ai-field">
                <span>Base URL</span>
                <div className="panel-ai-input-wrap">
                  <Globe className="panel-ai-input-prefix panel-ai-input-icon" size={14} />
                  <input
                    className="add-input panel-ai-input"
                    placeholder="如 https://api.openai.com/v1"
                    value={props.aiProvider.baseUrl}
                    onChange={event => props.onUpdateAiProvider({ baseUrl: event.target.value })}
                  />
                </div>
              </label>

              <label className="panel-ai-field">
                <span>API Key</span>
                <div className="panel-ai-input-wrap">
                  <KeyRound className="panel-ai-input-prefix panel-ai-input-icon" size={14} />
                  <input
                    className="add-input panel-ai-input"
                    type="password"
                    placeholder="输入你的 API Key"
                    value={props.aiProvider.apiKey}
                    onChange={event => props.onUpdateAiProvider({ apiKey: event.target.value })}
                  />
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-section-block panel-section-block-settings">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">模型管理</div>
            <div className="panel-section-caption">选择当前模型，并维护可用模型列表。</div>
          </div>
          <span className="panel-section-count">{modelCount}</span>
        </div>

        <div className="panel-section-stack">
          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">当前使用模型</span>
              <span className="panel-setting-hint">聊天页会使用这里选中的模型发送请求。</span>
            </div>
            <div className="panel-setting-control panel-ai-current-model-control">
              <span className="panel-inline-badge">{activeModelLabel}</span>
              <div className="select-container panel-ai-select-wrap">
                <select
                  className="panel-select panel-ai-select"
                  value={props.aiProvider.modelId}
                  onChange={event => props.onUpdateAiProvider({ modelId: event.target.value })}
                >
                  <option value="">请选择模型</option>
                  {models.map(model => (
                    <option key={model.id} value={model.modelId} disabled={!model.modelId.trim()}>
                      {model.modelId.trim() || '未填写 Model ID'} · {model.contextLength.trim() || props.aiModelContextDefault}
                    </option>
                  ))}
                </select>
                <ChevronDown className="select-icon" size={14} />
              </div>
            </div>
          </div>

          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">压缩摘要模型</span>
              <span className="panel-setting-hint">用于对较早消息做增强摘要；未配置时仅使用本地规则压缩。</span>
            </div>
            <div className="panel-setting-control panel-ai-current-model-control">
              <span className="panel-inline-badge">{compressionModelLabel}</span>
              <div className="select-container panel-ai-select-wrap">
                <select
                  className="panel-select panel-ai-select"
                  value={props.aiProvider.compressionModelId}
                  onChange={event => props.onUpdateAiProvider({ compressionModelId: event.target.value })}
                >
                  <option value="">仅本地压缩</option>
                  {models.map(model => (
                    <option key={model.id} value={model.modelId} disabled={!model.modelId.trim()}>
                      {model.modelId.trim() || '未填写 Model ID'} · {model.contextLength.trim() || props.aiModelContextDefault}
                    </option>
                  ))}
                </select>
                <ChevronDown className="select-icon" size={14} />
              </div>
            </div>
          </div>

          {modelCount === 0 ? (
            <div className="empty-panel-msg">暂无模型配置</div>
          ) : (
            models.map((model, index) => {
              const isActiveModel = model.modelId.trim() && model.modelId === props.aiProvider.modelId;
              return (
                <div key={model.id} className={`panel-item panel-ai-model-card ${isActiveModel ? 'is-active' : ''}`}>
                  <div className="panel-ai-model-head">
                    <div className="panel-ai-model-meta">
                      <span className="panel-ai-model-index">模型 {index + 1}</span>
                      {isActiveModel && <span className="panel-status-badge">当前</span>}
                    </div>
                    <button
                      className="panel-item-delete"
                      onClick={() => props.onRemoveAiModel(model.id)}
                      title="删除模型"
                      aria-label="删除模型"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="panel-ai-model-grid">
                    <label className="panel-ai-field">
                      <span>Model ID</span>
                      <div className="panel-ai-input-wrap">
                        <Bot className="panel-ai-input-prefix panel-ai-input-icon" size={14} />
                        <input
                          className="add-input panel-ai-input"
                          placeholder="如 gpt-4.1-mini / deepseek-chat"
                          value={model.modelId}
                          onChange={event => props.onUpdateAiModel(model.id, { modelId: event.target.value })}
                        />
                      </div>
                    </label>

                    <label className="panel-ai-field">
                      <span>上下文长度</span>
                      <input
                        className="add-input panel-ai-input panel-ai-context-input"
                        placeholder="默认 200k"
                        value={model.contextLength}
                        onChange={event => props.onUpdateAiModel(model.id, { contextLength: event.target.value })}
                        onBlur={event => {
                          if (!event.target.value.trim()) {
                            props.onUpdateAiModel(model.id, { contextLength: props.aiModelContextDefault });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })
          )}

          {!props.showAiModelAddForm ? (
            <button className="panel-add-btn panel-add-btn-ai" onClick={props.onShowAiModelAddForm}>
              <Plus size={16} />
              <span>添加模型</span>
            </button>
          ) : (
            <div className="add-form panel-ai-add-form">
              <input
                className="add-input panel-ai-input"
                placeholder="新增 Model ID"
                value={props.aiModelDraft}
                onChange={event => props.onAiModelDraftChange(event.target.value)}
                autoFocus
              />
              <input
                className="add-input panel-ai-input panel-ai-context-input"
                placeholder="上下文长度，默认 200k"
                value={props.aiContextDraft}
                onChange={event => props.onAiContextDraftChange(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && props.onAddAiModel()}
              />
              <div className="add-form-actions">
                <button className="add-form-cancel" onClick={props.onCancelAiModelAddForm}>取消</button>
                <button className="add-form-confirm" onClick={props.onAddAiModel} disabled={!props.aiModelDraft.trim()}>
                  添加模型
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel-section-block panel-section-block-settings">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">说明</div>
            <div className="panel-section-caption">补充当前 AI 对话流配置的默认行为。</div>
          </div>
        </div>

        <div className="panel-ai-tips">
          保存方式为自动持久化；推荐填写兼容 OpenAI Chat Completions 的接口地址。每个模型的上下文长度默认值为 200k。压缩摘要模型会在本地规则压缩基础上生成更高质量的历史摘要。
        </div>
      </div>
    </div>
  );
}

export default AiSettingsTab;
