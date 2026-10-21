/**
 * 一条命令发版（本机专用：github.com 的 git 协议不通，所以推送走 Data API）。
 *
 * 做四件事：
 *   1. 提交工作区改动（版本号取 package.json）
 *   2. 调 tools/push-via-api.cjs 推到 GitHub（增量）
 *   3. 在远端打 tag 并建 Release —— 发布说明优先用手写稿
 *      `.github/release-notes/v<版本>.md`，没有就从 CHANGELOG.md 抽当前版本那一节
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
const printIdx = process.argv.indexOf('--print-notes')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = 'v' + version
const REPO = 'zuoyunlai/dsh-pet-plugin'
const CHANGELOG_URL = 'https://github.com/' + REPO + '/blob/main/CHANGELOG.md'
const FENCE = '```'

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
  return JSON.parse(
    execFileSync('gh', args, {
      encoding: 'utf8',
      input: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

/** 从 CHANGELOG.md 抽出「## <version>」这一节（到下一个二级标题为止）。 */
function changelogSection(v) {
  try {
    const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)
    const esc = v.replace(/\./g, '\\.')
    const re = new RegExp('^##\\s+' + esc + '(\\s|$)')
    const start = lines.findIndex((l) => re.test(l))
    if (start < 0) return ''
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i
        break
      }
    }
    return lines.slice(start + 1, end).join('\n').trim()
  } catch (e) {
    return ''
  }
}

/** 发布说明：手写稿优先，否则从 CHANGELOG 生成，末尾补安装命令与链接。 */
function releaseBody() {
  const notesPath = '.github/release-notes/' + tag + '.md'
  if (fs.existsSync(notesPath)) {
    console.log('notes: using', notesPath)
    return fs.readFileSync(notesPath, 'utf8')
  }
  const section = changelogSection(version)
  console.log(
    'notes: generated from CHANGELOG.md' + (section ? '' : ' (no section for ' + version + ')'),
  )
  return [
    '## ' + pkg.name + ' ' + version,
    '',
    section || '_See CHANGELOG.md._',
    '',
    '### Install',
    FENCE + 'bash',
    'dsh plugin --profile desktop add ' + pkg.name + '@' + version,
    FENCE,
    '',
    'Full changelog: ' + CHANGELOG_URL,
  ].join('\n')
}

// --print-notes [version]：只打印将要写进 Release 的正文（用于检查生成效果）
if (printIdx >= 0) {
  const v = process.argv[printIdx + 1] || version
  const saved = version
  console.log('--- notes for ' + v + ' ---')
  console.log(changelogSection(v) || '(CHANGELOG 里没有这一节)')
  process.exit(0)
}

console.log('release ' + pkg.name + '@' + version + ' (' + tag + ')')

// 1) 提交
const dirty = sh('git', ['status', '--porcelain']).trim()
if (dirty) {
  sh('git', ['add', '-A'])
  sh('git', [
    '-c',
    'user.name=zuoyunlai',
    '-c',
    'user.email=zuoyunlai@users.noreply.github.com',
    'commit',
    '-m',
    'chore(release): ' + tag,
  ])
  console.log('committed working tree')
} else {
  console.log('working tree clean')
}

// 2) 推到 GitHub
sh('node', ['tools/push-via-api.cjs', REPO, 'main'])
const head = dry ? 'HEAD' : api('GET', 'repos/' + REPO + '/git/ref/heads/main').object.sha
console.log('remote head:', head)

// 3) tag + release
try {
  api('POST', 'repos/' + REPO + '/git/refs', { ref: 'refs/tags/' + tag, sha: head })
  console.log('tag created:', tag)
} catch (e) {
  console.log('tag already exists (ok):', tag)
}
const body = releaseBody()
try {
  const rel = api('POST', 'repos/' + REPO + '/releases', {
    tag_name: tag,
    name: pkg.name + ' ' + version,
    body,
    draft: false,
    prerelease: false,
  })
  console.log('release:', rel.html_url || '(dry)')
} catch (e) {
  console.log('release may already exist (ok):', String(e.message || e).slice(0, 120))
}

// 4) npm
if (dry) console.log('[dry] npm publish --registry=https://registry.npmjs.org/')
else {
  // Windows 上 npm 是 npm.cmd，execFile 直接 spawn 会 ENOENT
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npmBin, ['publish', '--registry=https://registry.npmjs.org/'], { stdio: 'inherit' })
  console.log('published to npm')
}
console.log('done.')
