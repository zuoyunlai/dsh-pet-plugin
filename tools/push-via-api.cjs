/**
 * 走 GitHub Data API 推送（本机直连 github.com 超时，api.github.com 正常）。
 *
 * 1.19.3 起按「计划 → 执行」两步（审计 R05）：
 *   - **默认只读**：打印将要上传/删除的文件，不做任何写操作；`--apply` 才推。
 *   - tree 带 `base_tree = 远端当前 tree`：**远端独有文件默认保留**。
 *     只有显式 `--prune` 才会把「远端有、本地没有」的文件删掉（并逐个打印）。
 *   - ref 更新**不带 force**：head 在提交期间被移动就中止，不覆盖别人的提交。
 *   - 仓库根 / remote 一致性先校验，避免在错的目录里推错仓库。
 *
 * 用法：
 *   node tools/push-via-api.cjs [owner/repo] [branch] [--apply] [--prune]
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

const raw = process.argv.slice(2)
const flags = raw.filter((a) => a.startsWith('--'))
const pos = raw.filter((a) => !a.startsWith('--'))
const REPO = pos[0] || 'zuoyunlai/dsh-pet-plugin'
const BRANCH = pos[1] || 'main'
const apply = flags.includes('--apply')
const prune = flags.includes('--prune')

function read(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

/**
 * GitHub API 传输层。默认走 `gh api`；`DSH_PUSH_API_TRANSPORT` 指向一个
 * CommonJS 模块（导出 `api(method, path, body)`）时改走它——只用于端到端测试
 * （tests/push-api.test.mjs 用内存版 GitHub 验证 base_tree / prune / head 复核），
 * 生产环境不要设置这个变量。
 */
const TRANSPORT = process.env.DSH_PUSH_API_TRANSPORT
const transportApi = TRANSPORT ? require(TRANSPORT).api : null

function api(method, path, body) {
  if (transportApi) return transportApi(method, path, body)
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json']
  if (body !== undefined) args.push('--input', '-')
  return JSON.parse(read('gh', args, { input: body === undefined ? undefined : JSON.stringify(body) }))
}

/* ---------- 1) 目录与 remote 校验 ---------- */

const top = read('git', ['rev-parse', '--show-toplevel']).trim().replace(/\\/g, '/')
const cwd = process.cwd().replace(/\\/g, '/')
if (top.toLowerCase() !== cwd.toLowerCase()) {
  throw new Error('必须在仓库根目录运行：cwd=' + cwd + ' toplevel=' + top)
}
let remoteUrl = ''
try {
  remoteUrl = read('git', ['config', '--get', 'remote.origin.url']).trim()
} catch (e) {
  remoteUrl = ''
}
if (remoteUrl) {
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl)
  const remoteRepo = m ? m[1] + '/' + m[2] : ''
  if (remoteRepo && remoteRepo.toLowerCase() !== REPO.toLowerCase()) {
    throw new Error('remote 与目标仓库不一致：remote=' + remoteRepo + ' 目标=' + REPO)
  }
}

/* ---------- 2) 远端现状 ---------- */

const files = read('git', ['ls-files'])
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

let parent = null
let baseTree = null
const remoteTree = {}
try {
  const ref = api('GET', `repos/${REPO}/git/ref/heads/${BRANCH}`)
  parent = ref.object.sha
  const commit = api('GET', `repos/${REPO}/git/commits/${parent}`)
  baseTree = commit.tree && commit.tree.sha
  const t = api('GET', `repos/${REPO}/git/trees/${parent}?recursive=1`)
  for (const e of t.tree || []) if (e.type === 'blob') remoteTree[e.path] = e.sha
} catch (e) {
  // 分支还不存在：第一次推送
  parent = null
  baseTree = null
}

/* ---------- 3) 本地 blob 与差异 ---------- */

