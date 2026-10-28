/**
 * 测量每个形象「立绘 vs 动作视频」里人物在画布中的占比，算出对齐参数。
 *
 * 为什么需要它：立绘里人物几乎顶满画布（~99%），而动作视频导出时四周留了
 * 透明边（人物只占 73%~97%）。CSS 用 height:100% 把「画布」对齐到同一个框，
 * 但人物在画布里占比不同 → 切换动作时人物视觉大小突跳（用户 2026-10-28 反馈
 * 「撩头发突然变小」）。
 *
 * 产出：pack.json 的 clipFit = { 动作名: { s, y } }
 *   s = 视频画布要放大的倍数（让其中的人物与立绘同高）
 *   y = 元素向下平移的比例（占框高），保证脚底落在同一基线
 *
 * 用法：node tools/measure-clipfit.mjs [--write]
 *   不带 --write 只打印；带 --write 写回 pets/<id>/pack.json
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const WRITE = process.argv.includes('--write')

function probe(f) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f],
    { encoding: 'utf8' },
  ).trim()
  const [w, h] = out.split(',').map(Number)
  return { w, h }
}

/** 静帧：读 alpha 一次，返回人像上下边界 */
function stillBBox(file) {
  const { w, h } = probe(file)
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 256 * 1024 * 1024 },
  )
  return { ...rowBox(buf, w, h), w, h }
}

function rowBox(buf, w, h) {
  const rows = new Array(h).fill(0)
  let minX = w, maxX = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[y * w + x] > 200) {
        rows[y]++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  const th = Math.max(2, Math.floor(w * 0.02))
  let top = -1, bot = -1
  for (let y = 0; y < h; y++) if (rows[y] >= th) { top = y; break }
  for (let y = h - 1; y >= 0; y--) if (rows[y] >= th) { bot = y; break }
  // cxRatio：人物水平中心在画布中的相对位置（0.5 = 正中）。裁剪框按全片并集取，
  // 手臂/头发偏向一侧时人物会整体偏离画布中心，切片段时就会横向跳一下。
  const cxRatio = maxX >= 0 ? ((minX + maxX) / 2) / w : 0.5
  return { top, bot, cxRatio }
}

/** 视频：一次解码全部帧，按帧切片统计，取中位数（避开挥手/抬臂等极端帧） */
function videoStats(file) {
  const { w, h } = probe(file)
  const size = w * h
  let raw
  try {
    raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 512 * 1024 * 1024 },
    )
  } catch (e) {
    return null
  }
  const nFrames = Math.floor(raw.length / size)
  if (!nFrames) return null
  const heights = []
  const bots = []
  const cxs = []
  // 最多采样 24 帧，均匀分布
  const step = Math.max(1, Math.floor(nFrames / 24))
  for (let f = 0; f < nFrames; f += step) {
    const buf = raw.subarray(f * size, (f + 1) * size)
    const b = rowBox(buf, w, h)
    if (b.top >= 0 && b.bot > b.top) {
      heights.push(b.bot - b.top + 1)
      bots.push(b.bot)
      cxs.push(b.cxRatio)
    }
  }
  if (!heights.length) return null
  const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)]
  return { w, h, medH: med(heights), medBot: med(bots), medCx: med(cxs), nFrames, sampled: heights.length }
}

const TEMPLATE_IDS = new Set(['example'])
const ids = readdirSync('pets', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join('pets', d.name, 'pack.json')))
  .map((d) => d.name)
  .filter((id) => !TEMPLATE_IDS.has(id))

const result = {}
for (const id of ids) {
  const packPath = join('pets', id, 'pack.json')
  const pack = JSON.parse(readFileSync(packPath, 'utf8'))
  const stillFile = 'assets/' + (pack.image || (pack.images && pack.images.idle))
  let sb
  try {
    sb = stillBBox(stillFile)
  } catch (e) {
    console.log(`${id}: 立绘读取失败，跳过 (${e.message})`)
    continue
  }
  if (sb.bot < 0) { console.log(`${id}: 立绘无人物，跳过`); continue }
  const stillRatio = (sb.bot - sb.top + 1) / sb.h
  const stillBottomPad = 1 - (sb.bot + 1) / sb.h
  const stillCx = sb.cxRatio
  console.log(`\n${id}(${pack.name}) 立绘 ${sb.w}x${sb.h} 人像占比 ${(stillRatio * 100).toFixed(1)}% 底部留白 ${(stillBottomPad * 100).toFixed(2)}% 中心X ${(stillCx * 100).toFixed(1)}%`)

  const fit = {}
  for (const [action, file] of Object.entries(pack.clips || {})) {
    const st = videoStats('assets/' + file)
    if (!st || !st.medH) { console.log(`  ${action}: 测量失败`); continue }
    const videoRatio = st.medH / st.h
    const s = stillRatio / videoRatio
    const y = s * (1 - (st.medBot + 1) / st.h) - stillBottomPad
    // 横向补偿：把视频里人物的中心拉回立绘的中心。
    // x 是「相对视频元素自身宽度」的位移比例，CSS 用 translateX(calc(-50% + x*100%))。
    const x = -(st.medCx - stillCx)
    fit[action] = { s: Number(s.toFixed(4)), y: Number(y.toFixed(4)), x: Number(x.toFixed(4)) }
    console.log(
      `  ${action}: ${st.w}x${st.h} 人像占比 ${(videoRatio * 100).toFixed(1)}% 中心X ${(st.medCx * 100).toFixed(1)}%` +
      ` → s=${s.toFixed(4)} y=${y.toFixed(4)} x=${x.toFixed(4)}  (${st.sampled}/${st.nFrames}帧)`,
    )
  }
  result[id] = fit

  // 静帧对齐（1.26.1）：表情立绘之间也可能水平不齐。
  // azure 实测 happy/shy/angry/sleep 相对 idle 整体左移 16~24px（画布 468 宽），
  // 切表情时会横向跳一下。这里按文件名记录需要右移的比例。
  // 只记录超过阈值的条目，避免 pack.json 里塞一堆 0。
  const imgFit = {}
  const baseCxPx = sb.cxRatio * sb.w
  for (const file of Object.values(pack.images || {})) {
    if (file === pack.image) continue // 与基准同一张图
    let b
    try { b = stillBBox('assets/' + file) } catch (e) { continue }
    if (!b || b.bot < 0) continue
    const dx = -(b.cxRatio * b.w - baseCxPx) / b.w
    if (Math.abs(dx) > 0.005) imgFit[file] = Number(dx.toFixed(4))
  }
  if (Object.keys(imgFit).length) {
    pack.imageFit = imgFit
    for (const [f, v] of Object.entries(imgFit)) console.log(`  静帧 ${f}: 需右移 ${(v * 100).toFixed(2)}% 宽`)
  }

  if (WRITE && Object.keys(fit).length) {
    pack.clipFit = fit
    writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n')
    console.log(`  ✓ 已写入 ${packPath}`)
  }
}

if (!WRITE) {
  console.log('\n--- 预览（加 --write 写回 pack.json）---')
  console.log(JSON.stringify(result, null, 2))
}
