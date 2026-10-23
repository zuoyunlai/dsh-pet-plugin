/**
 * 一条命令发版（本机专用：github.com 的 git 协议不通，所以推送走 Data API）。
 *
 * 1.19.3 起按「计划 → 确认 → 执行」三步走（审计 R04/R19）：
 *   - **默认只读**：不提交、不推送、不打 tag、不建 Release、不碰 npm；
 *   - `--apply` 才真的执行，执行前打印完整计划并要求输入 y（`--yes` 跳过）；
 *   - 仓库 / 分支 / 测试三道校验都在**任何副作用之前**完成；
 *   - npm 发布放在 Release 之前：本机发过版才建正式 Release，否则建 **draft**
 *     （tag 推上去由 CI 发 npm；CI 成功后跑 `--promote` 把 draft 转正）。
 *
 * 用法：
 *   node tools/release.cjs                     # 只打印计划（默认）
 *   node tools/release.cjs --apply             # 执行（会二次确认）
 *   node tools/release.cjs --apply --publish   # 本机 npm 发布（CI 不再发）
 *   node tools/release.cjs --apply --commit    # 允许把未提交改动一并提交
 *   node tools/release.cjs --promote           # 把 draft Release 转正
 *   node tools/release.cjs --dry-run           # 同默认（兼容旧参数）
 *   node tools/release.cjs --print-notes [ver] # 只打印 Release 正文
 *
 * 要求：gh 已登录（repo scope）、npm 已登录（--publish 时）。
 */
const { execFileSync, execSync } = require('node:child_process')
const fs = require('node:fs')

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const dry = !apply || argv.includes('--dry-run')
const shouldPublish = argv.includes('--publish')
const autoYes = argv.includes('--yes')
const allowCommit = argv.includes('--commit')
const includeUntracked = argv.includes('--include-untracked')
const promote = argv.includes('--promote')
const printIdx = argv.indexOf('--print-notes')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = 'v' + version
const REPO = 'zuoyunlai/dsh-pet-plugin'
const BRANCH = 'main'
const CHANGELOG_URL = 'https://github.com/' + REPO + '/blob/main/CHANGELOG.md'
const FENCE = '```'

/** 同步 sleep（脚本是同步流程，不想为此改成 async）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/* ---------------- 只读 / 变更 两类命令分开：计划阶段不可能误伤 ---------------- */

