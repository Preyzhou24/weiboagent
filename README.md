# WeiboAgent — AI 微博社交机器人

 一个基于 **API 优先 + 浏览器兜底** 混合架构的智能微博运营 Agent。自动完成热搜监控、超话互动、智能评论回复、数据驱动发帖等全链路微博运营任务。支持任意 OpenAI 兼容的 LLM 端点（GLM、DeepSeek、Qwen 等）。

## 架构

```
                    ┌─────────────────────────────────┐
                    │         WeiboAgent               │
                    │                                  │
   Weibo Open API ──┤── 点赞/评论/回复/搜索/发帖/超话  │
   (OAuth Token)     │   热搜/创作者数据/激励计划       │
                    │                                  │
   agent-browser ────┤── 首页信息流/关注/取关           │
   (Chrome CDP)      │   (无 API 的操作兜底)            │
                    │                                  │
   aione CLI ────────┤── 普通微博发帖 (仅此一处)            │
                    └─────────────────────────────────┘
```

**API 优先**：所有能用 API 完成的操作都走微博开放平台 API（稳定、快速、无 UI 依赖）。
**浏览器兜底**：仅首页信息流浏览、关注/取关等无 API 替代的操作使用 Chrome CDP。

## 功能矩阵

| 功能 | 实现方式 | 说明 |
|------|----------|------|
| 热搜监控 | API | 拉取科技榜/主榜等分类热搜，匹配 AI 相关热点 |
| 智能搜索 | API | 微博智搜，返回 AI 摘要 + 帖子引用 |
| 超话互动 | API | 浏览超话帖子流、发帖、评论、回复、点赞 |
| 点赞帖子 | API | 稳定 API 调用，不依赖浏览器 |
| 评论/回复 | Web API | 通过浏览器上下文调用内部接口，绕过反机器人检测 |
| 智能评论回复 | API | 按关注关系 + 认证状态评分排序，优先回复互关和铁粉 |
| 创作者数据分析 | API | 30 天阅读/互动趋势、铁粉画像、热门博文、V 榜排名 |
| 激励计划数据 | API | 在线激励计划、高收益博文示例、命中计划分析 |
| 定时发帖 | API/CLI | 超话发帖走 API，普通微博走 aione CLI (唯一 aione 依赖) |
| 图片/视频上传 | API | 上传后返回 ID 供发帖使用 |
| 首页信息流浏览 | Browser | Chrome CDP（无 API 替代） |
| 关注/取关 | Browser | Chrome CDP（无 API 替代） |
| 操作去重 | 内置 | 跨会话操作日志，避免重复点赞/评论 |

## 项目结构

```
weiboagent/
├── setup.ps1                         # 一键安装脚本
├── .gitignore
├── README.md
└── agent/                        # Agent 框架（基于 LocoAgent）
    ├── .env                          # LLM 配置（LLM_PROVIDER / LLM_API_KEY / LLM_MODEL / LLM_BASE_URL）
    ├── package.json
    ├── tsconfig.json
    ├── skills/weibo/
    │   ├── SKILL.md                  # 微博操作手册（API + 浏览器混合策略）
    │   └── references/               # API 参考文档
    ├── scripts/
    │   ├── weibo-api/
    │   │   ├── weibo-skill.js        # 微博开放平台 API 统一入口
    │   │   └── weibo-common.js       # Token 管理 / HTTP 工具
    │   ├── workflow-engine.ts        # Workflow 生命周期管理
    │   ├── log-operation.ts          # 操作去重日志
    │   ├── run-tasks.ts              # 任务运行器
    │   └── setup-chrome.ts           # 隔离 Chrome 启动
    ├── workflows/
    │   ├── executors/                # 6 个 TypeScript 执行器
    │   │   ├── weibo-feed-monitor.ts       # 搜索 + 点赞 + 评论 (API)
    │   │   ├── weibo-daily-post.ts          # 定时发帖
    │   │   ├── weibo-hot-trend.ts           # 热搜监控 (扩展)
    │   │   ├── weibo-smart-reply.ts         # 智能评论回复 (扩展)
    │   │   ├── weibo-chaohua-heartbeat.ts   # 超话社区运营 (扩展)
    │   │   └── weibo-creator-analytics.ts   # 数据分析报告 (扩展)
    │   └── *.json                    # 对应的 workflow 配置
    ├── persona/
    │   ├── persona.md                # Agent 人设（小洛 - AI 科技观察者）
    │   ├── tasks.md                 # 每日任务配置
    │   └── content-pool.md           # 内容灵感池
    └── src/ + stubs/                 # Agent 核心运行时（OpenAI 兼容 LLM 驱动）
```

## 快速开始

### 1. 环境要求

- **Node.js** 18+（微博 API 脚本运行时）
- **Bun** 1.0+（Agent 框架运行时）
- **Python** 3.9+（仅 aione 发帖依赖）

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

### 3. 配置微博 API（核心步骤）

获取 App ID 和 App Secret（通过微博开放平台或 @微博龙虾助手）：

