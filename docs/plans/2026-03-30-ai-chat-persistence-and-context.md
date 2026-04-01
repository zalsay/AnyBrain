# AI 对话会话持久化与上下文自动注入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use proma-workspace-an-y-brain:executing-plans to implement this plan task-by-task.

**Goal:** 为 AnyBrain 的 AI 对话页增加本地会话记录持久化，并在每次发送消息时自动注入历史记录、系统提示和项目上下文。

**Architecture:** 继续沿用现有 `settings.json` 的 Tauri 本地存储模式，把 AI 对话相关配置与会话数据一起放进独立的 JSON 文件中，由 Rust 端提供 `load/save` 命令，React 端负责 hydration、状态更新和发送前的上下文拼装。上下文注入不改 UI 协议，先在前端构造最终请求消息数组，再兼容现有 `chat/completions` 与 `responses` 两种 API 负载格式。

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Rust, serde/serde_json

---

### Task 1: 定义持久化数据结构与存储命令

**Files:**
- Modify: `src-tauri/src/lib.rs:67-89`
- Modify: `src-tauri/src/lib.rs:193-214`

**Step 1: 写出 Rust 侧 AI 聊天存储结构**

在 `src-tauri/src/lib.rs` 里新增与 AI 会话持久化对应的辅助函数：

```rust
fn ai_chat_file_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().unwrap();
    dir.join("ai_chat_state.json")
}

#[tauri::command]
fn load_ai_chat_state(app: tauri::AppHandle) -> Result<String, String> {
    let path = ai_chat_file_path(&app);
    match fs::read_to_string(&path) {
        Ok(data) => Ok(data),
        Err(_) => Ok("{}".to_string()),
    }
}

#[tauri::command]
fn save_ai_chat_state(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = ai_chat_file_path(&app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}
```

**Step 2: 注册新 Tauri 命令**

把新命令加入 `tauri::generate_handler!`：

```rust
load_ai_chat_state,
save_ai_chat_state,
```

**Step 3: 运行 Rust 编译检查**

Run: `cd /Volumes/RC500/dev/AnyBrain && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS，新增命令编译通过

**Step 4: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src-tauri/src/lib.rs
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: add ai chat state storage commands"
```

---

### Task 2: 定义前端 AI 会话与上下文配置模型

**Files:**
- Modify: `src/App.tsx:55-83`
- Modify: `src/App.tsx:107-151`
- Modify: `src/App.tsx:565-582`

**Step 1: 为 AI 会话持久化定义前端类型**

在 `src/App.tsx` 中新增持久化结构，避免把 AI 会话硬塞进现有通用 settings：

```ts
interface AiChatContextSettings {
  systemPrompt: string;
  includeProjectContext: boolean;
  includeRuntimeContext: boolean;
}

interface AiChatState {
  sessions: ChatSession[];
  activeSessionId: string;
  contextSettings: AiChatContextSettings;
}
```

补默认值：

```ts
const AI_CHAT_CONTEXT_DEFAULTS: AiChatContextSettings = {
  systemPrompt: '你是 AnyBrain 内置 AI 助手。回答时优先结合当前项目环境与用户当前使用上下文。',
  includeProjectContext: true,
  includeRuntimeContext: true,
};
```

**Step 2: 新增 normalize 函数**

新增 `normalizeAiChatState`，确保以下场景安全：
- 文件不存在 / 空对象
- 会话数组为空时自动生成新会话
- active session 丢失时回退到第一条
- context settings 缺字段时补默认值

示例骨架：

```ts
function normalizeAiChatState(value?: Partial<AiChatState>): AiChatState {
  const sessions = Array.isArray(value?.sessions) && value?.sessions.length > 0
    ? value.sessions.map(session => ({
        ...session,
        messages: Array.isArray(session.messages) && session.messages.length > 0
          ? session.messages
          : [CHAT_WELCOME_MESSAGE],
      }))
    : [createChatSession()];

  const activeSessionId = sessions.some(session => session.id === value?.activeSessionId)
    ? value!.activeSessionId!
    : sessions[0].id;

  return {
    sessions,
    activeSessionId,
    contextSettings: {
      ...AI_CHAT_CONTEXT_DEFAULTS,
      ...(value?.contextSettings || {}),
    },
  };
}
```

**Step 3: 为持久化准备单独保存函数**

在 `saveSettings` / `persistSettings` 附近增加：

```ts
const saveAiChatState = (next: AiChatState) => {
  invoke('save_ai_chat_state', { data: JSON.stringify(next) }).catch(console.error);
};
```

