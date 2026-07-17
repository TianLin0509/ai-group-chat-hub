# 安装指南

面向人和 AI 助手都能照做。全程 **Windows + PowerShell**。

---

## 0. 前置依赖

| 必需 | 说明 |
|------|------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org/) 下 LTS，安装后**重开终端** |
| **至少一个 AI CLI** | Claude / Codex / Gemini 任一，已安装且**能在命令行直接跑通并进入对话**（订阅登录或 API） |

| 可选 | 说明 |
|------|------|
| Git | 用 `git clone` 拿源码（也可直接下载 zip） |
| Python 3 | 开启 Claude Hook 快速同步时需要；关闭 Hook 时不要求 |
| DeepSeek API Key | 想用 DeepSeek 成员时需同时安装 Claude CLI，并在设置里填 Key |

自检命令：

```powershell
node -v                                   # 需 v20+
where.exe claude ; where.exe codex ; where.exe gemini   # 至少一个能命中
where.exe python                          # 可选
```

---

## 1. 安装（二选一）

### 方式 A：源码 + 一键脚本（推荐）

```powershell
git clone https://github.com/TianLin0509/ai-group-chat-hub.git
cd ai-group-chat-hub
powershell -ExecutionPolicy Bypass -File install.ps1
```

`install.ps1` 做三件事：检查 Node → `npm install`（下载 Electron，约 1–3 分钟）→ 桌面建快捷方式。

> 没有 git？在仓库页点 **Code → Download ZIP**，解压后 `cd` 进目录再跑 `install.ps1`。

### 方式 B：安装器 exe

到 [Releases](https://github.com/TianLin0509/ai-group-chat-hub/releases) 下载 `AIGroupChatHub-Setup-x.y.z.exe`，双击安装，桌面出图标。此方式无需 Node。

> **SmartScreen 提示**：安装器未做代码签名，Windows 可能弹「已保护你的电脑」——点「更多信息 → 仍要运行」即可。

---

## 2. 启动

- 双击桌面 **「AI 群聊 Hub」**，或
- 在项目目录运行 **`start.bat`**，或
- 手动：`.\node_modules\electron\dist\electron.exe .`

首次启动会弹**欢迎向导**，列出本机 4 家 AI 的启动条件检测结果。该检测只确认命令/Key 是否具备，不验证账号登录。

---

## 3. 配置 AI（零配置起步）

1. 向导里检测到 ✅ 后，仍请先在终端跑通并登录对应 CLI；⬜ 的按提示补齐。
2. 用 DeepSeek：安装并登录 Claude CLI，再到 **⚙️ 设置 → DeepSeek → 填 API Key → 保存**。
3. **AI 执行权限默认“安全模式”**；“完全自动”会跳过审批/沙箱，只应在隔离环境使用。
4. Claude Hook 默认关闭；需要更快卡片同步时可在设置中开启，保存后重启 Hub 生效。
5. 需要代理才能连 AI：**⚙️ 设置 → HTTP 代理**（默认空=直连）。
6. 建群聊：点「💬 开始 AI 群聊」→ 选成员（最多 3 个）→ 创建。

---

## 4. 故障排查

| 现象 | 原因 / 解决 |
|------|------------|
| 启动报 `Cannot find module 'xxx'` | 依赖没装全 → 项目目录重跑 `npm install` |
| 群聊卡片一直「创建中…」 | 对应 CLI 虽被检测到但未登录/不可用 → 开终端确认 `claude` `codex` `gemini` 能**直接跑通并进入对话** |
| 卡片同步偏慢 | 默认走 transcript 终态检测；需要快路径可安装 Python 3，并在设置开启 Claude Hook 后重启 Hub |
| DeepSeek 成员起不来 | 确认 Claude CLI 已安装并登录，且设置里已填 DeepSeek API Key |
| 连不上 AI（超时） | 需要代理 → 设置里填 HTTP 代理 |
| `install.ps1` 被拦 | 用 `powershell -ExecutionPolicy Bypass -File install.ps1` |

---

## 5. 卸载

- 方式 A：删项目目录 + 桌面快捷方式即可。
- 方式 B：控制面板卸载「AI 群聊 Hub」。
- 配置/数据在 `~/.claude-session-hub`，想彻底清干净可一并删除。
