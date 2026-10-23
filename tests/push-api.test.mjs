/**
 * R05 端到端：用内存版 GitHub（tests/fixtures/fake-github.cjs）真跑
 * tools/push-via-api.cjs，验证「不覆盖远端独有文件」这一组承诺。
 *
 * 为什么要有这一层：只读计划证明不了写路径（上传 blob / 合并 tree / 更新 ref）。
 * 这里在一个临时 git 仓库里跑真实脚本，只把网络层换成假的，于是
 * base_tree、--prune、force 缺失、head 被移动时中止，全部可断言且可进 CI。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'tools', 'push-via-api.cjs')
const TRANSPORT = join(here, 'fixtures', 'fake-github.cjs')
const REPO = 'owner/repo'

const hex = (s) => createHash('sha1').update(String(s)).digest('hex')

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pushapi-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '.')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'local content v1\n')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'sub', 'b.txt'), 'nested\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
  return { dir, git }
}

function seed(dir, state) {
  const p = join(dir, 'state.json')
  writeFileSync(p, JSON.stringify(state, null, 2))
  return p
}

function run(repo, statePath, args) {
  const env = { ...process.env, DSH_PUSH_API_TRANSPORT: TRANSPORT, DSH_PUSH_API_STATE: statePath }
  try {
    const out = execFileSync(process.execPath, [SCRIPT, REPO, 'main', ...args], {
      cwd: repo.dir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status || 1, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}

function readState(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

test('R05 新分支：tree 不带 base_tree，blob 全部上传', () => {
  const repo = makeRepo()
  const statePath = seed(repo.dir, { refs: {}, commits: {}, trees: {}, calls: [] })
  const r = run(repo, statePath, ['--apply'])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  assert.ok(st.refs.main, '分支要被创建')
  assert.equal(st.lastTree.base, null, '新分支没有 base_tree')
  const paths = st.lastTree.entries.map((e) => e.path).sort()
  assert.deepEqual(paths, ['a.txt', 'sub/b.txt'])
  assert.ok(st.blobCount >= 2, '两个 blob 都要上传：' + st.blobCount)
  assert.ok(st.calls.some((c) => c.key.includes('POST')), '应该有真正的写调用')
})

test('R05 更新：带 base_tree，远端独有文件默认保留', () => {
  const repo = makeRepo()
  const remoteOnly = 'REMOTE-ONLY.txt'
  const remoteTreeSha = hex('remote-tree')
  const baseCommit = hex('base-commit')
  // 远端：a.txt（旧内容）+ REMOTE-ONLY.txt
  const statePath = seed(repo.dir, {
    refs: { main: baseCommit },
    commits: { [baseCommit]: { tree: remoteTreeSha, parents: [] } },
    trees: {
      [remoteTreeSha]: [
        { path: 'a.txt', sha: hex('old-a') },
        { path: remoteOnly, sha: hex('remote-only') },
      ],
    },
    calls: [],
  })
  const r = run(repo, statePath, ['--apply'])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  assert.equal(st.lastTree.base, remoteTreeSha, '必须用远端 tree 当 base_tree')
  assert.ok(
    st.lastTree.entries.every((e) => e.path !== remoteOnly),
    '默认不能把远端独有文件写进 tree（更不能写 sha:null）',
  )
  assert.ok(
    st.lastTree.merged.some((e) => e.path === remoteOnly),
    '合并后的 tree 仍应包含远端独有文件',
  )
  assert.match(r.out, /remoteOnly=1/)
  assert.match(r.out, /\+ REMOTE-ONLY\.txt/)
})

test('R05 --prune 才删除远端独有文件（sha:null）', () => {
  const repo = makeRepo()
  const remoteTreeSha = hex('remote-tree-2')
  const baseCommit = hex('base-commit-2')
  const statePath = seed(repo.dir, {
    refs: { main: baseCommit },
    commits: { [baseCommit]: { tree: remoteTreeSha, parents: [] } },
    trees: {
      [remoteTreeSha]: [
        { path: 'a.txt', sha: hex('old-a') },
        { path: 'GONE.txt', sha: hex('gone') },
      ],
    },
    calls: [],
  })
  const r = run(repo, statePath, ['--apply', '--prune'])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  const del = st.lastTree.entries.find((e) => e.path === 'GONE.txt')
  assert.ok(del, '--prune 必须显式提交删除项')
  assert.equal(del.sha, null)
  assert.ok(!st.lastTree.merged.some((e) => e.path === 'GONE.txt'))
})

test('R05 head 被移动：中止且不 PATCH ref（不带 force 覆盖别人）', () => {
  const repo = makeRepo()
  const remoteTreeSha = hex('remote-tree-3')
  const baseCommit = hex('base-commit-3')
  const statePath = seed(repo.dir, {
    refs: { main: baseCommit },
    commits: { [baseCommit]: { tree: remoteTreeSha, parents: [] } },
    trees: { [remoteTreeSha]: [{ path: 'a.txt', sha: hex('old-a') }] },
    calls: [],
    // 第一次 GET ref 是读取 head，第二次是提交后的复核 → 第二次返回新 sha
    failHeadMoveCount: 2,
  })
  const r = run(repo, statePath, ['--apply'])
  assert.notEqual(r.code, 0, 'head 被移动必须失败')
  assert.match(r.err || r.out, /被移动|中止/)
  const st = readState(statePath)
  assert.ok(!st.calls.some((c) => c.key.startsWith('PATCH ')), '不能 PATCH 别人的分支')
})

test('R05 ref 更新不带 force 字段', () => {
  const repo = makeRepo()
  const remoteTreeSha = hex('remote-tree-4')
  const baseCommit = hex('base-commit-4')
  const statePath = seed(repo.dir, {
    refs: { main: baseCommit },
    commits: { [baseCommit]: { tree: remoteTreeSha, parents: [] } },
    trees: { [remoteTreeSha]: [{ path: 'a.txt', sha: hex('old-a') }] },
    calls: [],
  })
  const r = run(repo, statePath, ['--apply'])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  assert.ok(st.lastPatch, '应该更新了 ref')
  assert.equal(Object.prototype.hasOwnProperty.call(st.lastPatch, 'force'), false, '不允许 force')
})

test('R05 计划模式：一次写调用都不发生', () => {
  const repo = makeRepo()
  const statePath = seed(repo.dir, { refs: {}, commits: {}, trees: {}, calls: [] })
  const r = run(repo, statePath, [])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  const writes = st.calls.filter((c) => !c.key.startsWith('GET '))
  assert.deepEqual(writes, [], '计划模式不能有写调用：' + JSON.stringify(writes))
  assert.match(r.out, /计划模式/)
})

test('R05 工作树 CRLF 不会被判成「每次都在变」，远端存的是 git 归一化后的内容', () => {
  const repo = makeRepo()
  writeFileSync(join(repo.dir, '.gitattributes'), '* text=auto eol=lf\n')
  writeFileSync(join(repo.dir, 'crlf.txt'), 'a\r\nb\r\n')
  repo.git('add', '-A')
  repo.git('commit', '-qm', 'crlf case')
  const statePath = seed(repo.dir, { refs: {}, commits: {}, trees: {}, calls: [] })

  const r1 = run(repo, statePath, ['--apply'])
  assert.equal(r1.code, 0, r1.err || r1.out)
  const st1 = readState(statePath)
  const entry = st1.lastTree.entries.find((e) => e.path === 'crlf.txt')
  assert.ok(entry, 'crlf.txt 应该在 tree 里')
  assert.equal(Buffer.from(st1.blobs[entry.sha], 'base64').toString('utf8'), 'a\nb\n', '远端必须存 LF（与 git 存的一致），而不是工作树的 CRLF')

  const r2 = run(repo, statePath, ['--apply'])
  assert.equal(r2.code, 0, r2.err || r2.out)
  assert.match(r2.out, /changed=0/, '第二次跑不应再有变更：' + r2.out)
  assert.equal(readState(statePath).blobCount, st1.blobCount, '第二次不应上传任何 blob')
})

test('二进制文件必须逐字节上传（UTF-8 解码会把非 UTF-8 字节换成 U+FFFD）', () => {
  const repo = makeRepo()
  // 这些字节在 UTF-8 里非法：只要中间有一次 utf8 解码/编码，长度和内容都会变
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0xa0, 0xa1])
  writeFileSync(join(repo.dir, 'clip.webm'), bytes)
  repo.git('add', '-A')
  repo.git('commit', '-qm', 'binary')
  const statePath = seed(repo.dir, { refs: {}, commits: {}, trees: {}, calls: [] })
  const r = run(repo, statePath, ['--apply'])
  assert.equal(r.code, 0, r.err || r.out)
  const st = readState(statePath)
  const entry = st.lastTree.entries.find((e) => e.path === 'clip.webm')
  assert.ok(entry, 'clip.webm 应该在 tree 里')
  const stored = Buffer.from(st.blobs[entry.sha], 'base64')
  assert.equal(stored.length, bytes.length, '上传后的字节数必须一致（不能被 U+FFFD 撑大）')
  assert.ok(stored.equals(bytes), '上传内容必须逐字节一致')
})