**Step 4: 运行前端类型检查**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build`
Expected: PASS，TypeScript 类型通过

**Step 5: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: add ai chat persistence models"
```

---

### Task 3: 启动时加载本地 AI 会话状态

**Files:**
- Modify: `src/App.tsx:381-479`
- Modify: `src/App.tsx:538-549`

**Step 1: 拆分“默认新建会话”逻辑**

把当前 `useEffect` 里“chatSessions 为空就创建新会话”的逻辑改成区分两阶段：
- hydration 前不自动创建
- hydration 完成且仍为空时才补一个默认会话

建议增加：

```ts
const [aiChatLoaded, setAiChatLoaded] = useState(false);
const [aiChatContextSettings, setAiChatContextSettings] = useState<AiChatContextSettings>(AI_CHAT_CONTEXT_DEFAULTS);
```

**Step 2: 启动时读取本地 AI 会话文件**

在初始 `useEffect` 中追加：

```ts
invoke('load_ai_chat_state').then((data: unknown) => {
  try {
    const parsed = JSON.parse(data as string);
    const normalized = normalizeAiChatState(parsed);
    setChatSessions(normalized.sessions);
    setActiveChatSessionId(normalized.activeSessionId);
    setAiChatContextSettings(normalized.contextSettings);
  } finally {
    setAiChatLoaded(true);
  }
}).catch(() => {
  setAiChatLoaded(true);
});
```

**Step 3: 调整默认会话回退逻辑**

把现有 `chatSessions.length === 0` 的 effect 改成：

```ts
if (!aiChatLoaded) return;
if (chatSessions.length === 0) {
  const nextSession = createChatSession();
  setChatSessions([nextSession]);
  setActiveChatSessionId(nextSession.id);
  return;
}
```

**Step 4: 运行构建验证加载逻辑**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build`
Expected: PASS，加载状态相关代码编译通过

**Step 5: 手动验证首次启动**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run tauri dev`
Expected: AI 对话页首次打开时只有一个默认会话，无报错

**Step 6: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: load ai chat sessions from local storage"
```

---

### Task 4: 在状态变化时持久化 AI 会话与上下文配置

**Files:**
- Modify: `src/App.tsx:433-447`
- Modify: `src/App.tsx:551-583`

**Step 1: 增加统一快照构造函数**

在组件中新增：

```ts
const buildAiChatStateSnapshot = (
  sessions: ChatSession[],
  activeSessionId: string,
  contextSettings: AiChatContextSettings,
): AiChatState => ({
  sessions,
  activeSessionId,
  contextSettings,
});
```

**Step 2: 监听并持久化 AI 聊天状态**

新增 effect：

```ts
useEffect(() => {
  if (!aiChatLoaded) return;
  saveAiChatState(buildAiChatStateSnapshot(chatSessions, activeChatSessionId, aiChatContextSettings));
}, [chatSessions, activeChatSessionId, aiChatContextSettings, aiChatLoaded]);
```

**Step 3: 确保持久化状态不写入临时异常数据**

发送中占位消息允许持久化，但要避免未初始化时把空数组覆盖本地文件，因此依赖 `aiChatLoaded` 作为门闩。

**Step 4: 运行构建检查**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build`
Expected: PASS

**Step 5: 手动验证持久化**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run tauri dev`
Expected: 新建两个会话、切换当前会话、关闭应用再打开后，会话列表与当前会话都恢复

**Step 6: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: persist ai chat sessions locally"
```

---

### Task 5: 构造系统提示、项目上下文与运行时上下文

**Files:**
- Modify: `src/App.tsx:178-244`
- Modify: `src/App.tsx:973-1054`

**Step 1: 新增上下文拼装 helper**

在 `buildChatCompletionsPayload` / `buildResponsesPayload` 上方新增以下辅助函数：

