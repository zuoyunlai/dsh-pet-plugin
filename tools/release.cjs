/**
 * 一条命令发版（本机专用：github.com 的 git 协议不通，所以推送走 Data API）。
 *
 * 做四件事：
 *   1. 提交工作区改动，并把版本号从 package.json 读出来
 *   2. 调 tools/push-via-api.cjs 推到 GitHub（增量）
 *   3. 在远端打 tag 并建 Release（notes 取 .github/release-notes/v<版本>.md）
 *   4. npm publish 到官方源
 *
 * 用法：
 *   node tools/release.cjs              # 用 package.json 里的版本
 *   node tools/release.cjs --dry-run    # 只打印将要做什么
 *
 * 要求：gh 已登录（repo scope）、npm 已登录（registry.npmjs.org）。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

const dry = process.argv.includes('--dry-run')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = 'v' + version
const REPO = 'zuoyunlai/dsh-pet-plugin'

function sh(cmd, args, opts = {}) {
  if (dry) {
    console.log('[dry]', cmd, args.join(' '))
    return ''
  }
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

function api(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json']
  if (body !== undefined) args.push('--input', '-')
  if (dry) {
    console.log('[dry] gh', args.join(' '))
    return {}
  }
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined }))
}

console.log(`release ${pkg.name}@${version} (${tag})`)

// 1) 提交
const dirty = sh('git', ['status', '--porcelain']).trim()
if (dirty) {
  sh('git', ['add', '-A'])
  sh('git', ['-c', 'user.name=zuoyunlai', '-c', 'user.email=zuoyunlai@users.noreply.github.com', 'commit', '-m', `chore(release): ${tag}`])
  console.log('committed working tree')
} else {
  console.log('working tree clean')
}

// 2) 推到 GitHub
sh('node', ['tools/push-via-api.cjs', REPO, 'main'])
const head = dry ? 'HEAD' : api('GET', `repos/${REPO}/git/ref/heads/main`).object.sha
console.log('remote head:', head)

// 3) tag + release
try {
  api('POST', `repos/${REPO}/git/refs`, { ref: `refs/tags/${tag}`, sha: head })
  console.log('tag created:', tag)
} catch (e) {
  console.log('tag already exists (ok):', tag)
}
const notesPath = `.github/release-notes/${tag}.md`
const body = fs.existsSync(notesPath)
  ? fs.readFileSync(notesPath, 'utf8')
  : `## ${pkg.name} ${version}\n\nSee [CHANGELOG.md](https://github.com/${REPO}/blob/main/CHANGELOG.md).\n`
try {
  const rel = api('POST', `repos/${REPO}/releases`, {
    tag_name: tag,
    name: `${pkg.name} ${version}`,
    body,
    draft: false,
    prerelease: false,
  })
  console.log('release:', rel.html_url || '(dry)')
} catch (e) {
  console.log('release may already exist (ok):', String(e.message || e).slice(0, 120))
}

// 4) npm
sh('npm', ['publish', '--registry=https://registry.npmjs.org/'], { stdio: dry ? 'inherit' : 'pipe' })
console.log(dry ? '[dry] npm publish skipped' : 'published to npm')
console.log('done.')
