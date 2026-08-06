# WeiboAgent — AI 微博社交运营 Agent

一个基于 **Chrome CDP 真人操作 + aione cookie 搜索/发帖** 的混合架构微博运营 Agent。自动完成信息流浏览、点赞、评论、关注、发帖等核心任务。支持任意 OpenAI 兼容的 LLM 端点。

## 架构

```
                     ┌──────────────────────────────┐
                     │        WeiboAgent              │
                     │                                │
   Chrome CDP ───────┤  浏览/点赞/评论/关注       │
   (真人操作)         │  抗封禁能力最强                │
                     │                                │
   aione CLI ────────┤  关键词搜索/用户资料/历史微博    │
   (cookie 驱动)      │  单条详情/评论列表/移动端搜索    │
                     └──────────────────────────────┘
```

**Chrome CDP 优先**：浏览、点赞、评论、关注走 Chrome CDP 真人操作流程；发帖走 aione 纯 HTTP，不依赖 OAuth API 或 cookie 有效性，抗封禁能力最强。
**aione 辅助**：搜索、用户资料、历史微博等读操作走 aione cookie 驱动。
**限流防护**：日上限预检 + 限流熔断 + 连续失败停止 + 发帖冷却，从源头避免触发账号风控。

## 功能矩阵

| 功能 | 实现方式 | 说明 |
|------|----------|------|
| 浏览信息流 | Chrome CDP | 首页信息流浏览（无 API 替代）|
| 点赞 | Chrome CDP | browser-like.js，浏览器内调点赞 Ajax |
| 评论 | Chrome CDP + AI | browser-comment.js + ai-comment.js 动态生成 |
| 关注/取关 | Chrome CDP | 模拟真人点击 |
| 发帖 | aione (纯 HTTP) | 支持 text+图片，发帖后 10 分钟冷却 |
| 智能搜索 | aione cookie | 结构化搜索（id+url+content+user），base62 自动转数字 MID |
| 用户资料查询 | aione cookie | 查看任意用户资料（昵称/粉丝数/简介）|
| 用户历史微博 | aione cookie | 分页/全量拉取，用于竞品分析 |
| 单条微博详情 | aione cookie | work-info 降级通道 |
| 评论列表 | aione cookie | word-comments 降级通道 |
| 移动端搜索 | aione cookie | mobile profile，web cookie 限流时降级 |
| 操作去重 | 内置 | 跨会话操作日志，避免重复点赞/评论 |

## 限流防护体系

| 规则 | 默认值 | 作用 |
|------|--------|------|
| 日上限预检 | 30 赞 / 15 评 | 启动时查 `log-operation.ts daily-count`，超限直接跳过本轮 |
| 每小时评论上限 | 10 条 | `hourly-count` 实时统计，超限停止评论 |
| 限流熔断 | 命中即停 | 任意 like/comment 返回"操作繁忙"即终止本轮 |
| 连续失败停止 | 3 次 | 连续 3 次失败即停，避免加深风控窗口 |
| 单次间隔 | 赞 9s± / 评 20s± | 带随机抖动，模拟真人节奏 |
| 发帖冷却 | 10 分钟 | 发帖后冷却标记，评论执行器读取后自动等待 |

## 快速开始

### 1. 环境要求

- **Bun** 1.0+（Agent 框架运行时）
- **Node.js** 18+（脚本运行时）
- **Python** 3.9+（aione 搜索依赖）

### 2. 一键安装

```powershell
.\setup.ps1
```

或手动安装：

```bash
# Bun
irm https://bun.sh/install.ps1 | iex

# Python 依赖
pip install all-in-one-aione

# Agent 依赖
cd agent
bun install
```

### 3. 配置浏览器（核心步骤）

```bash
cd agent
bun run setup-chrome --target weibo
# 在弹出的 Chrome 窗口手动登录微博
```

这一个登录覆盖全部 5 个核心功能（浏览、点赞、评论、关注、发帖）。

### 4. 同步 aione cookie（搜索用）

登录 Chrome 后，自动提取 cookie 同步到 aione：

```bash
cd agent
node scripts/sync-cookies.js sync
```

cookie 失效后（aione 搜索报错时）重新执行即可。

### 5. 配置 LLM

编辑 `agent/.env`，填入你的 OpenAI 兼容端点信息：

