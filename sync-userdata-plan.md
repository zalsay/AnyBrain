# AnyBrain (Brainer) 云端同步架构方案

## 背景说明
Brainer 需要实现一个富有野心的云端状态同步功能，旨在同时同步**应用配置**（`platforms.json`, `settings.json`, `window_state.json`）和**隔离的 WebView 数据**（`webdata/<platform_id>/`）。这样用户可以在不同设备间无缝保留各 AI 平台的登录状态、会话记录和偏好设置，而无需在每台设备上重新登录。

根据你的决定：
1. **云端后端**：使用自定义 API 服务器 + 对象存储（类似 S3）。
2. **账号系统**：实现完整的用户登录流程。
3. **后台增量同步**（难题）：在后台持续同步 WebView 的 SQLite 数据文件，而不是每次手动打包/解包。
4. **冲突解决策略**：以最后写入为准（Last Write Wins, LWW）。

其中最大的挑战在于同步 WebView 的 user-data，因为这些本质上是二进制的 SQLite 数据库文件，而在 WebKit（WebView）运行时，它们常被强力锁定，直接强行复制或读取容易导致文件损坏。

---

## 1. 整体系统架构

### 1.1 组件概览
1. **Tauri 应用（客户端）**
   - **前端 (React/Vue)**: 处理登录 UI、配置表单收集，以及调用 Tauri 同步事件。
   - **后端 (Rust)**: 负责本地文件 I/O、处理数据库锁、后台轮询、文件哈希计算，以及通过 HTTP 客户端（如 reqwest）进行网络上传。
2. **API 后端 (Node.js / Rust / Go 等)**
   - 提供 JWT / Token 身份验证。
   - 维护一个元数据数据库（如 PostgreSQL / Supabase），记录设备配置的时间线和 WebData 的快照索引（包含指向 S3 的对象链接）。
   - 为客户端提供 **预签名 URL (Presigned URLs)**，用于直接上传分块或完整文件到 S3。
3. **对象存储 (S3 / MinIO / 阿里云 OSS 等)**
   - 存储加密的（或原始的）SQLite 数据库分块/文件，以及 WebView 的 LocalStorage 和 IndexedDB 数据等大体积文件。

---

## 2. 身份认证与设备配置流程

1. **用户登录**:
   - 用户在 Brainer 应用内登录。
   - 前端将 `auth_token` 存入 `settings.json`（或通过 Tauri 插件存入系统安全密钥链 Keychain 中）。
2. **设备注册与数据隔离**:
   - 后端为每台登录的机器注册唯一的 `device_id`。
   - 所有的同步数据均绑定到对应 `user_id` 的存储桶或命名空间下，确保数据隔离和安全。

---

## 3. 配置同步策略 (`platforms.json` & `settings.json`)

**核心策略**: 简单的基于时间戳的最后写入为准 (JSON LWW)。

1. **模式扩充**:
   - 在本地写入的 `platforms.json` 和 `settings.json` 最外层附加一个 `updated_at` (毫秒级时间戳)。
2. **同步循环 (触发器：定时或文件变动时)**:
   - React 前端调用 `invoke('save_platforms')` 保存变动。
   - Rust 拿到数据，更新时间戳并落盘本地。
   - Rust 随即在后台发送 `POST /api/sync/config` 将新的 JSON 推给云端。
   - 如果云端的 `updated_at` 大于传入的时间戳，云端拒绝写入，并在响应中将最新配置下发给客户端，客户端据此覆盖本地。
3. **应用冷启动 (App Startup)**:
   - 应用刚启动、React 尚未渲染或加载平台前，首先调用 `poll_cloud_configs()`。
   - 安全拉取任何在其他设备上产生的最新配置，合并后再初始化 WebViews，防止数据覆盖。

---

## 4. WebView User-Data 同步策略（难点拆解）

WebData 文件是高频读写且被系统锁定的。当 WebKit 正在向 IndexedDB 或 localStorage 写入时，直接复制 `.db` 或 `.leveldb` 会导致损坏。因此不能在用户重度使用标签页时进行实时强同步。

### 4.1 "安全快照" (Safe Snapshot) 生命周期
采用在 WebKit 初始化的两端进行介入的方式：

