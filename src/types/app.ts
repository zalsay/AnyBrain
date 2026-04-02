export interface Platform {
  id: string;
  name: string;
  url: string;
  hidden?: boolean;
}

export type ExecMode = 'shell_with_output' | 'shell_status_only' | 'external_terminal';
export type CommandExecMode = ExecMode | 'inherit';

export interface ShortcutCommand {
  id: string;
  name: string;
  cmd: string;
  execMode?: CommandExecMode;
}

export interface ShortcutCommandSettings {
  defaultExecMode: ExecMode;
}

export interface AiModelConfig {
  id: string;
  modelId: string;
  contextLength: string;
}

export interface AiProviderSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  compressionModelId: string;
  models: AiModelConfig[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'error';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  summary?: string;
  summarizedMessageCount?: number;
  summaryUpdatedAt?: number;
  summarySignature?: string;
  summaryMode?: 'local' | 'hybrid';
  summaryModelId?: string;
}

export interface BrowserNavigationState {
  platformId: string;
  currentUrl: string;
  homeUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type ThinkingDepth = 'low' | 'medium' | 'high';

export interface PersistedChatHistory {
  sessions: ChatSession[];
  activeSessionId: string;
}
