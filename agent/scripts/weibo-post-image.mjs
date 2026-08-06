#!/usr/bin/env node
/**
 * weibo-post-image.mjs - 带图发微博
 *
 * 流程: agent-browser 驱动 UI 上传图片拿 pid -> fetch /ajax/statuses/update 发图帖
 * 绕开「添加图片」模态的二次确认问题: 拿到 pid 后走纯 API 发帖, 不依赖模态关闭。
 *
 * 为什么不能纯 API 上传: picupload 接口的 cs 参数是每次请求动态生成的会话签名,
 *   手搓会 errno:-2; 只能复用微博前端自己的上传逻辑 (UI upload 触发)。
 *
 * 关键坑: 微博发帖框默认懒渲染, 必须先 fill 文本激活 React (form 获得 focus 类),
 *   此后 file input 才处于可用态, upload 才能触发真实上传拿 pid。
 *
 * 用法:
 *   node scripts/weibo-post-image.mjs --content "内容" --image a.png [--image b.jpg] [--visible 0] [--no-open] [--json]
 *
 * 输出 (--json): { code, url, id, mblogid, pids }
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

// ── 参数 ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { image: [], content: '', visible: '0', json: false, open: true }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--image') { a.image.push(argv[++i]); continue }
    if (k === '--content') { a.content = argv[++i]; continue }
    if (k === '--visible') { a.visible = argv[++i]; continue }
    if (k === '--json') { a.json = true; continue }
    if (k === '--no-open') { a.open = false; continue }
  }
  return a
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.heic': 'image/heic', '.webp': 'image/webp',
}

// ── agent-browser 封装 ────────────────────────────────────────
// 用 execSync 传整条命令字符串, 手动给含特殊字符的参数加双引号, 避免 cmd 解析 []= 等。
function q(s) { return '"' + String(s).replace(/"/g, '\\"') + '"' }
function ab(cmd, timeout = 30000) {
  return execSync('agent-browser ' + cmd, { encoding: 'utf-8', timeout }).trim()
}
function abEval(js, timeout = 15000) {
  const b64 = Buffer.from(js, 'utf8').toString('base64')
  const out = execSync('agent-browser eval "eval(atob(\'' + b64 + '\'))"', { encoding: 'utf-8', timeout }).trim()
  return out.replace(/^"|"$/g, '')
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 从 accessibility snapshot 文本里提取含 label 的节点 ref, 返回 @eXX 形式。
function refOf(label) {
  const snap = ab('snapshot -i -c')
  const re = new RegExp(label + '[^\\n]*?\\[ref=(e\\d+)\\]')
  const m = snap.match(re)
  return m ? '@' + m[1] : null
}

// ── hook: 抓 picupload 响应拿 pid ─────────────────────────────
const HOOK = `window.__cap=[];const _f=window.fetch;window.fetch=function(u,o){const url=typeof u==='string'?u:u.url;const m=(o&&o.method)||'GET';return _f.apply(this,arguments).then(r=>{r.clone().text().then(t=>window.__cap.push({url,method:m,status:r.status,resp:t.slice(0,400)})).catch(()=>{});return r;})};const _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){this.__u=u;this.__m=m;_o.apply(this,arguments);this.addEventListener('loadend',()=>window.__cap.push({url:this.__u,method:this.__m,status:this.status,resp:(this.responseText||'').slice(0,400)}))};'hooked'`

// ── 上传单个文件拿 pid ────────────────────────────────────────
async function uploadAndGetPid(imagePath) {
  const before = parseInt(abEval('String(window.__cap.length)'), 10) || 0
  ab('upload ' + q('input[type=file]') + ' ' + q(imagePath))
  for (let i = 0; i < 30; i++) {
    await wait(500)
    const probe = `(()=>{const s=${before};const hits=(window.__cap||[]).slice(s).filter(c=>/picupload/.test(c.url)&&/"ret":true/.test(c.resp));if(!hits.length)return null;try{return JSON.parse(hits[hits.length-1].resp).pic.pid}catch(e){return null}})()`
    const r = abEval(probe)
    if (r && r !== 'null' && r !== '') return r
  }
  throw new Error('upload timeout: no pid from picupload for ' + imagePath)
}

// ── 发帖 (固定模板, 用户内容走 window.__arg) ──────────────────
const POST_JS = `window.__postRes=null;(async()=>{
  const a=window.__arg;
  const xsrf=(document.cookie.match(/XSRF-TOKEN=([^;]+)/)||["",""])[1];
  const form=new URLSearchParams();
  form.append("content",a.content);
  form.append("visible",a.visible);
  form.append("pic_id",JSON.stringify(a.picArr));
  form.append("attachment","");
  form.append("vote","");
  form.append("media","");
  const r=await fetch("/ajax/statuses/update",{method:"POST",headers:{"X-XSRF-TOKEN":xsrf,"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},body:form.toString()});
  const j=await r.json().catch(()=>({}));
  window.__postRes=JSON.stringify({status:r.status,ok:r.ok,data:j});
})();
'started'`

async function postWithPids(content, pids, visible) {
  const picArr = pids.map((p) => ({ type: p.mime, pid: p.pid }))
  abEval(`window.__arg=${JSON.stringify({ content, picArr, visible })}`)
  abEval(POST_JS)
  await wait(4000)
  const res = abEval('window.__postRes')
  return JSON.parse(res)
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv)
  if (!args.content) { console.error('missing --content'); process.exit(1) }
  for (const p of args.image) {
    if (!existsSync(p)) { console.error('image not found: ' + p); process.exit(1) }
  }

  // 1. 打开 weibo 首页
  if (args.open) { ab('open ' + q('https://weibo.com')); await wait(3000) }

  // 2. 注入 hook (抓上传响应)
  abEval(HOOK)

  // 3. 激活发帖框: fill 一个空格触发 React, 使 form 获得 focus 类、file input 进入可用态。
  const tbRef = refOf('有什么新鲜事')
  if (!tbRef) throw new Error('textbox not found on page')
  ab('fill ' + q(tbRef) + ' ' + q(' '))
  await wait(1200)

  // 4. 点图片按钮, 确保 file input 挂载在激活态下。
  const picRef = refOf('图片')
  if (picRef) { ab('click ' + q(picRef)); await wait(1500) }
  const hasInput = abEval(`document.querySelector('input[type=file]')?'yes':'no'`)
  if (hasInput !== 'yes') throw new Error('file input not mounted after activating post box')

  // 5. 逐张上传拿 pid (每次只 upload 一次, 不重复)
  const pids = []
  for (const img of args.image) {
    const ext = extname(img).toLowerCase()
    const mime = MIME[ext] || 'image/jpeg'
    const pid = await uploadAndGetPid(img.replace(/\\/g, '/'))
    pids.push({ pid, mime })
    console.error('uploaded ' + img + ' -> ' + pid)
    await wait(500)
  }

  // 6. 带 pid 纯 API 发帖 (不点 UI 发送按钮, 模态挂着也无所谓)
  const res = await postWithPids(args.content, pids, args.visible)
  const d = res.data && res.data.data
  const uid = d && d.user && d.user.idstr
  const mblogid = d && d.mblogid
  const id = d && d.idstr
  const url = uid && mblogid ? `https://weibo.com/${uid}/${mblogid}` : null
  const ok = res.ok && res.data && res.data.ok === 1
  const out = { code: ok ? 0 : -1, url, id, mblogid, pids: pids.map((p) => p.pid) }

  if (args.json) {
    console.log(JSON.stringify(out))
  } else if (ok) {
    console.log('posted: ' + url)
  } else {
    console.error('failed: ' + JSON.stringify(res))
    process.exit(1)
  }
}

main().catch((e) => { console.error('error: ' + e.message); process.exit(1) })