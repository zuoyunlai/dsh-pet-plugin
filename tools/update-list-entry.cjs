// 更新官方列表条目：动作从「帧」改为「24fps 视频片段」，并补上右键菜单与 /dsh-pet 命令
const { execFileSync } = require('node:child_process')

const FORK = 'zuoyunlai/awesome-dsh-plugin'
const BRANCH = 'add-dsh-pet-plugin'
const PATH_IN_REPO = 'data/plugins/zuoyunlai__dsh-pet-plugin.yml'

const content = `url: https://github.com/zuoyunlai/dsh-pet-plugin
name: zuoyunlai/dsh-pet-plugin
category: fun
description:
  en: 'A photo-real desktop companion for the DSH window: five personas (four of them with five expression sprites each), whose dance, hair-flip and walk actions play as 24 fps VP9 alpha video clips; proactive lines with an optional edge-tts neural voice, ink / confetti / cloud / fog / bomb effects, a right-click menu and a /dsh-pet command, plus a small chat box that answers through a one-shot host model call without writing to your session. UI text ships in en, zh, es, pt and hi.'
  zh: 'DSH 窗口里的超写实桌面伴侣：五只形象（四只各带五张表情立绘），跳舞、撩发、走路三套动作以 24fps VP9 alpha 视频片段播放；按活跃时段主动说话（可选 edge-tts 神经音色），带泼墨、撒花、乌云、起雾、炸弹特效、右键菜单与 /dsh-pet 斜杠命令，旁边的小输入框通过一次性宿主模型调用回话、不写进你的会话。界面文案内置中、英、西、葡、印五语。'
`

function gh(args, input) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  if (input !== undefined) opts.input = JSON.stringify(input)
  return execFileSync('gh', args, opts).trim()
}

const ref = JSON.parse(gh(['api', `repos/${FORK}/git/ref/heads/${BRANCH}`]))
const head = ref.object.sha
const headCommit = JSON.parse(gh(['api', `repos/${FORK}/git/commits/${head}`]))
console.log('branch head:', head.slice(0, 12))

const blob = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${FORK}/git/blobs`, '--input', '-'], {
    content: Buffer.from(content, 'utf8').toString('base64'),
    encoding: 'base64',
  }),
)
console.log('blob:', blob.sha.slice(0, 12))

const tree = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${FORK}/git/trees`, '--input', '-'], {
    base_tree: headCommit.tree.sha,
    tree: [{ path: PATH_IN_REPO, mode: '100644', type: 'blob', sha: blob.sha }],
  }),
)

const commit = JSON.parse(
  gh(['api', '-X', 'POST', `repos/${FORK}/git/commits`, '--input', '-'], {
    message:
      'Update the dsh-pet-plugin description to match the code\n\n' +
      'The three actions (dance / hair-flip / walk) have shipped as 24 fps VP9 alpha\n' +
      'video clips since 1.16, so "action frames" no longer describes them; also\n' +
      'mentions the right-click menu and the /dsh-pet command, both of which exist.\n',
    tree: tree.sha,
    parents: [head],
  }),
)
console.log('commit:', commit.sha)

gh(['api', '-X', 'PATCH', `repos/${FORK}/git/refs/heads/${BRANCH}`, '--input', '-'], {
  sha: commit.sha,
  force: false,
})
console.log('branch updated')