1. **前置拉取合并 (Pre-Flight Restore)**:
   - 在 `ai_window_manager.rs` 中触发 `create_or_show_webview` **之前**，Rust 端向后端查询：“`platform_id` 当前是否有更新的云端 WebData 版本？”
   - 如果有：Rust 下载对应 S3 数据包，解压并在 WebKit 启动占用目录前，**替换或合并**本地的 `webdata/<platform_id>`。

2. **后置安全被份 (Post-Flight Backup)**:
   - 当一个 WebView 被隐藏、销毁，或者检测到 5 分钟无活动时，触发一次后台备份：
     - Tauri 借由 `webview.eval("...")` 如果有条件的话尝试刷新缓存。
     - Rust 使用 `file-time` 检查相比上次备份，文件是否发生变更。
     - 此时挂起读写锁（或利用文件系统快照 APFS Snapshot / VSS），安全地将该目录打包（`tar` 或 `zip`）。
     - **更保守的做法**：为了彻底避开文件锁定错误，仅在用户“关闭”标签页（完全停止 WebKit 进程对该目录的占用）时，才触发深度的后台上传。

### 4.2 后台增量同步 (基于文件哈希)
每次都上传几百兆的完整 WebView 数据不仅浪费带宽，也消耗云端存储。必须过滤无用的系统缓存。

**极致优化方案**:
- **过滤特定路径**: 完全不参与同步的目录：`Cache`, `Code Cache`, `GPUCache`, `Service Worker/CacheStorage`，崩溃转储等。只同步核心目录：`Cookies`, `Local Storage`, `IndexedDB`, `Session Storage` 及其内部的级联文件。
- **文件指纹与哈希比对**:
  - Rust 生成一份快照清单（Manifest），包含各个文件的相对路径及其 SHA-256 哈希值。
  - Rust 将此 Manifest 发送到 `POST /api/sync/webdata_check`。
  - 后端对比云端最近的一份快照，返回一个“缺失/已变更文件列表”。
  - Rust 仅针对这些确实发生变动或新增的文件请求预签名 S3 PUT URL。
  - Rust 上传完毕后，调用 `POST /api/sync/webdata_commit` 提交这次记录，完成云端版本的迭代。

---

## 5. 安全与隐私考量 (极重要)

WebView 数据里包含着未经处理的明文 Session 和 Cookies（比如带有你的 OpenAI、Claude 等高价值资产的完整身份令牌）。将这些同步到自己搭建的服务器，意味着云端（甚至服务器管理员查库时）可能接触到这些核心凭证。

- **端到端加密 (E2EE)**:
  - 在 Rust 准备上传 WebData 的 `tar`/`zip` 或文件分块之前，**必须**使用应用级别的一个“恢复密钥”（Recovery Key）或派生自用户登录密码的密钥，对数据进行对称加密（如 AES-GCM-256）。
  - 上传到 S3 的数据必须是密文，解密只允许在客户端（Tauri 的 Rust 或 React 层）发生。
  - 这样即使你的服务器被黑，攻击者也得不到各平台的 Token 凭证。

---

## 6. 实施路线图建议

**阶段一：基础设施搭建（应用配置同步）**
- 实现云端后端的 `POST /api/auth` (登录/注册) 和 `POST /api/sync/configs` 接口。
- 在前端完成登录 UI 界面。
- 重构 `App.tsx` 和 `lib.rs` 的通信逻辑，使其在写入本地配置的同时，带有版本机制地推送至云端。

**阶段二：引入对象存储与快照校验（无 WebView 加入前）**
- 在云端完成生成 S3 预签名上传 URL 接口 (`GET /api/sync/upload_url`)。
- 在 Rust 层编写目录遍历、剔除缓存文件夹、文件哈希计算并生成 Manifest 的逻辑。
- 在 Rust 中集成一个独立线程或基于 Tokio 的异步上传队列。

**阶段三：深入拦截 WebView 生命周期并加密**
- 完善安全加密层（E2EE），在写入前自动实现 AES 加密脱敏。
- 改造 `ai_window_manager.rs` 里的 `create_or_show_webview` 逻辑。
- 实现启动前的前置拉取，和隐藏/退出后的后置静默上传，处理好可能的 SQLite 文件锁冲突（不强制抛出严重错误导致 App 崩溃，而是静默重试或延迟同步）。

---
*规划结束。等待验收。*