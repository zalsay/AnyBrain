import { ChevronDown, Plus, Trash2 } from 'lucide-react';

interface ShortcutCommandItem {
  id: string;
  name: string;
  cmd: string;
  execMode?: 'shell_with_output' | 'shell_status_only' | 'external_terminal' | 'inherit';
}

interface CommandsSettingsTabProps {
  commandSettings: {
    defaultExecMode: 'shell_with_output' | 'shell_status_only' | 'external_terminal';
  };
  execModeOptions: Array<{ value: 'shell_with_output' | 'shell_status_only' | 'external_terminal'; label: string }>;
  onUpdateCommandSettings: (partial: Partial<{ defaultExecMode: 'shell_with_output' | 'shell_status_only' | 'external_terminal' }>) => void;
  shortcutCommands: ShortcutCommandItem[];
  commandOutputs: Record<string, { output: string; error: string; exitCode: number | null }>;
  expandedCommandOutputs: Record<string, boolean>;
  commandStatuses: Record<string, 'running' | 'success' | 'error'>;
  commandStatusLabels: Record<'running' | 'success' | 'error', string>;
  onToggleCommandOutput: (commandId: string) => void;
  onCommandExecModeChange: (commandId: string, execMode: ShortcutCommandItem['execMode']) => void;
  onExecuteCommand: (command: ShortcutCommandItem) => void;
  onRemoveShortcutCommand: (commandId: string) => void;
  resolveCommandExecMode: (command: ShortcutCommandItem) => 'shell_with_output' | 'shell_status_only' | 'external_terminal';
  showCommandAddForm: boolean;
  onShowCommandAddForm: () => void;
  onCancelCommandAddForm: () => void;
  commandDraftName: string;
  onCommandDraftNameChange: (value: string) => void;
  commandDraftValue: string;
  onCommandDraftValueChange: (value: string) => void;
  onAddShortcutCommand: () => void;
}

function CommandsSettingsTab(props: CommandsSettingsTabProps) {
  return (
    <div className="panel-list">
      <div className="panel-section-block panel-section-block-settings">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">快捷命令</div>
            <div className="panel-section-caption">统一管理默认执行方式、单条命令的覆盖配置和最近输出。</div>
          </div>
          <span className="panel-section-count">{props.shortcutCommands.length}</span>
        </div>

        <div className="panel-section-stack">
          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">默认执行方式</span>
              <span className="panel-setting-hint">新建命令默认继承这里的执行策略。</span>
            </div>
            <div className="panel-setting-control panel-command-default-control">
              <select
                className="panel-select"
                value={props.commandSettings.defaultExecMode}
                onChange={event => props.onUpdateCommandSettings({ defaultExecMode: event.target.value as 'shell_with_output' | 'shell_status_only' | 'external_terminal' })}
              >
                {props.execModeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown className="select-icon" size={14} />
            </div>
          </div>

          <div className="panel-subsection-header panel-subsection-header-row">
            <div>
              <div className="panel-ai-title">命令列表</div>
              <div className="panel-ai-desc">支持为单条命令单独指定执行方式，并查看最近一次输出。</div>
            </div>
            <span className="panel-inline-badge">共 {props.shortcutCommands.length} 条</span>
          </div>

          {props.shortcutCommands.length === 0 ? (
            <div className="empty-panel-msg">暂无快捷命令</div>
          ) : (
            props.shortcutCommands.map(command => {
              const execMode = props.resolveCommandExecMode(command);
              const output = props.commandOutputs[command.id];
              const expanded = props.expandedCommandOutputs[command.id];
              const status = props.commandStatuses[command.id];
              return (
                <div key={command.id} className="panel-command-item">
                  <div className="panel-command-row">
                    <div className="panel-command-info">
                      <span className="panel-command-name">{command.name}</span>
                      <span className="panel-command-text">{command.cmd}</span>
                    </div>
                    <div className="panel-command-actions">
                      <div className="panel-command-select panel-command-select-inline">
                        <select
                          className="panel-select"
                          value={command.execMode ?? 'inherit'}
                          onChange={event => props.onCommandExecModeChange(command.id, event.target.value as ShortcutCommandItem['execMode'])}
                        >
                          <option value="inherit">跟随默认</option>
                          {props.execModeOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="select-icon" size={14} />
                      </div>
                      <button
                        className={`panel-command-run ${status ? `is-${status}` : ''}`}
                        onClick={() => props.onExecuteCommand(command)}
                      >
                        {status ? props.commandStatusLabels[status] : '执行'}
                      </button>
                      <button
                        className="panel-item-delete"
                        onClick={() => props.onRemoveShortcutCommand(command.id)}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {execMode === 'shell_with_output' && output && (
                    <div className="panel-command-output">
                      <button
                        className="panel-command-output-toggle"
                        onClick={() => props.onToggleCommandOutput(command.id)}
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

          {!props.showCommandAddForm ? (
            <button className="panel-add-btn" onClick={props.onShowCommandAddForm}>
              <Plus size={16} />
              <span>添加快捷命令</span>
            </button>
          ) : (
            <div className="add-form">
              <input
                className="add-input"
                placeholder="名称（如 清理缓存）"
                value={props.commandDraftName}
                onChange={event => props.onCommandDraftNameChange(event.target.value)}
                autoFocus
              />
              <input
                className="add-input"
                placeholder="命令（如 npm run build）"
                value={props.commandDraftValue}
                onChange={event => props.onCommandDraftValueChange(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && props.onAddShortcutCommand()}
              />
              <div className="add-form-actions">
                <button className="add-form-cancel" onClick={props.onCancelCommandAddForm}>取消</button>
                <button
                  className="add-form-confirm"
                  onClick={props.onAddShortcutCommand}
                  disabled={!props.commandDraftName.trim() || !props.commandDraftValue.trim()}
                >
                  添加
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandsSettingsTab;