```env
LLM_PROVIDER=custom
LLM_API_KEY=sk-your-api-key
LLM_MODEL=glm-5.2
LLM_BASE_URL=https://your-llm-endpoint.com/v1
```

AI 评论生成（`ai-comment.js`）也读这份配置。

### 6. 验证

```bash
cd agent

# 测试 aione 搜索
node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1

# 测试用户资料
node scripts/weibo-api/weibo-search.js user-info --user-id="<user_id>"
```

## 使用方式

### 交互模式

```bash
cd agent
bun start
```

在 Agent 对话框输入自然语言指令：

```
/weibo 搜索 AI agent 相关的微博
/weibo 看看收到的评论，告诉我哪些值得优先回复
/weibo 给这条微博点个赞
```

### Workflow 定时调度

```bash
cd agent

# 启动信息流监控（搜索 + 自动点赞评论）
bun run scripts/workflow-engine.ts start --id weibo-feed-monitor

# 启动定时发帖（每天）
bun run scripts/workflow-engine.ts start --id weibo-daily-post

# 查看所有 workflow 状态
bun run scripts/workflow-engine.ts list
```

### 直接调用

```bash
cd agent

# 搜索（aione cookie 驱动）
node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1

# 用户历史微博
node scripts/weibo-api/weibo-search.js user-all-posted --user-url="<url>"

# 点赞（Chrome CDP）
node scripts/browser-like.js like --id=<微博ID>

# 浏览器评论（Chrome CDP）
node scripts/browser-comment.js comment --id=<微博ID> --comment="评论内容"

# AI 动态生成评论
node scripts/ai-comment.js generate --content="原微博正文" --user="博主名"

# 查看今日操作计数（限流判断用）
bun run scripts/log-operation.ts daily-count --platform weibo
```

## Workflow 一览

| Workflow | 调度 | 说明 |
|----------|------|------|
| weibo-feed-monitor | 每 2 小时 | 关键词搜索，自动点赞和评论（含限流熔断）|
| weibo-daily-post | 每天 | 从内容池选题发帖（含发帖冷却）|

## 项目结构

```
weiboagent/
├── setup.ps1                         # 一键安装脚本
├── README.md
├── agent/
    ├── .env                          # LLM 配置
    ├── package.json
    ├── skills/weibo/
    │   ├── SKILL.md                  # 微博操作手册
    │   └── references/               # 参考文档
    ├── scripts/
    │   ├── weibo-api/
    │   │   └── weibo-search.js       # aione 微博搜索与浏览封装
    │   ├── browser-comment.js        # Chrome CDP 评论
    │   ├── browser-like.js           # Chrome CDP 点赞
    │   ├── sync-cookies.js           # 从 Chrome 自动同步 cookie 到 aione
    │   ├── ai-comment.js             # AI 动态评论生成
    │   ├── workflow-engine.ts        # Workflow 生命周期管理
    │   ├── log-operation.ts          # 操作去重日志
    │   └── run-tasks.ts              # 任务运行器
    ├── workflows/
    │   ├── executors/
    │   │   ├── weibo-feed-monitor.ts # 搜索 + 点赞 + 评论
    │   │   └── weibo-daily-post.ts   # 定时发帖
    │   └── *.json                    # 对应的 workflow 配置
    ├── persona/
    │   ├── persona.md                # Agent 人设
    │   ├── comment-style.md          # 评论风格约束
    │   └── content-pool.md           # 内容灵感池
    └── src/ + stubs/                 # Agent 核心运行时
```

## Agent 人设

Agent 名为 **小洛**，定位为 AI 科技观察者 & 内容创作者。详见 [persona/persona.md](agent/persona/persona.md)。评论风格由 [comment-style.md](agent/persona/comment-style.md) 约束。

## 技术栈

- **Agent 运行时**：Bun + TypeScript，OpenAI 兼容 LLM 驱动
- **浏览器自动化**：Chrome CDP（agent-browser），点赞/评论/关注走真人操作流程；发帖走 aione 纯 HTTP
- **aione CLI**：[All-IN-ONE](https://github.com/cv-cat/All-IN-ONE) cookie 驱动的搜索、用户资料、历史微博

## 参考项目

- [LocoAgent](https://github.com/IdanTestSomething/LocoAgent) — Agent 框架与 LLM 编排参考
- [All-IN-ONE](https://github.com/cv-cat/All-IN-ONE) — aione 搜索/浏览 CLI

## License

MIT
