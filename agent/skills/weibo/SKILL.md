---
description: "Weibo (微博) platform operations playbook. Hybrid approach: Weibo Open API (weibo-skill.js) for structured operations + agent-browser for feed browsing. API-first, browser-fallback."
allowed-tools:
  - Bash
user-invocable: true
---

# Weibo (微博) — Agent Operations Playbook (Unified)

Platform-specific operation sequences for Weibo. Uses a **hybrid API-first approach**:
- **Weibo Open API** (`node scripts/weibo-api/weibo-skill.js <command>`) — all structured operations: search, hot trends, posting, commenting, replying, liking, creator analytics, interactive analysis, super topic engagement
- **All-IN-ONE CLI** (`aione weibo ...`) — only for posting to personal timeline (no API alternative)
- **agent-browser** (Chrome CDP) — browser-only ops: home feed browsing, follow/unfollow

**API auth**: OAuth App ID + App Secret → auto-managed Token (cached + auto-refresh)
**Browser auth**: Weibo cookie saved in isolated Chrome (manual login, never automate)

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

### 1.2 Smart Search (API)

```bash
node scripts/weibo-api/weibo-skill.js search --query="AI agent"
```

Returns AI-powered search results with summary.

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

### 2.2 Comment on a Post (API)

```bash
node scripts/weibo-api/weibo-skill.js comment --id=<weibo_id> --comment="这个思路很有启发！" --model=deepseek
```

**Required**: `--model` must contain one of: doubao, qianwen, chatglm, deepseek, kimi, yiyan, sensetime, minimax, xinghuo, longcat, mimo

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

### 3.2 Post Plain Weibo (CLI fallback)

```bash
aione weibo weibo post --note-info '{"content":"今天天气真好！"}' --output json
```

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
2. **Rate limiting**: space API calls by 3-5 seconds; do not rapid-fire
3. **CAPTCHA**: if encountered — STOP immediately, notify user
4. **Cross-session dedup**: use `bun run scripts/log-operation.ts` to avoid repeating actions
5. **Element identification** (browser): never hardcode ref numbers; re-snapshot each time; identify by text/role
