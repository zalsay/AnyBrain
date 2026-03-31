# 2026-04-01 Browser Toolbar Design

## Context
当前界面只有单层 tab 栏，激活 tab 后直接进入对应 webview 内容区。要在 tab 栏下方增加一层固定工具栏，形态接近 Chrome：包含后退、前进、主页、刷新和地址栏。目标不是只加一层视觉壳，而是让当前激活 tab 具备完整导航能力；同时按照已确认的规则，地址栏输入后的跳转**不回写**为该 tab 的主页地址，主页仍然回到 tab 创建时的 `platform.url`。

## Existing constraints
- tab 顶栏主体在 `src/App.tsx:1258` 和 `src/App.css:73`
- 当前 webview 创建/显示由 `src/App.tsx:532` 触发 `create_or_show_webview`
- 刷新与主页已有局部能力：`handleReloadPlatform`（`src/App.tsx:936`）、`handleMenuHome`（`src/App.tsx:1005`）
- Tauri 子 webview 高度目前只预留 tab 栏空间，Rust 端常量 `TAB_BAR_LOGICAL_HEIGHT` 在 `src-tauri/src/ai_window_manager.rs:16`，并被 `src-tauri/src/lib.rs:255` 用于 child webview 布局

## Recommended approach
采用“**双层顶部壳 + 每个 tab 独立导航状态**”方案。

### 1. Layout changes
把现有单层 `.titlebar` 拆成：
- 第一层：`tab-strip`
- 第二层：固定 `browser-toolbar`

推荐把现有 `titlebar` 改为纵向容器，第二层始终占位；这样普通网页 tab 与 AI chat tab 共用统一顶部结构，但 AI chat tab 可显示只读或降级版 toolbar。

Rust 侧同步把顶部预留高度从当前 70 调整为“tab 栏高度 + toolbar 高度”，并继续由单一常量统一管理，避免 TS/CSS/Rust 三处漂移。

### 2. Frontend state model
在 `App.tsx` 为每个非 AI tab 维护独立导航状态：
- `currentUrlByTab: Record<string, string>`：当前显示地址
- `addressInputByTab: Record<string, string>`：地址栏编辑态内容
- `canGoBackByTab: Record<string, boolean>`
- `canGoForwardByTab: Record<string, boolean>`
- `isNavigatingByTab: Record<string, boolean>`

`platform.url` / `tempTab.url` 继续代表“主页地址”，只在创建 tab 或显式保存收藏时使用，不被地址栏跳转覆盖。

### 3. Native bridge additions
现有 Rust 命令只有 reload / set url，不足以支持完整浏览器栏。建议新增：
- `webview_go_back(platform_id)`
- `webview_go_forward(platform_id)`
- `webview_navigate(platform_id, url)`（语义上替代仅限 reload 的 `reload_webview_url`）
- `query_webview_state(platform_id)` 或事件推送 `webview_navigation_state`

更推荐“**事件推送 + 前端订阅**”：在 `on_page_load`、导航完成、后退前进状态变化时，由 Rust 向前端发出带 `platformId/currentUrl/canGoBack/canGoForward/isLoading` 的事件。前端只在激活 tab 显示对应状态，不轮询。

## Interaction design
- 后退：调用原生 webview 历史后退；不可用时置灰
- 前进：同上
- 主页：跳转回 `platform.url`
- 刷新：沿用现有刷新逻辑
- 地址栏：
  - 默认展示当前地址 `currentUrlByTab[activeTab]`
  - focus 时显示可编辑文本
  - Enter 时走 `normalizeUrl` 后导航
  - Esc 时恢复为最近一次已提交地址
- tab 切换：工具栏内容跟随 `activeTab` 切换，不影响其他 tab 的独立状态
- AI chat tab：不显示地址输入能力；可显示简化工具栏占位，保持整体高度稳定

## Incremental implementation order
1. 重构顶部布局与 CSS，插入固定 toolbar 容器
2. 调整 Rust 顶部高度常量，保证 webview 不覆盖 toolbar
3. 增加导航命令与状态事件
4. 前端接入 tab 级导航状态存储
5. 接通按钮和地址栏交互
6. 处理 AI chat tab 的降级展示

## Verification
- 打开普通网页 tab，确认 toolbar 固定显示且 webview 不覆盖
- 地址栏输入新 URL 后回车，可成功跳转
- 点击主页，回到该 tab 初始 `platform.url`
- 地址栏跳转后再次点击主页，确认**不会**回到最新地址，而是初始主页
- 可用时后退/前进按钮状态正确切换
- 切换多个 tab，各自地址与可后退状态互不串扰
- AI chat tab 切换时布局高度稳定、无重叠
