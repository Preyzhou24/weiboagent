﻿---
description: "Weibo (微博) platform operations playbook. Hybrid approach: Weibo Open API (weibo-skill.js) for structured operations + agent-browser for feed browsing. API-first, browser-fallback."
allowed-tools:
  - Bash
user-invocable: true
---

# Weibo (微博) — Agent Operations Playbook (Unified)

Platform-specific operation sequences for Weibo. Uses a **hybrid three-tier approach**:
- **Weibo Open API** (`node scripts/weibo-api/weibo-skill.js <command>`) — structured write operations: liking, commenting, replying, hot trends, creator analytics, interactive analysis, super topic engagement
- **aione search** (`node scripts/weibo-api/weibo-search.js search`) — keyword search via All-IN-ONE's cookie API. Returns structured results (content + user + clean URL) with auto-converted numeric MID. Replaces the old OAuth wis-search (which only returned an AI summary requiring regex-parsed mblogids)
- **All-IN-ONE CLI** (`aione weibo ...`) — image/video upload only (posting moved to agent-browser)
- **agent-browser** (Chrome CDP) — browser-only ops: home feed browsing, follow/unfollow, plain weibo posting

**API auth**: OAuth App ID + App Secret → auto-managed Token (cached + auto-refresh)
**Browser auth**: Weibo cookie saved in isolated Chrome (manual login, never automate)
**aione auth**: Weibo cookie per profile (`aione auth weibo set-cookie --profile <web|creator>`)

---

## Table of Contents

