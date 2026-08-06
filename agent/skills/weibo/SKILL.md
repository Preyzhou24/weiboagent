---
description: "Weibo operations playbook. Chrome CDP for browsing/liking/commenting/following/posting + aione for search and user data."
allowed-tools:
  - Bash
user-invocable: true
---

# Weibo Operations Playbook

Two execution channels, no OAuth needed:

- **Chrome CDP** (`agent-browser`) — browser-only ops: feed browsing, liking, commenting, following. Real human operation flow, strongest anti-ban.
- **aione CLI** (`node scripts/weibo-api/weibo-search.js <command>`) — cookie-driven read ops: keyword search, user info, user post lists, single post detail, comment lists, mobile search.

**Browser auth**: Weibo cookie saved in isolated Chrome (manual login, never automate)
**aione auth**: Weibo cookie per profile (`aione auth weibo set-cookie --profile web`)
**Auto-sync**: `node scripts/sync-cookies.js sync` extracts cookie from Chrome CDP and syncs to aione

---

## 0. Prerequisites & Setup

### Browser Setup (Required — covers all 5 core functions)

```bash
bun run setup-chrome --target weibo    # Launch isolated Chrome (port 9229)
```

Log into weibo.com once in the opened Chrome. Session persists. Never let agent automate login.

### Auto-Sync aione Cookie

Once logged into Chrome, sync cookie to aione for search functionality:

```bash
node scripts/sync-cookies.js sync           # Extract from Chrome, sync to aione web profile
node scripts/sync-cookies.js sync --all     # Sync to web + mobile
node scripts/sync-cookies.js show           # View cookies without syncing
```

Re-run when cookies expire (aione search starts failing).

### LLM Config (For AI comment generation)

Edit `agent/.env`:
```env
LLM_PROVIDER=deepseek
LLM_API_KEY=<your-key>
LLM_MODEL=deepseek-chat
```

---

## 1. Browse & Read

### 1.1 Smart Search (aione)

```bash
# Structured search: returns posts with id + url + content + user
node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1
```

### 1.2 User Info & Content Lists (aione)

```bash
node scripts/weibo-api/weibo-search.js user-info --user-id="<user_id>"
node scripts/weibo-api/weibo-search.js user-posted --user-id="<user_id>" --page=1
node scripts/weibo-api/weibo-search.js user-all-posted --user-url="<user_url>"
```

### 1.3 Single Post Detail (aione — degradation channel)

```bash
node scripts/weibo-api/weibo-search.js work-info --url="<post_url>"
```

### 1.4 Comments via aione (degradation channel)

```bash
node scripts/weibo-api/weibo-search.js word-comments --user-id="<user_id>" --mid="<mid>"
```

### 1.5 Mobile Search & Detail (aione mobile — fallback)

```bash
node scripts/weibo-api/weibo-search.js mobile-search --query="AI" --page=1
node scripts/weibo-api/weibo-search.js mobile-work-info --work-id="<work_id>"
```

### 1.6 Browse Home Feed (Browser)

```bash
agent-browser open https://weibo.com
agent-browser wait 2000
agent-browser snapshot -i -c
```

No API for home timeline — browser is the only option.

---

## 2. Engagement — React to Content

### 2.1 Like a Post (Chrome CDP)

```bash
node scripts/browser-like.js like --id=<MID or base62>
```

Opens post detail page, calls like Ajax API in browser context. Uses browser's own cookie and XSRF token. Accepts numeric MID or base62 ID (auto-converted).

### 2.2 Comment on a Post (Chrome CDP)

```bash
node scripts/browser-comment.js comment --id=<MID or base62> --comment="content"
```

Real human operation flow — opens post page, calls comment Ajax API in browser context. Strongest anti-ban. AI comment generation available via `ai-comment.js`.

**Permission handling**: If author restricted comments, returns `restriction` marker. Workflow executor skips, no retry.

### 2.3 AI Comment Generation

```bash
node scripts/ai-comment.js generate --content="post text" --user="author name"
```

Returns 10-30 char personalized comment. Reads LLM config from `.env`.

---

## 3. Content Creation

### 3.1 Post Weibo (aione, default)

```bash
bun run scripts/workflow-engine.ts run --id weibo-daily-post
```

Posts via aione WeiboCreaterApis (pure HTTP, no browser UI). Supports images: content-pool lines can end with [[img:path1.png,path2.jpg]]. 10-min cooldown after posting to avoid "update weibo too fast".

Direct CLI (bypass workflow, supports images):

`ash
# Text only
python scripts/weibo-post.py --content "content here" --json

# With images
python scripts/weibo-post.py --content "content" --image path/to/a.png --image path/to/b.jpg --json

# Via stdin JSON (avoids shell quoting issues)
echo '{"content":"content","images":["a.png"],"type":0}' | python scripts/weibo-post.py --stdin --json
`

**Fallback (browser)**: scripts/weibo-post-image.mjs drives Chrome CDP to upload images then posts via API. Use only if aione cookie is unavailable. Slower and fragile (React modal issues).

---

## 4. Social Graph

### 4.1 View Any User Profile (aione)

```bash
node scripts/weibo-api/weibo-search.js user-info --user-id="<user_id>"
```

### 4.2 Follow / Unfollow (Browser — no API)

```bash
agent-browser open "https://weibo.com/u/<user_id>"
agent-browser wait 2000
agent-browser snapshot -i -c
agent-browser click <follow_button_ref>
```

### 4.3 View Own Profile (aione)

```bash
aione weibo info self --output json
```

### 4.4 Browse User's Post History (aione)

```bash
node scripts/weibo-api/weibo-search.js user-posted --user-id="<user_id>" --page=1
node scripts/weibo-api/weibo-search.js user-all-posted --user-url="<user_url>"
```

---

## 5. Scheduled Tasks & Workflows

Remaining workflows:

- `weibo-feed-monitor` — keyword search + auto like (browser-like.js) + comment (browser-comment.js), with rate limiting and circuit breaker
- `weibo-daily-post` — daily content posting via aione (pure HTTP)

```bash
bun run scripts/workflow-engine.ts start --id weibo-feed-monitor
bun run scripts/workflow-engine.ts start --id weibo-daily-post
bun run scripts/workflow-engine.ts list
```

---

## Best Practices

1. **Chrome CDP first**: browse, like, comment, follow go through Chrome CDP; posting goes through aione (pure HTTP) for anti-ban
2. **Rate limiting**: single like >= 9s (with jitter), single comment >= 20s (with jitter). Daily cap default 30 likes / 15 comments
3. **Circuit breaker**: if any like or comment returns rate-limit error, executor halts the rest of that run
4. **Post cooldown**: 10-min cooldown after posting; comment executors auto-wait
5. **Cross-session dedup**: use `bun run scripts/log-operation.ts` to avoid repeating actions
6. **Cookie refresh**: re-run `node scripts/sync-cookies.js sync` when aione search fails
7. **Element identification** (browser): never hardcode ref numbers; re-snapshot each time; identify by text/role
