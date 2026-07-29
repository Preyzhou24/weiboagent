#!/usr/bin/env bun
/**
 * Weibo Daily Post Workflow Executor
 *
 * Reads the content pool, picks a post by category weight, appends hashtags,
 * publishes via aione CLI, and logs the operation for dedup.
 *
 * Run: bun run workflow run --id weibo-daily-post
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const LOG_SCRIPT = resolve(ROOT, 'scripts', 'log-operation.ts')

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
  // Collect all bullet lines ("- ...") that have real content
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
  // Strip trailing placeholder brackets
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
  } catch (error) {
    console.error(`  Post failed: ${error}`)
    logOperation('post', '', 'failed', String(error).slice(0, 200))
    process.exit(1)
  }

  console.log('[Weibo Daily Post] Complete.')
}

main()
