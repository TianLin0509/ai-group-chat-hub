# AI 群聊 Hub

> 把 **Claude、Codex、Gemini、DeepSeek** 拉进同一个「微信式」群聊，让多个 AI 命令行在一个房间里**串行接力**、并行讨论的本地桌面工作台。

一个给日常 vibecoding 用的多 AI 集成平台。它本身**不含 AI**，靠调用你本机已安装并登录的 AI CLI 工作，所有数据只存在你自己的电脑上。

---

## ✨ 核心功能

- 🗂️ **微信式会话侧栏** —— 会话按时间自动分组，未读用徽标提示，群聊可折叠展开，找会话像刷微信一样顺手。
- 💬 **AI 群聊** —— 一个房间里放多个 AI 成员，你抛一个问题，它们各自作答、互相追问反驳。
- 🔗 **串行接力 & 循环工作流** —— 「T1 逐个接力」让 AI 一个接一个基于前者输出往下做；循环工作流还能加「评审 → 不达标自动重做 → 达标自动打磨」。
- 🧩 **多 AI 集成** —— 一处配置，随处调用 Claude / Codex / Gemini / DeepSeek，混编成一个团队。
- 🔒 **纯本地** —— 无云端后端，API Key 只存本机，界面数据都在 `~/.claude-session-hub`。

---

## 🚀 快速开始

> Windows 10/11。需要先装 [Node.js 18+](https://nodejs.org/)（LTS 版即可）。

### 方式 A：源码 + 一键脚本（推荐，可改代码）

```powershell
git clone https://github.com/TianLin0509/ai-group-chat-hub.git
cd ai-group-chat-hub
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会自动检查 Node、装依赖、在桌面建快捷方式。装完双击桌面「AI 群聊 Hub」即可。

### 方式 B：安装器（只想用，不改代码）

到 [Releases](https://github.com/TianLin0509/ai-group-chat-hub/releases) 下载 `AIGroupChatHub-Setup-x.y.z.exe`，双击安装，桌面出图标。

**首次启动会有欢迎向导**，自动检测你本机装了哪些 AI CLI，并提示还差什么、怎么补。

---

## 🧩 需要哪些 AI（按需，至少一个）

| AI | 怎么算「就绪」 | 说明 |
|----|--------------|------|
| **Claude** | 装 Claude Code CLI 且命令行能跑通 `claude` | 订阅登录或填 API Key 均可 |
| **Codex** | 装 Codex CLI 且能跑通 `codex` | 登录 ChatGPT（订阅）或填 API |
| **Gemini** | 装 Gemini CLI 且能跑通 `gemini` | 本机登录 |
| **DeepSeek** | 在设置里填 DeepSeek API Key | 不用装 CLI，复用 Claude CLI 运行 |
| Python 3（可选） | `python` 在 PATH | 群聊卡片自动同步依赖它 |

只装其中一个也能用——群聊里放你有的那家即可。

---

## ⚙️ 配置（零配置起步）

- **不配置也能启动**。首次向导会带你看清缺什么。
- 右上角 **⚙️ 设置** 里可填：HTTP 代理（默认空=直连）、各家 backend / API Key / 模型。
- 配置存本机 `~/.claude-session-hub/config.json`（API Key 明文存本地，仅本机使用，不上传、不进仓库）。

---

## 📁 目录结构

```
main.js            Electron 主进程入口
main/              主进程 IPC + 群聊派发 + 循环工作流引擎
core/              会话/会议数据模型、AI 种类、配置、编排
renderer/          前端界面（侧栏、群聊房间、设置、欢迎向导）
scripts/           Claude Code hook（卡片自动同步）
install.ps1        一键安装脚本
start.bat          启动脚本
```

---

## 📄 License

见 [LICENSE](LICENSE)。本项目基于 Electron 与开源 xterm / marked / prismjs 等库构建。