```bash
cd agent
node scripts/weibo-api/weibo-skill.js login --app-id=<你的APP_ID> --app-secret=<你的APP_SECRET>
```

登录成功后，Token 自动缓存，过期前自动刷新。所有后续 API 命令无需手动管理 Token。

### 4. 配置 LLM

编辑 `agent/.env`，填入你的 OpenAI 兼容端点信息：

```env
LLM_PROVIDER=custom
LLM_API_KEY=sk-your-api-key
LLM_MODEL=glm-5.2
LLM_BASE_URL=https://your-llm-endpoint.com/v1
```

> `LLM_PROVIDER` 设为 `custom` 即可适配任意 OpenAI 兼容端点。模型名和 base URL 根据你的实际服务填写。

### 5.（可选）配置浏览器

仅首页信息流浏览和关注/取关需要：

```bash
cd agent

# 启动隔离 Chrome
bun run setup-chrome --target weibo

# 在弹出的 Chrome 窗口手动登录微博
```

### 6. 验证 API 连通

```bash
cd agent

# 测试热搜 API
node scripts/weibo-api/weibo-skill.js hot-search --category=科技榜

# 测试超话列表
node scripts/weibo-api/weibo-skill.js topic-details
```

## 使用方式

### 交互模式

```bash
cd agent
bun start
```

在 Agent 对话框输入自然语言指令：

```
/weibo 拉取科技热搜，看看有什么 AI 相关的热点
/weibo 查看收到的评论，告诉我哪些值得优先回复
/weibo 在赛博茶馆超话发一条关于大模型趋势的帖子
```

### Workflow 定时调度

```bash
cd agent

# 启动超话心跳（每 1 小时）
bun run scripts/workflow-engine.ts start --id weibo-chaohua-heartbeat

# 启动热搜监控（每 3 小时）
bun run scripts/workflow-engine.ts start --id weibo-hot-trend

# 启动信息流监控（每 2 小时）
bun run scripts/workflow-engine.ts start --id weibo-feed-monitor

# 启动智能回复（每 6 小时）
bun run scripts/workflow-engine.ts start --id weibo-smart-reply

# 查看所有 workflow 状态
bun run scripts/workflow-engine.ts list

# 手动执行单个 workflow
bun run scripts/workflow-engine.ts run --id weibo-creator-analytics
```

### 直接调用 API

```bash
cd agent

# 热搜榜
node scripts/weibo-api/weibo-skill.js hot-search --category=科技榜

# 智搜
node scripts/weibo-api/weibo-skill.js search --query="AI agent"

# 创作者数据
node scripts/weibo-api/weibo-skill.js creator-summary

# 超话帖子流
node scripts/weibo-api/weibo-skill.js timeline --topic=赛博茶馆 --page=1

# 超话发帖
node scripts/weibo-api/weibo-skill.js post --topic=赛博茶馆 --status="内容" --model=deepseek

# 点赞
node scripts/weibo-api/weibo-skill.js like-post --id=<微博ID>

# 评论
node scripts/weibo-api/weibo-skill.js comment --id=<微博ID> --comment="评论内容" --model=deepseek

# 智能评论（含关注关系和认证状态）
node scripts/weibo-api/weibo-skill.js interactive-comments-to-me
```

## Workflow 一览

| Workflow | 调度 | 说明 |
|----------|------|------|
| weibo-feed-monitor | 每 2 小时 | 关键词搜索，自动点赞和评论 |
| weibo-daily-post | 每天 | 从内容池选材发帖 |
| weibo-hot-trend | 每 3 小时 | 拉取热搜，匹配 AI 相关热点，搜索并点赞 |
| weibo-smart-reply | 每 6 小时 | 拉取评论，按优先级排序，推荐/自动回复 |
| weibo-chaohua-heartbeat | 每 1 小时 | 赛博茶馆超话浏览、点赞、评论 |
| weibo-creator-analytics | 每天 | 拉取创作者数据，生成策略报告 |

## 智能评论回复优先级

| 优先级 | 关系 | 基础分 | 认证加成 |
|--------|------|--------|----------|
| 最高 | 互相关注 | 30 | +5 |
| 高 | 粉丝 | 20 | +5 |
| 中 | 我关注的 | 10 | +5 |
| 低 | 无关系 | 0 | +5 |

按分数降序排列，同分按时间降序（最新优先），默认推荐前 5 条。

## Agent 人设

Agent 名为 **小洛**，定位为 AI 科技观察者 & 内容创作者。关注领域：AI/LLM/Agent、开源项目、科技创业、编程、数码。详见 [persona/persona.md](agent/persona/persona.md)。

## 技术栈

- **Agent 运行时**：Bun + TypeScript，OpenAI 兼容 LLM 驱动
- **微博 API**：微博开放平台 OAuth + `weibo-skill.js` 封装
- **浏览器自动化**：Chrome CDP（agent-browser）
- **发帖 CLI**：[All-IN-ONE](https://github.com/cv-cat/All-IN-ONE)（aione，仅普通微博发帖）
- **运行时**：Bun + Node.js + TypeScript

## License

MIT
