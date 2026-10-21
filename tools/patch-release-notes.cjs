const fs = require('fs')
let s = fs.readFileSync('tools/release.cjs', 'utf8')

// 1) 从 CHANGELOG 抽当前版本段落
const helperAnchor = "console.log(`release ${pkg.name}@${version} (${tag})`)"
if (!s.includes(helperAnchor)) throw new Error('anchor missing')

const helper = `/** 从 CHANGELOG.md 抽出「## <version>」这一节（到下一个 ## 为止）。 */
function changelogSection(v) {
  try {
    const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split(/\\r?\\n/)
    const esc = v.replace(/\\./g, '\\\\.')
    const start = lines.findIndex((l) => new RegExp('^##\\\\s+' + esc + '(\\\\s|$)').test(l))
    if (start < 0) return ''
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\\s/.test(lines[i])) {
        end = i
        break
      }
    }
    return lines.slice(start + 1, end).join('\\n').trim()
  } catch (e) {
    return ''
  }
}

/** 发布说明：有手写稿就用，否则从 CHANGELOG 生成（再拼上安装命令）。 */
function releaseBody() {
  const notesPath = \`.github/release-notes/\${tag}.md\`
  if (fs.existsSync(notesPath)) {
    console.log('notes: using', notesPath)
    return fs.readFileSync(notesPath, 'utf8')
  }
  const section = changelogSection(version)
  if (!section) console.log('notes: no CHANGELOG section for', version, '- falling back to a stub')
  console.log('notes: generated from CHANGELOG.md')
  return [
    \`## \${pkg.name} \${version}\`,
    '',
    section || '_See CHANGELOG.md._',
    '',
    '### Install',
    '```bash',
    \`dsh plugin --profile desktop add \${pkg.name}@\${version}\`,
    '```',
    '',
    \`Full changelog: https://github.com/\${REPO}/blob/main/CHANGELOG.md\`,
  ].join('\\n')
}

`

s = s.replace(helperAnchor, helper + helperAnchor)

// 2) 用 releaseBody() 替换原来的 notesPath 逻辑
const oldBody = `const notesPath = \`.github/release-notes/\${tag}.md\`
const body = fs.existsSync(notesPath)
  ? fs.readFileSync(notesPath, 'utf8')
  : \`## \${pkg.name} \${version}\\n\\nSee [CHANGELOG.md](https://github.com/\${REPO}/blob/main/CHANGELOG.md).\\n\``
if (!s.includes(oldBody)) throw new Error('body anchor missing')
s = s.replace(oldBody, 'const body = releaseBody()')

fs.writeFileSync('tools/release.cjs', s)
console.log('patched:', s.includes('function releaseBody'), s.includes('const body = releaseBody()'))
