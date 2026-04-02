import type { AiProviderSettings, ChatMessage, ExecMode, ShortcutCommandSettings, ThinkingDepth } from '../types/app';
import { normalizeAiProviderSettings } from '../features/ai-chat/provider';

export const AI_CHAT_TAB_ID = '__ai_chat_flow__';
export const AI_CHAT_TAB = {
  id: AI_CHAT_TAB_ID,
  name: 'AI 对话',
  url: ''
};

export const EXEC_MODE_OPTIONS: Array<{ value: ExecMode; label: string }> = [
  { value: 'shell_with_output', label: '本地 shell（显示输出）' },
  { value: 'shell_status_only', label: '本地 shell（仅状态）' },
  { value: 'external_terminal', label: '外部终端执行' }
];

export const COMMAND_STATUS_LABELS: Record<'running' | 'success' | 'error', string> = {
  running: '运行中',
  success: '成功',
  error: '失败'
};

export const POPULAR_PLATFORMS = [
  { id: 'openai', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'qwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'zhipu', name: '智谱清言', url: 'https://chatglm.cn/' },
  { id: 'minimax', name: 'MiniMax', url: 'https://api.minimax.chat/' },
];

export const SETTINGS_DEFAULTS = { useSystemProxy: true, speechRate: 0.9 };
export const COMMAND_SETTINGS_DEFAULTS: ShortcutCommandSettings = { defaultExecMode: 'shell_with_output' };
export const AI_PROVIDER_DEFAULTS: AiProviderSettings = normalizeAiProviderSettings({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  modelId: '',
  compressionModelId: '',
  models: [],
});

export const CHAT_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我已经准备好了。开启 AI 对话流后，你可以在这里直接进行多轮对话。',
};

export const THINKING_DEPTH_OPTIONS: Array<{ value: ThinkingDepth; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
