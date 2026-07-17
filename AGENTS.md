# AGENTS.md — 给 AI 助手的安装与使用指引

> 如果你是一个 AI 编码助手（Claude Code / Cursor / Copilot 等），你的用户想安装并使用「AI 群聊 Hub」。**请按本文件一步步执行**。环境：Windows + PowerShell。

## 这是什么

一个 Electron 桌面应用，把多个 AI 命令行（Claude / Codex / Gemini / DeepSeek）聚合到一个「微信式」群聊界面，支持串行接力与循环工作流。它**不含 AI**，靠调用本机已安装并登录的 AI CLI 工作。

---

## 步骤 1 · 环境自检（先跑，据结果决定后续）

```powershell
node -v                                   # 需要 v18+
git --version                             # clone 用（下载 zip 则不需要）
where.exe claude ; where.exe codex ; where.exe gemini   # 至少一个命中
where.exe python                          # 可选（卡片自动同步用）
```

判断规则：
- `node -v` 低于 v18 或缺失 → **停下**，让用户先装 Node.js 18+（https://nodejs.org LTS），重开终端再继续。
- 三个 AI CLI **全部**未命中 → 仍可安装，但要告知用户「至少装并登录一个 AI CLI 才能真正群聊」。
- `python` 未命中 → 不阻塞，安装后提醒用户「装 Python 3 可让群聊卡片自动同步」。

---

## 步骤 2 · 安装（默认走方式 A）

### 方式 A：源码 + 一键脚本

```powershell
git clone https://github.com/TianLin0509/ai-group-chat-hub.git
cd ai-group-chat-hub
powershell -ExecutionPolicy Bypass -File install.ps1
```

`install.ps1` = 检查 Node → `npm install`（下载 Electron，1–3 分钟）→ 建桌面快捷方式。
若 `install.ps1` 因执行策略被拦，就是上面这条带 `-ExecutionPolicy Bypass` 的写法。

### 方式 B：安装器 exe（用户只想用、不改代码时）

引导用户到仓库 Releases 页下载 `AIGroupChatHub-Setup-x.y.z.exe` 双击安装。此方式无需 Node。

---

## 步骤 3 · 验证安装

```powershell
Test-Path .\node_modules\electron\dist\electron.exe    # 期望 True（方式 A）
```

启动（三选一）：双击桌面「AI 群聊 Hub」／ `.\start.bat` ／ `.\node_modules\electron\dist\electron.exe .`

**期望现象**：出现主界面；**首次启动弹出欢迎向导**，列出 Claude / Codex / Gemini / DeepSeek 四家的就绪状态。看到向导即代表装成功。

---

## 步骤 4 · 配置（零配置起步，按需补）

- 无需任何配置文件即可启动，先让用户点「开始使用」进主界面。
- 缺哪家 AI，就按向导提示装对应 CLI 并登录。
- **DeepSeek**：不用装 CLI → 右上角「⚙️ 设置 → DeepSeek → 填 API Key → 保存」。
- **需要代理**才能连 AI → 「⚙️ 设置 → HTTP 代理」填（默认空 = 直连）。
- 配置存本机 `~/.claude-session-hub/config.json`；API Key 明文仅存本地，**不要**替用户把 Key 写进任何会进 git 的文件。

---

## 步骤 5 · 常见问题（按现象处置）

| 现象 | 处置 |
|------|------|
| 启动报 `Cannot find module` | 依赖不全 → 项目目录重跑 `npm install`，再启动 |
| 群聊卡片一直「创建中」 | 该 AI 的 CLI 没装/没登录/不在 PATH → 开终端确认它能**直接跑通进入对话** |
| 卡片不自动刷新 | 装 Python 3 并加入 PATH |
| DeepSeek 起不来 | 设置里没填 DeepSeek API Key |

---

## 红线（不要做）

- **不要** `npm run dist` 或打包命令在用户的开发目录里跑（会改动 `node_modules`）。打包要在干净副本里做。
- **不要**把任何 API Key / 密钥写进仓库文件或提交到 git。
- **不要**替用户执行登录/付费类不可逆操作，涉及时先问用户。
