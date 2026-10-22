/**
 * 把重渲染后的 7 个文件推到 PR 分支，并把分支重建在**上游 main 的最新提交**之上，
 * 这样 GitHub 会把它算成"领先 main 一步"，冲突消失。
 *
 * 用法：node tools/rebase-pr-branch.cjs <contentDir> <fork owner> <branch>
 */
const { execFileSync } = require('node:child_process')
const fs = require('fs')
const path = require('path')

const contentDir = process.argv[2]
const fork = process.argv[3]
const branch = process.argv[4]
const UPSTREAM = 'dshworks/awesome-dsh-plugins'
// 写操作（blob/tree/commit/ref）只能落在自己的 fork；上游只用来读 main 的
// 引用与树——fork 与上游共享对象库，所以能直接引用上游的 tree/commit SHA。
const FORK_REPO = `${fork}/awesome-dsh-plugins`

const FILES = [
  'README.md',
  'data/plugins.json',
  'docs/index.html',
  'docs/plugins-embed.js',
  'docs/plugins.json',
  'docs/stats.json',
  'lists/fun.md',
]

function gh(args, input) {
  const opts = { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  if (input !== undefined) opts.input = JSON.stringify(input)
  return execFileSync('gh', args, opts).trim()
}

// 1. 上游 main 的头
const mainRef = JSON.parse(gh(['api', `repos/${UPSTREAM}/git/ref/heads/main`]))
const mainSha = mainRef.object.sha
const mainCommit = JSON.parse(gh(['api', `repos/${UPSTREAM}/git/commits/${mainSha}`]))
console.log('upstream main:', mainSha.slice(0, 12), 'tree', mainCommit.tree.sha.slice(0, 12))

// 2. 为每个文件建 blob（内容来自重渲染后的目录）
const treeEntries = []
for (const rel of FILES) {
  const full = path.join(contentDir, rel)
  const content = fs.readFileSync(full)
  const b64 = content.toString('base64')
  const blob = JSON.parse(
    gh(['api', '-X', 'POST', `repos/${FORK_REPO}/git/blobs`, '--input', '-'], {
      content: b64,
      encoding: 'base64',
    }),
  )
  treeEntries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha })
  console.log('blob', rel, blob.sha.slice(0, 10), content.length, 'bytes')
}

// 3. 以上游 main 的树为底，套上这 7 个文件
const tree = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${FORK_REPO}/git/trees`, '--input', '-'], {
    base_tree: mainCommit.tree.sha,
    tree: treeEntries,
  }),
)
console.log('new tree:', tree.sha.slice(0, 12))

// 4. 提交，父提交 = 上游 main（线性领先，不再是分叉）
const msg =
  'Add dsh-pet-plugin (zuoyunlai)\n\n' +
  'Photo-real desk pet for the DSH window, with 24fps alpha-video actions.\n' +
  'Rebased onto the current main and re-rendered so the generated artifacts\n' +
  'match; description trimmed to the 200-char limit validate.mjs enforces.\n'
const commit = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${FORK_REPO}/git/commits`, '--input', '-'], {
    message: msg,
    tree: tree.sha,
    parents: [mainSha],
  }),
)
console.log('new commit:', commit.sha)

// 5. 更新 fork 上的分支
const refPath = `repos/${fork}/${UPSTREAM.split('/')[1]}/git/refs/heads/${branch}`
try {
  gh(['api', '-X', 'PATCH', refPath, '--input', '-'], { sha: commit.sha, force: true })
  console.log('branch updated (force):', refPath)
} catch (e) {
  // 分支不存在就创建
  gh(['api', '-X', 'POST', `repos/${fork}/${UPSTREAM.split('/')[1]}/git/refs`, '--input', '-'], {
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  })
  console.log('branch created:', refPath)
}