- [0. Prerequisites & Setup](#0-prerequisites--setup)
- [1. Browse & Read](#1-browse--read)
- [2. Engagement — React to Content](#2-engagement--react-to-content)
- [3. Content Creation](#3-content-creation)
- [4. Super Topic (超话) Engagement](#4-super-topic-engagement)
- [5. Social Graph](#5-social-graph)
- [6. Creator Analytics & Data-Driven Strategy](#6-creator-analytics--data-driven-strategy)
- [7. Smart Comment Reply](#7-smart-comment-reply)
- [8. Scheduled Tasks & Heartbeat](#8-scheduled-tasks--heartbeat)
- [9. Authentication & Session](#9-authentication--session)

---

## 0. Prerequisites & Setup

### Weibo Open API Setup (Primary — for all structured operations)

First-time configuration:

1. Ask user for `App ID` and `App Secret` (from Weibo Open Platform)
2. Run login to save credentials and obtain Token:

```bash
node scripts/weibo-api/weibo-skill.js login --app-id=<APP_ID> --app-secret=<APP_SECRET>
```

After login, the script auto-caches credentials and Token. Subsequent commands auto-read cached Token and refresh before expiry — no manual management needed.

### All-IN-ONE CLI Setup (Posting only)

```bash
pip install all-in-one-aione\naione auth weibo set-cookie --profile creator --cookie "YOUR_CREATOR_COOKIE"  # Only creator cookie needed for posting
```

### Browser Setup (For feed browsing and follow/unfollow only)

```bash
bun run setup-chrome --target weibo    # Launch isolated Chrome (port 9229)
```

Log into weibo.com once in the opened Chrome. Session persists. Never let agent automate login.

---

## 1. Browse & Read

### 1.1 Hot Search Rankings (API)

```bash
# Categories: 主榜 / 文娱榜 / 社会榜 / 生活榜 / acg榜 / 科技榜 / 体育榜
node scripts/weibo-api/weibo-skill.js hot-search --category=科技榜
```

Use this at the start of each session to discover trending topics and ride the wave.

### 1.2 Smart Search (aione cookie API)

```bash
# aione 搜索: 返回结构化帖子列表 (id + url + content + user)
node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1
```

Returns structured posts ready for engagement: each has a numeric `id` (auto-converted from base62) for `like-post`, a `url` for dedup logging, and `content`/`user` for relevance filtering. The old OAuth `weibo-skill.js search` only returned an AI summary with embedded mblogids (unreliable for targeting).

### 1.3 Browse Home Feed (Browser)

```bash
agent-browser open https://weibo.com
agent-browser wait 2000
agent-browser snapshot -i -c
```

No API for home timeline — browser is the only option. See [references/weibo-search.md](references/weibo-search.md) for API search details.

### 1.4 View Own Posts (API)

```bash
node scripts/weibo-api/weibo-skill.js status --count=10
```

### 1.5 View Single Post (API)

```bash
node scripts/weibo-api/weibo-skill.js status-show --id=<MID>
# Or by URL:
node scripts/weibo-api/weibo-skill.js status-show --url="https://weibo.com/123456/AbCdEf"
```

---

## 2. Engagement — React to Content

### 2.1 Like a Post (API)

```bash
node scripts/weibo-api/weibo-skill.js like-post --id=<weibo_id>
```

Stable API call — no browser automation needed.

### 2.2 Comment on a Post (agent-browser)

普通微博评论使用 agent-browser (Chrome CDP) 模拟真人操作，不依赖 Ajax API 或 cookie，抗封禁能力最强：

```bash
node scripts/browser-comment.js comment --id=<微博MID或base62> --comment="评论内容"
```

**前提**: Chrome CDP 已启动并登录 weibo.com

**流程**: 打开帖子详情页 → 填入评论 → 点击评论按钮 → 验证成功（评论框清空 = 成功）

**ID 格式自动识别**: `--id` 同时接受数字 MID（如 `5326346139994630`）和 base62 ID（如 `NcU5a07Ib`）。base62 格式会自动转换为数字 MID，无需手动处理。

**优势**: 相比 Ajax API 方式，浏览器自动化完全是真人操作流程，不触发 `update weibo too fast` 账号级风控，不依赖 cookie 有效性。评论内容由 AI 动态生成（`ai-comment.js`），针对每条微博正文生成 10-30 字个性化短评。

**权限限制处理**: 当博主设置了评论权限，脚本检测到错误提示后返回 `restriction` 标记：
```json
{
  "code": -1,
  "message": "你没有评论此微博的权限...",
  "data": { "restriction": true, "reason": "..." }
}
```

Workflow executor 遇到限制时会打印 `⚠ 评论受限: <原因>` 并跳过，不会重试或报错退出。评论间内置 20-30 秒随机延迟 + 每小时 10 条上限。

> 超话帖子评论仍使用 API `weibo-skill.js comment --id=<id> --comment=<text> --model=<model>`（超话帖子有评论权限）

### 2.3 Reply to a Comment (API)

```bash
node scripts/weibo-api/weibo-skill.js reply --cid=<comment_id> --id=<weibo_id> --comment="感谢补充！" --model=deepseek
```

### 2.4 Like a Comment (API)

```bash
node scripts/weibo-api/weibo-skill.js like-comment --cid=<comment_id>
```

### 2.5 Legacy: Browser-based Engagement (Fallback)

Only use browser when API is unavailable. See [references/weibo-crowd.md](references/weibo-crowd.md) for API interaction details.

---

## 3. Content Creation

### 3.1 Post in Super Topic (API)

```bash
node scripts/weibo-api/weibo-skill.js post --topic="AI" --status="今天分享一个 Agent 架构思路\n\n核心是让 LLM 自主规划任务..." --model=deepseek
```

Use `\n` for line breaks (single backslash, not `\\n`).

### 3.2 Post Plain Weibo (agent-browser)

```bash
# 基于 agent-browser (Chrome CDP) 发帖：模拟真人操作，不依赖 API 或 cookie
# weibo-daily-post.ts 自动执行: 打开 weibo.com → 填入内容 → 点击发送
bun run scripts/workflow-engine.ts run --id weibo-daily-post
```

完全真人操作流程，抗封禁能力最强。发帖后自动写入 10 分钟冷却标记，评论执行器读取后会自动等待，避免触发 `update weibo too fast` 账号级风控。
超话发帖仍走 OAuth API（`weibo-skill.js post --topic`），不触发 update 频率限制。

### 3.3 Upload Image (API)

```bash
node scripts/weibo-api/weibo-skill.js pic-upload --file="/path/to/image.jpg"
# Returns pic_id for use in post --pic-ids
```

### 3.4 Upload Video (API)

```bash
node scripts/weibo-api/weibo-skill.js video-upload --file="/path/to/video.mp4"
# Returns video_id for use in post --media-id
```

### 3.5 Post with Media (API)

```bash
node scripts/weibo-api/weibo-skill.js post --topic="AI" --status="看这个架构图" --model=deepseek --pic-ids=<pic_id>
```

---

## 4. Super Topic (超话) Engagement

Super topics are targeted communities — engagement here is far more effective than generic search.

### 4.1 List Available Super Topics (API)

```bash
node scripts/weibo-api/weibo-skill.js topic-details
```

### 4.2 Browse Super Topic Feed (API)

```bash
node scripts/weibo-api/weibo-skill.js timeline --topic="AI" --page=1 --count=10
```

### 4.3 Get Pinned Posts (API)

```bash
node scripts/weibo-api/weibo-skill.js top-list --topic="AI"
```

### 4.4 Get Comments (API)

```bash
# First-level comments
node scripts/weibo-api/weibo-skill.js comments --id=<weibo_id>
# Child comments (replies to a comment)
node scripts/weibo-api/weibo-skill.js child-comments --id=<weibo_id> --cid=<comment_id>
```

---

## 5. Social Graph

### 5.1 Follow / Unfollow (Browser — no API available)

```bash
agent-browser open "https://weibo.com/u/<user_id>"
agent-browser wait 2000
agent-browser snapshot -i -c
# Find "关注" button, click it
agent-browser click <follow_button_ref>
```

### 5.2 View Own Profile (CLI)

```bash
aione weibo info self --output json
```

---

## 6. Creator Analytics & Data-Driven Strategy

### 6.1 Get Creator Summary (API)

```bash
node scripts/weibo-api/weibo-skill.js creator-summary
```

Returns: 30-day read/post/interaction trends, 7-day fan/iron-fan data, fan portrait, hot posts, V rankings. See [references/weibo-creator.md](references/weibo-creator.md).

### 6.2 Get Incentive Plan Data (API)

```bash
node scripts/weibo-api/weibo-skill.js adincentive-summary
```

Returns: active incentive plans, high-earning post examples, your quality posts matching plans. See [references/weibo-adincentive.md](references/weibo-adincentive.md).

### 6.3 Data-Driven Content Strategy

Use creator data to guide content decisions:
- Check which post categories get highest 千阅互动数 (interactions per 1000 reads)
- Align content with fan interest tags from bigFanPortrait.tags
- Target topics that match active incentive plans
- Track V榜 ranking trends to measure progress

---

## 7. Smart Comment Reply

### 7.1 Get Comments Received (API)

```bash
node scripts/weibo-api/weibo-skill.js interactive-comments-to-me
```

Returns comments with followMe, following, verified status for priority scoring.

### 7.2 Get All Comments on a Post (API)

```bash
node scripts/weibo-api/weibo-skill.js interactive-comments-show --id=<weibo_id>
```

### 7.3 Priority-Based Reply Strategy

Priority ranking (higher = reply first):

| Priority | Relationship | Base Score | Verified Bonus |
|----------|-------------|------------|---------------|
| Highest | Mutual follow | 30 | +5 |
| High | Follower | 20 | +5 |
| Medium | I follow | 10 | +5 |
| Low | No relation | 0 | +5 |

Sort by score descending, then by time descending (newest first). Recommend top 5, max 20.

See [references/weibo-interactive.md](references/weibo-interactive.md) for full analysis methodology.

---

## 8. Scheduled Tasks & Heartbeat

### 8.1 Super Topic Heartbeat

Configured as a workflow (`weibo-chaohua-heartbeat`) that runs periodically:
- Process interaction messages
- Execute hot search
- Browse super topics
- Generate content
- Report progress

See [references/weibo-cron.md](references/weibo-cron.md) and [references/HEARTBEAT-PROCESS.md](references/HEARTBEAT-PROCESS.md).

### 8.2 Workflow Integration

All Weibo operations are wired as workflow executors in `workflows/executors/`:
- `weibo-feed-monitor.ts` — search + auto like/comment (API)
- `weibo-daily-post.ts` — daily content posting
- `weibo-hot-trend.ts` — hot search monitoring + trending content
- `weibo-smart-reply.ts` — priority-based comment reply
- `weibo-chaohua-heartbeat.ts` — super topic community engagement
- `weibo-creator-analytics.ts` — data-driven content strategy report

---

## 9. Authentication & Session

### API Token (Primary)

```bash
# First-time login
node scripts/weibo-api/weibo-skill.js login --app-id=<ID> --app-secret=<SECRET>

# Token auto-cached at ~/.weibo-skill/token-cache.json
# Auto-refreshes before expiry
# Re-login to switch accounts
```

### Browser Session (For feed/follow only)

```bash
bun run setup-chrome --target weibo    # Launch isolated Chrome
bun run doctor --check-cdp             # Verify CDP alive
```

If session expired: STOP, ask user to re-login manually. Never automate login.

---

## Best Practices

1. **API-first**: try `weibo-skill.js` before any browser operation
2. **Rate limiting**: never rapid-fire. Single like ≥ 9s (with jitter), single comment ≥ 20s (with jitter). Batch engagement is the #1 cause of "操作频繁" — historical logs showed ~100 like/comment in 10 minutes collapsed to <20% success. The search/feed executors now enforce this pacing plus a daily cap (default 30 likes / 15 comments per day)
3. **Circuit breaker**: if any like or comment returns a rate-limit error, the executor immediately halts the rest of that run (`circuit-broken`). Do not keep firing after a single "操作繁忙" — it only deepens the throttle window
4. **Daily caps**: executors check `bun run scripts/log-operation.ts daily-count --platform weibo` at startup; if the day's successful likes/comments already exceed the cap, the run is skipped entirely
3. **CAPTCHA**: if encountered — STOP immediately, notify user
5. **Cross-session dedup**: use `bun run scripts/log-operation.ts` to avoid repeating actions
6. **Element identification** (browser): never hardcode ref numbers; re-snapshot each time; identify by text/role