function read(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

function mutate(cmd, args, opts = {}) {
  if (dry) {
    console.log('  [plan]', cmd, args.join(' '))
    return ''
  }
  return read(cmd, args, opts)
}

function api(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json']
  if (body !== undefined) args.push('--input', '-')
  return JSON.parse(read('gh', args, { input: body === undefined ? undefined : JSON.stringify(body) }))
}

function apiMutate(method, path, body, label) {
  if (dry) {
    console.log('  [plan] gh', method, path, label ? '(' + label + ')' : '')
    return {}
  }
  try {
    return api(method, path, body)
  } catch (e) {
    // 只有「已经存在」可以吞掉；网络错误/权限错误必须冒泡（审计 R04）
    const msg = String((e && (e.stderr || e.message)) || e)
    if (/already exists|Protected branch|Reference already exists|Validation Failed/i.test(msg) && /422/.test(msg)) {
      console.log('  [skip] ' + label + ' 已存在')
      return { __existed: true }
    }
    throw e
  }
}

/* ---------------- 发布说明 ---------------- */

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

function releaseBody() {
  const notesPath = '.github/release-notes/' + tag + '.md'
  if (fs.existsSync(notesPath)) {
    console.log('notes: using', notesPath)
    return fs.readFileSync(notesPath, 'utf8')
  }
  const section = changelogSection(version)
  console.log('notes: generated from CHANGELOG.md' + (section ? '' : ' (no section for ' + version + ')'))
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

if (printIdx >= 0) {
  const v = argv[printIdx + 1] || version
  console.log('--- notes for ' + v + ' ---')
  console.log(changelogSection(v) || '(CHANGELOG 里没有这一节)')
  process.exit(0)
}

/* ---------------- --promote：把 CI 发完 npm 的 draft 转正 ---------------- */

if (promote) {
  const plan = '把 ' + REPO + ' 的 draft Release ' + tag + ' 转正'
  console.log('release --promote ' + pkg.name + '@' + version)
  console.log('  ' + plan)
  if (dry) {
    console.log('\n计划模式：加 --apply 才会真的转正。')
    process.exit(0)
  }
  const rel = api('GET', 'repos/' + REPO + '/releases/tags/' + tag)
  if (!rel || rel.__existed || !rel.id) throw new Error('找不到 ' + tag + ' 的 Release')
  if (!rel.draft) {
    console.log('已经是正式 Release：', rel.html_url)
    process.exit(0)
  }
  const out = api('PATCH', 'repos/' + REPO + '/releases/' + rel.id, { draft: false })
  console.log('promoted:', out.html_url || tag)
  process.exit(0)
}

/* ---------------- 计划 ---------------- */

console.log('release ' + pkg.name + '@' + version + ' (' + tag + ')')
console.log('')

// 1) 身份 / 仓库 / 分支校验（只读，全部在副作用之前）
const topLevel = read('git', ['rev-parse', '--show-toplevel']).trim()
const cwd = process.cwd().replace(/\\/g, '/')
if (topLevel.replace(/\\/g, '/').toLowerCase() !== cwd.toLowerCase()) {
  throw new Error('必须在仓库根目录运行：cwd=' + cwd + ' toplevel=' + topLevel)
}
const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
if (branch !== BRANCH) throw new Error('当前分支是 ' + branch + '，发布只允许 ' + BRANCH)

const repoInfo = api('GET', 'repos/' + REPO)
const fullName = String((repoInfo && repoInfo.full_name) || '')
if (fullName.toLowerCase() !== REPO.toLowerCase()) {
  throw new Error('仓库校验失败：期望 ' + REPO + '，实际 ' + fullName)
}
const me = api('GET', 'user')
console.log('repo   : ' + fullName + '  (auth: ' + (me && me.login) + ')')
console.log('branch : ' + branch)

// 2) 工作区
const dirty = read('git', ['status', '--porcelain', '--untracked-files=no']).trim()
const dirtyFiles = dirty ? dirty.split(/\r?\n/) : []
// 未跟踪文件默认不参与：仓库里有几份审计材料本来就没入库，
// 旧写法会把它们算成「脏」，并在 --commit 时用 `git add -A` 一起提交进去。
const untracked = read('git', ['ls-files', '--others', '--exclude-standard'])
  .split(/\r?\n/)
  .filter(Boolean)
if (untracked.length) console.log('untracked: ' + untracked.length + ' 个（默认不提交，加 --include-untracked 才收）')
if (dirtyFiles.length && !allowCommit) {
  throw new Error(
    '工作区有未提交改动（' + dirtyFiles.length + ' 个文件）。' +
      '确认要一起提交请加 --commit；先提交或清理再发布。\n  ' +
      dirtyFiles.slice(0, 12).join('\n  '),
  )
}

// 3) 测试绿闸：同一次执行的 SHA 在本地必须先过
const testCmd = ['node', ['--test', 'tests/host.test.mjs', 'tests/assets.test.mjs', 'tests/runtime.test.mjs']]
console.log('tests  : ' + (dry ? '(计划模式下仍会真跑)' : '') + ' node --check + smoke + ' + testCmd[1].join(' '))
if (!argv.includes('--skip-tests')) {
  read('node', ['--check', 'client.js'])
  read('node', ['--check', 'index.js'])
  read('node', ['tests/smoke.mjs'])
  read(testCmd[0], testCmd[1])
  console.log('tests  : OK')
}

/* ---------------- 确认 ---------------- */

const planLines = []
if (dirtyFiles.length) planLines.push('提交 ' + dirtyFiles.length + ' 个文件（git add -A）')
planLines.push('推送 ' + BRANCH + ' 到 ' + REPO + '（Data API，base_tree 保留远端独有文件）')
planLines.push(shouldPublish ? 'npm publish ' + pkg.name + '@' + version + '（本机），并等 registry 能查到' : 'npm 交给 CI（tag 触发 release.yml）')
planLines.push('创建 tag ' + tag)
planLines.push(shouldPublish ? '创建正式 Release ' + tag : '创建 draft Release ' + tag + '（CI 发完 npm 后 --promote 转正）')

console.log('')
console.log('将要执行：')
for (const l of planLines) console.log('  · ' + l)

if (dry) {
  console.log('')
  console.log('计划模式（默认只读）：确认无误后加 --apply 执行。')
  process.exit(0)
}

if (!autoYes) {
  process.stdout.write('\n输入 y 继续（其它任意键取消）: ')
  const buf = Buffer.alloc(8)
  let n = 0
  try {
    n = fs.readSync(0, buf)
  } catch (e) {
    n = 0 // EOF / 非交互：按取消处理
  }
  const answer = buf.slice(0, n).toString().trim().toLowerCase()
  if (answer !== 'y') {
    console.log('已取消：没有产生任何本地提交 / 远端写 / tag / Release / npm 调用。')
    process.exit(1)
  }
}

/* ---------------- 执行（顺序即契约） ---------------- */

if (dirtyFiles.length) {
  mutate('git', includeUntracked ? ['add', '-A'] : ['add', '-u'])
  mutate('git', [
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

mutate('node', ['tools/push-via-api.cjs', REPO, BRANCH, '--apply'])
const head = dry ? 'HEAD' : api('GET', 'repos/' + REPO + '/git/ref/heads/' + BRANCH).object.sha
console.log('remote head:', head)

// npm 先发、**确认 registry 真的能取到**之后才打 tag。
// 踩过的坑：npm publish 退出码 0 不代表立刻可查（npm 会「processing, may take a few
// minutes」，本机实测约 2 分钟）；也可能落成 staged/202 等 2FA。这两种情况下都不能先推
// tag，否则版本号被占住、重跑会 E409。顺序固定为 publish → verify → tag，且可重跑：
// 若 registry 已经能查到该版本，就跳过 publish（幂等）。
let published = false
if (shouldPublish) {
  const onNpm = () => {
    try {
      execFileSync('npm', ['view', pkg.name + '@' + version, 'version', '--registry=https://registry.npmjs.org/'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return true
    } catch (e) {
      return false
    }
  }
  if (onNpm()) {
    console.log('npm 上已有 ' + pkg.name + '@' + version + '，跳过 publish（重跑安全）')
    published = true
  } else {
    // Windows: npm is npm.cmd，execFile 起不来，走 shell；参数固定，无用户输入。
    execSync('npm publish --registry=https://registry.npmjs.org/', { stdio: 'inherit' })
    // npm 的索引有延迟：最多等 10 分钟（30 × 20s），期间每 20s 查一次
    let seen = false
    for (let i = 0; i < 30; i++) {
      if (onNpm()) {
        seen = true
        break
      }
      process.stdout.write('.')
      sleepSync(20000)
    }
    if (!seen) {
      throw new Error(
        'npm 上还查不到 ' + pkg.name + '@' + version + '：不打 tag、不建 Release（可能落成 staged 等 2FA，' +
          '或索引还没刷新）。npm view 能取到后**重跑本脚本**即可——publish 会因版本已存在而跳过。',
      )
    }
    console.log('\npublished to npm: ' + pkg.name + '@' + version)
    published = true
  }
}

// tag：npm 成功后才推（--publish），或交给 CI 发 npm（默认）
apiMutate('POST', 'repos/' + REPO + '/git/refs', { ref: 'refs/tags/' + tag, sha: head }, 'tag ' + tag)
console.log('tag:', dry ? '(plan)' : 'ok ' + tag)
if (!published) {
  console.log('npm: 交由 CI 发布（tag 已推）；成功后跑 --promote 把 draft 转正')
}

// Release：CI 的 release.yml 也会创建/复用同名 Release 并挂 tgz，两边可能撞车。
// 若已存在（422），把正文/标题/draft 校正成 CHANGELOG 这一版，保证说明是权威版本。
const body = releaseBody()
const payload = { tag_name: tag, name: pkg.name + ' ' + version, body, draft: !published, prerelease: false }
const rel = apiMutate('POST', 'repos/' + REPO + '/releases', payload, 'Release ' + tag)
let relUrl = rel && rel.html_url
if (rel && rel.__existed) {
  try {
    const existing = api('GET', 'repos/' + REPO + '/releases/tags/' + tag)
    const fixed = api('PATCH', 'repos/' + REPO + '/releases/' + existing.id, {
      name: payload.name,
      body: payload.body,
      draft: payload.draft,
      prerelease: false,
    })
    relUrl = fixed && fixed.html_url
    console.log('release: 已存在，正文按 CHANGELOG 校正')
  } catch (e) {
    console.log('release: 已存在，但校正失败（不阻塞）：' + String((e && e.message) || e).slice(0, 120))
  }
}
console.log('release:', dry ? '(plan)' : (relUrl || tag) + (published ? '' : ' [draft]'))
console.log('done.')
