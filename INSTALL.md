# 安装指南

面向人和 AI 助手都能照做。全程 **Windows + PowerShell**。

---

## 0. 前置依赖

| 必需 | 说明 |
|------|------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) 下 LTS，安装后**重开终端** |
| **至少一个 AI CLI** | Claude / Codex / Gemini 任一，已安装且**能在命令行直接跑通并进入对话**（订阅登录或 API） |

| 可选 | 说明 |
|------|------|
| Git | 用 `git clone` 拿源码（也可直接下载 zip） |
| Python 3 | 群聊卡片自动同步依赖；不装也能群聊，只是卡片不自动刷新 |
| DeepSeek API Key | 想用 DeepSeek 成员时，在设置里填即可（不用装 CLI） |

自检命令：

```powershell
node -v                                   # 需 v18+
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

---

## 2. 启动

- 双击桌面 **「AI 群聊 Hub」**，或
- 在项目目录运行 **`start.bat`**，或
- 手动：`.\node_modules\electron\dist\electron.exe .`

首次启动会弹**欢迎向导**，列出本机 4 家 AI 的就绪状态。

---

## 3. 配置 AI（零配置起步）

1. 向导里检测到 ✅ 的可直接用；⬜ 的按提示装好对应 CLI 并登录。
2. 用 DeepSeek：**⚙️ 设置 → DeepSeek → 填 API Key → 保存**。
3. 需要代理才能连 AI：**⚙️ 设置 → HTTP 代理**（默认空=直连）。
4. 建群聊：点「💬 开始 AI 群聊」→ 选成员（默认 3 个，可加减）→ 创建。

---

## 4. 故障排查

| 现象 | 原因 / 解决 |
|------|------------|
| 启动报 `Cannot find module 'xxx'` | 依赖没装全 → 项目目录重跑 `npm install` |
| 群聊卡片一直「创建中…」 | 对应 AI 的 CLI 没装 / 没登录 / 不在 PATH → 开终端确认 `claude` `codex` `gemini` 能**直接跑通并进入对话** |
| 卡片不自动更新 | 装 Python 3 并加入 PATH（hook 同步依赖） |
| DeepSeek 成员起不来 | 设置里没填 DeepSeek API Key |
| 连不上 AI（超时） | 需要代理 → 设置里填 HTTP 代理 |
| `install.ps1` 被拦 | 用 `powershell -ExecutionPolicy Bypass -File install.ps1` |

---

## 5. 卸载

- 方式 A：删项目目录 + 桌面快捷方式即可。
- 方式 B：控制面板卸载「AI 群聊 Hub」。
- 配置/数据在 `~/.claude-session-hub`，想彻底清干净可一并删除。