```ts
function buildProjectContextBlock(params: {
  activeTab: string;
  platforms: Platform[];
  tempTabs: Platform[];
  commandSettings: ShortcutCommandSettings;
  shortcutCommands: ShortcutCommand[];
  aiProvider: AiProviderSettings;
}) {
  const activePlatform = [...params.platforms, ...params.tempTabs].find(item => item.id === params.activeTab);
  return [
    `当前活动标签: ${params.activeTab === AI_CHAT_TAB_ID ? 'AI 对话' : activePlatform?.name || '未知'}`,
    `当前活动网址: ${activePlatform?.url || '无'}`,
    `常驻平台数量: ${params.platforms.filter(item => !item.hidden).length}`,
    `临时标签数量: ${params.tempTabs.length}`,
    `快捷命令数量: ${params.shortcutCommands.length}`,
    `当前模型: ${params.aiProvider.modelId || '未配置'}`,
  ].join('\n');
}

function buildRuntimeContextBlock() {
  return [
    `当前时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `运行环境: Tauri Desktop App`,
    `界面语言: 中文`,
  ].join('\n');
}
```

**Step 2: 定义最终发送消息构造函数**

新增：

```ts
function buildInjectedMessages(params: {
  baseMessages: ChatMessage[];
  systemPrompt: string;
  projectContext: string;
  runtimeContext: string;
}) {
  const injectedSystemMessage = {
    id: 'system-injected',
    role: 'assistant' as const,
    content: [
      params.systemPrompt,
      '【项目上下文】',
      params.projectContext,
      '【运行时上下文】',
      params.runtimeContext,
    ].join('\n\n'),
  };

  return [injectedSystemMessage, ...params.baseMessages.filter(message => message.status !== 'error')];
}
```

实现时要把真正发给模型的消息与 UI 展示消息分离：
- UI 继续显示原始消息
- 请求体使用 `injectedMessages`

注意：当前接口类型只接受 `user | assistant`，因此系统提示先以首条 assistant message 注入，避免破坏现有后端兼容性。

**Step 3: 在发送前接入全量上下文**

在 `handleSendChat` 内，基于当前会话历史构造：

```ts
const requestBaseMessages = [...nextMessages];
const projectContext = aiChatContextSettings.includeProjectContext
  ? buildProjectContextBlock({ activeTab, platforms, tempTabs, commandSettings, shortcutCommands, aiProvider })
  : '';
const runtimeContext = aiChatContextSettings.includeRuntimeContext
  ? buildRuntimeContextBlock()
  : '';
const requestMessages = buildInjectedMessages({
  baseMessages: requestBaseMessages,
  systemPrompt: aiChatContextSettings.systemPrompt,
  projectContext,
  runtimeContext,
});
```

然后把原来发请求时使用的 `nextMessages` 改成 `requestMessages`：

```ts
body: buildResponsesPayload(requestMessages, aiProvider.modelId.trim())
body: buildChatCompletionsPayload(requestMessages, aiProvider.modelId.trim())
```

**Step 4: 运行构建检查**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build`
Expected: PASS

**Step 5: 手动验证上下文注入**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run tauri dev`
Expected: 在 DevTools Network 中可看到首条注入消息包含系统提示、项目上下文、运行时上下文和会话历史

**Step 6: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: inject full context into ai chat requests"
```

---

### Task 6: 为上下文注入提供最小可配置入口

**Files:**
- Modify: `src/App.tsx:1689-1799`

**Step 1: 在 AI 设置面板增加上下文设置区**

在“AI 对话流”配置区域加入：
- `systemPrompt` 多行输入框
- `includeProjectContext` 开关
- `includeRuntimeContext` 开关

推荐最小 UI：

```tsx
<textarea
  className="panel-ai-input ai-chat-textarea"
  value={aiChatContextSettings.systemPrompt}
  onChange={e => setAiChatContextSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
/>
```

以及两个 toggle button，沿用现有 `toggle-switch` 样式。

**Step 2: 确保这些设置跟随 AI 聊天状态一起持久化**

不需要单独存 settings，只要依赖 Task 4 的持久化 effect 即可。

**Step 3: 运行构建检查**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build`
Expected: PASS

**Step 4: 手动验证设置生效**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run tauri dev`
Expected: 修改系统提示后重启应用仍保留；关闭项目/运行时上下文后，请求体中对应区块消失

**Step 5: 提交这一小步**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: add ai chat context settings"
```

---

### Task 7: 回归验证与清理

**Files:**
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 全量构建验证**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run build && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 2: 手动回归场景**

Run: `cd /Volumes/RC500/dev/AnyBrain && npm run tauri dev`
Expected:
- 新开会话后立即落盘
- 当前会话切换后重启可恢复
- 清空当前会话后仅该会话重置
- 历史消息会继续参与上下文注入
- AI 设置修改后下次发送立即生效
- 关闭 AI 对话页再重新开启后，会话仍存在

**Step 3: 检查无意外回归**

重点手测：
- 普通平台标签打开/切换/关闭不受影响
- 快捷命令执行不受影响
- 设置面板打开关闭行为不受影响

**Step 4: 最终提交**

```bash
git -C /Volumes/RC500/dev/AnyBrain add src/App.tsx src-tauri/src/lib.rs
git -C /Volumes/RC500/dev/AnyBrain commit -m "feat: persist ai chat sessions and inject full context"
```
