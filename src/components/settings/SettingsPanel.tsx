import { useState } from 'react';
import { X } from 'lucide-react';
import TabsSettingsTab from './TabsSettingsTab';
import AiSettingsTab from './AiSettingsTab';
import CommandsSettingsTab from './CommandsSettingsTab';
import GeneralSettingsTab from './GeneralSettingsTab';

type SettingsTabKey = 'tabs' | 'ai' | 'commands' | 'general';

interface PlatformItem {
  id: string;
  name: string;
  url: string;
  hidden?: boolean;
}

interface ShortcutCommandItem {
  id: string;
  name: string;
  cmd: string;
  execMode?: 'shell_with_output' | 'shell_status_only' | 'external_terminal' | 'inherit';
}

interface AiModelItem {
  id: string;
  modelId: string;
  contextLength: string;
}

interface SettingsPanelProps {
  showSettings: boolean;
  onClose: () => void;
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
  aiChatTabId: string;
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
  speechRate: number;
  onSpeechRateChange: (value: number) => void;
  useSystemProxy: boolean;
  onToggleSystemProxy: () => void;
}

const SETTINGS_TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: 'tabs', label: '标签页' },
  { key: 'ai', label: 'AI' },
  { key: 'commands', label: '快捷命令' },
  { key: 'general', label: '通用' },
];

function SettingsPanel(props: SettingsPanelProps) {
  const [currentTab, setCurrentTab] = useState<SettingsTabKey>('tabs');

  return (
    <>
      <div className={`settings-backdrop ${props.showSettings ? 'open' : ''}`} onClick={props.onClose} />
      <div className={`settings-panel ${props.showSettings ? 'open' : ''}`}>
        <div className="panel-header">
          <h3>管理标签页与能力设置</h3>
          <button className="icon-button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="设置分组">
          {SETTINGS_TABS.map(tab => (
            <button
              key={tab.key}
              className={`settings-tab ${currentTab === tab.key ? 'is-active' : ''}`}
              onClick={() => setCurrentTab(tab.key)}
              role="tab"
              aria-selected={currentTab === tab.key}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-tab-panel">
          {currentTab === 'tabs' && (
            <TabsSettingsTab
              platforms={props.platforms}
              activeTab={props.activeTab}
              onRestorePlatform={props.onRestorePlatform}
              onMovePlatform={props.onMovePlatform}
              onRemovePlatform={props.onRemovePlatform}
              onUpdatePlatform={props.onUpdatePlatform}
              renderPlatformIcon={props.renderPlatformIcon}
              showAddForm={props.showAddForm}
              onShowAddForm={props.onShowAddForm}
              selectedPreset={props.selectedPreset}
              popularPlatforms={props.popularPlatforms}
              onPresetSelect={props.onPresetSelect}
              newName={props.newName}
              onNewNameChange={props.onNewNameChange}
              newUrl={props.newUrl}
              onNewUrlChange={props.onNewUrlChange}
              onNewUrlFocus={props.onNewUrlFocus}
              onNewUrlBlur={props.onNewUrlBlur}
              onAddPlatform={props.onAddPlatform}
              onCancelAddPlatform={props.onCancelAddPlatform}
            />
          )}

          {currentTab === 'ai' && (
            <AiSettingsTab
              aiChatTabId={props.aiChatTabId}
              activeTab={props.activeTab}
              aiProvider={props.aiProvider}
              onToggleAiEnabled={props.onToggleAiEnabled}
              onUpdateAiProvider={props.onUpdateAiProvider}
              showAiModelAddForm={props.showAiModelAddForm}
              onShowAiModelAddForm={props.onShowAiModelAddForm}
              onCancelAiModelAddForm={props.onCancelAiModelAddForm}
              aiModelDraft={props.aiModelDraft}
              onAiModelDraftChange={props.onAiModelDraftChange}
              aiContextDraft={props.aiContextDraft}
              onAiContextDraftChange={props.onAiContextDraftChange}
              onAddAiModel={props.onAddAiModel}
              onUpdateAiModel={props.onUpdateAiModel}
              onRemoveAiModel={props.onRemoveAiModel}
              aiModelContextDefault={props.aiModelContextDefault}
            />
          )}

          {currentTab === 'commands' && (
            <CommandsSettingsTab
              commandSettings={props.commandSettings}
              execModeOptions={props.execModeOptions}
              onUpdateCommandSettings={props.onUpdateCommandSettings}
              shortcutCommands={props.shortcutCommands}
              commandOutputs={props.commandOutputs}
              expandedCommandOutputs={props.expandedCommandOutputs}
              commandStatuses={props.commandStatuses}
              commandStatusLabels={props.commandStatusLabels}
              onToggleCommandOutput={props.onToggleCommandOutput}
              onCommandExecModeChange={props.onCommandExecModeChange}
              onExecuteCommand={props.onExecuteCommand}
              onRemoveShortcutCommand={props.onRemoveShortcutCommand}
              resolveCommandExecMode={props.resolveCommandExecMode}
              showCommandAddForm={props.showCommandAddForm}
              onShowCommandAddForm={props.onShowCommandAddForm}
              onCancelCommandAddForm={props.onCancelCommandAddForm}
              commandDraftName={props.commandDraftName}
              onCommandDraftNameChange={props.onCommandDraftNameChange}
              commandDraftValue={props.commandDraftValue}
              onCommandDraftValueChange={props.onCommandDraftValueChange}
              onAddShortcutCommand={props.onAddShortcutCommand}
            />
          )}

          {currentTab === 'general' && (
            <GeneralSettingsTab
              speechRate={props.speechRate}
              onSpeechRateChange={props.onSpeechRateChange}
              useSystemProxy={props.useSystemProxy}
              onToggleSystemProxy={props.onToggleSystemProxy}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default SettingsPanel;
