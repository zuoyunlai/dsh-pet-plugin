/**
 * 走 GitHub Data API 推送（本机直连 github.com 超时，api.github.com 正常）。
 *
 * 增量策略：先取远端 tree，用 `git hash-object` 算本地每个文件的 blob sha，
 * 一样的直接复用，只上传变化的部分；tree 不带 base_tree（= 完全等于本地清单，
 * 所以删掉的文件也会跟着消失）。然后 commit（parent = 远端 head）→ force 更新 ref。
 *
 * 用法：node tools/push-via-api.cjs [owner/repo] [branch]
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

const REPO = process.argv[2] || 'zuoyunlai/dsh-pet-plugin'
const BRANCH = process.argv[3] || 'main'

function api(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json']
  const opts = { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }
  if (body !== undefined) {
    args.push('--input', '-')
    opts.input = JSON.stringify(body)
  }
  return JSON.parse(execFileSync('gh', args, opts))
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

// 远端现状：head commit + tree（用来跳过没变的 blob）
let parent = null
const remoteTree = {}
try {
  const ref = api('GET', `repos/${REPO}/git/ref/heads/${BRANCH}`)
  parent = ref.object.sha
  const t = api('GET', `repos/${REPO}/git/trees/${ref.object.sha}?recursive=1`)
  for (const e of t.tree || []) if (e.type === 'blob') remoteTree[e.path] = e.sha
} catch (e) {
  parent = null
}

const tree = []
let uploaded = 0
let reused = 0
for (const f of files) {
  const p = f.replace(/\\/g, '/')
  const localSha = execFileSync('git', ['hash-object', f], { encoding: 'utf8' }).trim()
  if (remoteTree[p] === localSha) {
    tree.push({ path: p, mode: '100644', type: 'blob', sha: localSha })
    reused++
    continue
  }
  const blob = api('POST', `repos/${REPO}/git/blobs`, {
    content: fs.readFileSync(f).toString('base64'),
    encoding: 'base64',
  })
  tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha })
  uploaded++
  if (uploaded % 10 === 0) console.log('  uploaded', uploaded)
}

console.log(`files=${files.length} uploaded=${uploaded} reused=${reused}`)

const treeRes = api('POST', `repos/${REPO}/git/trees`, { tree })
const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim()
const commit = api('POST', `repos/${REPO}/git/commits`, {
  message,
  tree: treeRes.sha,
  ...(parent ? { parents: [parent] } : {}),
})
console.log('commit:', commit.sha)

if (parent) api('PATCH', `repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true })
else api('POST', `repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha })

console.log('done -> https://github.com/' + REPO + '/tree/' + BRANCH)