// 一次算完全部 sha（等价于逐文件 git hash-object，但只起一个进程）。
// 写入模式下加 -w：把「按 .gitattributes 归一化后」的 blob 真正写进对象库，
// 上传时才能用 `git cat-file blob <sha>` 取到与比较同源的内容（计划模式不写对象库）。
const hashArgs = ['hash-object', '--stdin-paths']
if (apply) hashArgs.splice(1, 0, '-w')
const shas = read('git', hashArgs, { input: files.join('\n') + '\n' })
  .split('\n')
  .map((l) => l.trim())

const adds = []
const unchanged = []
const deletions = []
for (let i = 0; i < files.length; i++) {
  const p = files[i].replace(/\\/g, '/')
  const sha = shas[i]
  if (remoteTree[p] === sha) unchanged.push(p)
  else adds.push({ path: p, sha })
}
for (const p of Object.keys(remoteTree)) {
  if (!files.some((f) => f.replace(/\\/g, '/') === p)) deletions.push(p)
}

console.log(
  `repo=${REPO} branch=${BRANCH} files=${files.length} changed=${adds.length} ` +
    `unchanged=${unchanged.length} remoteOnly=${deletions.length}`,
)
if (deletions.length) {
  console.log(
    prune
      ? '  将删除（--prune）：'
      : '  远端独有、默认保留（加 --prune 才删）：',
  )
  for (const p of deletions.slice(0, 30)) console.log('    ' + (prune ? '- ' : '+ ') + p)
  if (deletions.length > 30) console.log('    … 以及 ' + (deletions.length - 30) + ' 个')
}

if (!apply) {
  console.log('计划模式（默认只读）：确认无误后加 --apply 推送。')
  process.exit(0)
}
if (!adds.length && !(prune && deletions.length) && parent) {
  console.log('没有需要推送的改动。')
  process.exit(0)
}

/* ---------- 4) 上传 + 建 tree / commit / ref ---------- */

const tree = []
let uploaded = 0
for (const a of adds) {
  // 上传「git 会存的那份内容」，而不是工作树的原始字节：
  // 上面比较用的是 hash-object（按 .gitattributes 归一化后）的 sha，两者必须同源，
  // 否则工作树里 CRLF 的文件会被判成「每次都变了」并且永远推不干净（真实推送时实测到）。
  const content = read('git', ['cat-file', 'blob', a.sha])
  const blob = api('POST', `repos/${REPO}/git/blobs`, {
    content: Buffer.from(content, 'utf8').toString('base64'),
    encoding: 'base64',
  })
  tree.push({ path: a.path, mode: '100644', type: 'blob', sha: blob.sha })
  uploaded++
  if (uploaded % 10 === 0) console.log('  uploaded', uploaded)
}
if (prune) {
  for (const p of deletions) tree.push({ path: p, mode: '100644', type: 'blob', sha: null })
}
console.log(`uploaded ${uploaded} blob(s), deleted ${prune ? deletions.length : 0}`)

const treeBody = { tree }
if (baseTree) treeBody.base_tree = baseTree
const treeRes = api('POST', `repos/${REPO}/git/trees`, treeBody)

const message = read('git', ['log', '-1', '--pretty=%B']).trim()
const commit = api('POST', `repos/${REPO}/git/commits`, {
  message,
  tree: treeRes.sha,
  ...(parent ? { parents: [parent] } : {}),
})
console.log('commit:', commit.sha)

if (parent) {
  // 提交期间远端被别人推过就中止（不带 force，不覆盖别人的提交）
  const nowRef = api('GET', `repos/${REPO}/git/ref/heads/${BRANCH}`)
  if (nowRef.object.sha !== parent) {
    throw new Error(
      `远端 ${BRANCH} 在推送期间被移动：${parent} -> ${nowRef.object.sha}；` +
        '已中止（未覆盖）。重新拉取后再推。',
    )
  }
  api('PATCH', `repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha })
} else {
  api('POST', `repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha })
}

console.log('done -> https://github.com/' + REPO + '/tree/' + BRANCH)
