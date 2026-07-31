#!/usr/bin/env bun
/**
 * Weibo Daily Post Workflow Executor
 *
 * Reads the content pool, picks a post by category weight, appends hashtags,
 * publishes via aione CLI, and logs the operation for dedup.
 * 发帖后写入冷却标记，评论执行器读取后自动等待，避免「发帖后快速评论」触发账号级风控。
 *
 * Run: bun run workflow run --id weibo-daily-post
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const LOG_SCRIPT = resolve(ROOT, 'scripts', 'log-operation.ts')

// 发帖冷却标记文件：评论执行器读取后自动等待，避免 update weibo too fast
const POST_COOLDOWN_FILE = join(homedir(), '.weibo-skill', 'post-cooldown.json')
const POST_COOLDOWN_MS = 10 * 60 * 1000 // 10 分钟账号级冷却

// ── Config from workflow-engine ──────────────────────────────────────────────

interface Config {
  hashtags?: string[]
  contentPool?: string
  maxPostsPerDay?: number
  account?: string
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === '--config')
const config: Config = configArg ? JSON.parse(configArg) : {}
const hashtags = config.hashtags ?? ['#技术分享#', '#AI#']
const poolPath = resolve(ROOT, config.contentPool ?? './persona/content-pool.md')

// ── Content pool parser ──────────────────────────────────────────────────────

function pickContentFromPool(): string {
  if (!existsSync(poolPath)) {
    return `今天分享一个有趣的AI技术话题 ${hashtags.join(' ')}`
  }
  const text = readFileSync(poolPath, 'utf-8')
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') && !l.includes('[内容待补充]') && !l.includes('[链接]') && !l.includes('[项目名]'))
    .map(l => l.slice(2).trim())
    .filter(l => l.length > 5)
  if (lines.length === 0) {
    return `今天分享一个有趣的AI技术话题 ${hashtags.join(' ')}`
  }
  const picked = lines[Math.floor(Math.random() * lines.length)]
  return picked.replace(/\[.+?\]/g, '').trim()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function postWeibo(content: string): { url?: string; id?: string } {
  const noteInfo = JSON.stringify({ content })
  const out = execSync(`aione weibo weibo post --note-info '${noteInfo}' --output json`, {
    encoding: 'utf-8',
    timeout: 30000,
  })
  try {
    return JSON.parse(out)
  } catch {
    return {}
  }
}

/** 写入「刚发帖」冷却标记，评论执行器读取后自动等待 */
function writePostCooldown(postUrl: string) {
  try {
    mkdirSync(dirname(POST_COOLDOWN_FILE), { recursive: true })
    writeFileSync(POST_COOLDOWN_FILE, JSON.stringify({ ts: Date.now(), url: postUrl }), 'utf-8')
  } catch {
    // best-effort
  }
}

/** 读取「刚发帖」冷却标记，返回剩余冷却毫秒数（0 = 已过冷却期） */
export function getPostCooldownRemaining(): number {
  try {
    const data = JSON.parse(readFileSync(POST_COOLDOWN_FILE, 'utf-8'))
    const elapsed = Date.now() - data.ts
    return Math.max(0, POST_COOLDOWN_MS - elapsed)
  } catch {
    return 0
  }
}

function logOperation(action: string, url: string, status: string, note?: string) {
  const args = [
    'bun', 'run', LOG_SCRIPT, 'add',
    '--platform', 'weibo',
    '--action', action,
    '--url', url,
    '--status', status,
  ]
  if (note) args.push('--note', note)
  try {
    execSync(args.join(' '), { encoding: 'utf-8', timeout: 5000 })
  } catch {
    // logging is best-effort
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[Weibo Daily Post] Starting...')

  // Pick content from pool
  const body = pickContentFromPool()
  const content = `${body} ${hashtags.join(' ')}`
  console.log(`  Content: ${content.slice(0, 80)}...`)

  try {
    const result = postWeibo(content)
    const url = result.url ?? `weibo://post/${result.id ?? Date.now()}`
    console.log(`  Posted successfully: ${url}`)
    logOperation('post', url, 'success', content.slice(0, 100))
    // 写入冷却标记，评论执行器会读取并等待 10 分钟
    writePostCooldown(url)
    console.log('  Post cooldown marker set (10 min for comment safety)')
  } catch (error) {
    console.error(`  Post failed: ${error}`)
    logOperation('post', '', 'failed', String(error).slice(0, 200))
    process.exit(1)
  }

  console.log('[Weibo Daily Post] Complete.')
}

main()