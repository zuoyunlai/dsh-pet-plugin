// 在 PR 分支上推一个空提交，触发 pr-check → Submission gate 重新评估
// 用法：node tools/push-empty-commit.cjs <owner/repo> <branch> <message> [baseCommitSha]
const { execFileSync } = require('node:child_process')

const repo = process.argv[2]
const branch = process.argv[3]
const message = process.argv[4] || 'chore: re-run submission gate'
const baseSha = process.argv[5] || null

function gh(args, input) {
  const opts = { encoding: 'utf8' }
  if (input !== undefined) opts.input = JSON.stringify(input)
  return execFileSync('gh', args, opts).trim()
}

// 当前分支头
const refPath = `repos/${repo}/git/ref/heads/${branch}`
const ref = JSON.parse(gh(['api', refPath]))
const headSha = baseSha || ref.object.sha
console.log('branch head:', headSha)

const headCommit = JSON.parse(gh(['api', `repos/${repo}/git/commits/${headSha}`]))
const treeSha = headCommit.tree.sha
console.log('tree:', treeSha)

// 空提交：同树 + 父提交是当前头
const body = { message, tree: treeSha, parents: [headSha] }
const created = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${repo}/git/commits`, '--input', '-'], body),
)
console.log('new commit:', created.sha)

gh(['api', '-X', 'PATCH', refPath, '--input', '-'], { sha: created.sha, force: false })
console.log('branch updated; workflows should start now')
