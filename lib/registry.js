/**
 * dsh-pet 宿主侧运行期注册表（R-01 / R-07，反哺报告 2026-10-27）。
 *
 * 职责：
 *  - 扫描包内 pets/<id>/pack.json（发布期同一数据源）与用户目录
 *    $DSH_HOME/dsh-pet/pets/<id>/pack.json，合并成运行期 persona 表；
 *  - fail-closed 校验：必需字段缺失 / 引用资产不存在 / 形状不对 → 整包拒载并
 *    记 warning，绝不半载（半载的形象会在播放到某条 clip 时才炸，更难排查）；
 *  - voice.json 台词覆盖（R-07）：warn-and-drop —— 只丢不合规的键，好的键照常生效。
 *
 * 设计约束：纯逻辑 + 注入路径，node --test 里可以直接对临时目录跑，
 * 不需要起宿主。宿主半边（index.js）只负责把它挂到路由上。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 模板目录：有 pack.json 但不进运行期（与 tools/gen-personas.cjs 同一套规则） */
export const TEMPLATE_IDS = new Set(['example'])
/** 内置形象固定顺序（⚠ 必须与 tools/gen-personas.cjs 的 PREFERRED 同步改），其余按字母序追加 */
export const PREFERRED_IDS = ['violet', 'crimson', 'indigo', 'silver', 'azure']

/** voice.json 允许覆盖的键（台词五语包） */
export const VOICE_LINE_KEYS = ['lines', 'linesEn', 'linesEs', 'linesPt', 'linesHi']

/** pack.json 本体的大小上限：64KB（防有人塞一整本台词集把扫描拖死） */
export const PACK_MAX_BYTES = 64 * 1024

const isStr = (v) => typeof v === 'string' && v.trim().length > 0
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isPosNum = (v) => isFiniteNum(v) && v > 0

/** SVG 分支（src/80-art.js）无条件读的五个颜色槽：缺任何一个都会在渲染期抛 TypeError */
export const SVG_COLOR_KEYS = ['body', 'body2', 'belly', 'accent', 'eye']

/** 文件名必须是纯 basename：不收路径分隔符、目录跳转与空名 */
export const safeFile = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 200 &&
  !v.includes('/') &&
  !v.includes('\\') &&
  v !== '.' &&
  v !== '..'

/** $DSH_HOME 的解析顺序：环境变量优先，回落 ~/.dsh（与宿主 sessions 目录同约定） */
export function dshHomeDir() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim()) return env
  return join(homedir(), '.dsh')
}

/** 本插件的数据目录：$DSH_HOME/dsh-pet（用户宠物包 / voice.json / state.json 都住这） */
export function petDataDir() {
  return join(dshHomeDir(), 'dsh-pet')
}

async function fileExists(abs) {
  try {
    const st = await stat(abs)
    return st.isFile()
  } catch (e) {
    return false
  }
}

/**
 * 形状校验（同步、纯函数）。
 * 必需：name（非空字符串）、clips（对象且至少一条合法文件名）、
 *       image 或 images.idle（静帧兜底，缺了失败回退没图可垫）。
 * 可选：voice / temper / actions / images / lines* —— 但一旦出现就必须形状正确，
 *       不合规同样整包拒载（fail-closed：宁可不加载，不加载一半）。
 */
export function validatePackShape(pack, dirName) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { ok: false, reason: 'pack.json 顶层不是对象' }
  }
  const id = pack.id == null ? dirName : pack.id
  if (!isStr(id) || !safeFile(id)) return { ok: false, reason: 'id 不合法' }
  if (id !== dirName) return { ok: false, reason: `id(${id}) 与目录名(${dirName})不一致` }
  if (!isStr(pack.name) || pack.name.length > 60) return { ok: false, reason: 'name 缺失或超长' }
  if (!pack.clips || typeof pack.clips !== 'object' || Array.isArray(pack.clips)) {
    return { ok: false, reason: 'clips 缺失或不是对象' }
  }
  const clipNames = Object.values(pack.clips)
  if (!clipNames.length || !clipNames.every(safeFile)) {
    return { ok: false, reason: 'clips 为空或含非法文件名' }
  }
  const hasStill = safeFile(pack.image) || (pack.images && safeFile(pack.images.idle))
  if (!hasStill) return { ok: false, reason: '缺 image / images.idle 静帧' }
  // 2026-10-29 审计 P1-2：渲染分流的唯一判据是 image（PetArt 的 if (p.image)），
  // 不是「有没有静帧」。只有 images.idle 的包会走 SVG 分支，而 SVG 分支无条件读
  // p.colors.body2 / c.eye …（src/80-art.js），缺了就在渲染期抛 TypeError，
  // 整个 overlay slot 白屏。所以这类包必须在准入时拒掉。
  if (!safeFile(pack.image)) {
    if (!pack.colors || typeof pack.colors !== 'object' || Array.isArray(pack.colors)) {
      return { ok: false, reason: '无 image 的 SVG 形象必须给 colors' }
    }
    for (const key of SVG_COLOR_KEYS) {
      const v = pack.colors[key]
      if (typeof v !== 'string' || !v.trim() || v.length > 60) {
        return { ok: false, reason: `colors.${key} 缺失或不是颜色字符串` }
      }
    }
  } else if (pack.colors != null && (typeof pack.colors !== 'object' || Array.isArray(pack.colors))) {
    return { ok: false, reason: 'colors 形状不对' }
  }
  if (pack.images != null && (typeof pack.images !== 'object' || Array.isArray(pack.images))) {
    return { ok: false, reason: 'images 形状不对' }
  }
  if (pack.images && !Object.values(pack.images).every((v) => v == null || safeFile(v))) {
    return { ok: false, reason: 'images 含非法文件名' }
  }
  if (pack.actions != null) {
    if (typeof pack.actions !== 'object' || Array.isArray(pack.actions)) {
      return { ok: false, reason: 'actions 形状不对' }
    }
    for (const frames of Object.values(pack.actions)) {
      if (!Array.isArray(frames) || !frames.every(safeFile)) {
        return { ok: false, reason: 'actions 含非法帧文件名' }
      }
    }
  }
  for (const key of VOICE_LINE_KEYS) {
    const lines = pack[key]
    if (lines == null) continue
    if (typeof lines !== 'object' || Array.isArray(lines)) return { ok: false, reason: `${key} 形状不对` }
    for (const list of Object.values(lines)) {
      if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) {
        return { ok: false, reason: `${key}.${''} 台词数组里混了非字符串` }
      }
    }
  }
  // voice：voiceParams() 无条件算 Number(p.voice.pitch) * …，缺字段得到 NaN，
  // 再 clamp 成 0.5——听感是「嗓子突然变了」。所以出现就必须是 0.3–3 的有限数。
  if (pack.voice != null) {
    if (typeof pack.voice !== 'object' || Array.isArray(pack.voice)) {
      return { ok: false, reason: 'voice 形状不对' }
    }
    for (const key of ['pitch', 'rate']) {
      const v = pack.voice[key]
      if (!isFiniteNum(v) || v < 0.3 || v > 3) {
        return { ok: false, reason: `voice.${key} 不是 0.3–3 的有限数` }
      }
    }
    if (pack.voice.moods != null) {
      if (typeof pack.voice.moods !== 'object' || Array.isArray(pack.voice.moods)) {
        return { ok: false, reason: 'voice.moods 形状不对' }
      }
      for (const [mood, dir] of Object.entries(pack.voice.moods)) {
        if (!dir || typeof dir !== 'object' || Array.isArray(dir)) {
          return { ok: false, reason: `voice.moods.${mood} 不是对象` }
        }
        for (const key of ['pitch', 'rate', 'volume']) {
          if (dir[key] != null && !Number.isFinite(Number(dir[key]))) {
            return { ok: false, reason: `voice.moods.${mood}.${key} 不是数字` }
          }
        }
      }
    }
    if (pack.voice.voiced != null) {
      if (typeof pack.voice.voiced !== 'object' || Array.isArray(pack.voice.voiced)) {
        return { ok: false, reason: 'voice.voiced 形状不对' }
      }
      for (const [lang, name] of Object.entries(pack.voice.voiced)) {
        if (name != null && (typeof name !== 'string' || name.length > 60)) {
          return { ok: false, reason: `voice.voiced.${lang} 不是音色名` }
        }
      }
    }
  }
  // temper：weighted(p.temper) 按值当权重抽样；非正数/NaN 会让抽样退化
  if (pack.temper != null) {
    if (typeof pack.temper !== 'object' || Array.isArray(pack.temper)) {
      return { ok: false, reason: 'temper 形状不对' }
    }
    for (const [mood, weight] of Object.entries(pack.temper)) {
      if (!isFiniteNum(weight) || weight <= 0) {
        return { ok: false, reason: `temper.${mood} 不是正数权重` }
      }
    }
  }
  // 渲染层会拼「名字 · 标签」：tag 缺省给空串，别让 undefined 进 title
  const tag = typeof pack.tag === 'string' && pack.tag.length <= 60 ? pack.tag : ''
  const tagEn = typeof pack.tagEn === 'string' && pack.tagEn.length <= 60 ? pack.tagEn : ''
  return { ok: true, pack: { ...pack, id, tag, tagEn } }
}

/** 收集 pack 里引用到的所有资产文件名（存在性校验用） */
function collectRefs(pack) {
  const refs = new Set()
  if (safeFile(pack.image)) refs.add(pack.image)
  for (const key of ['images', 'clips']) {
    for (const v of Object.values(pack[key] || {})) {
      if (typeof v === 'string' && safeFile(v)) refs.add(v)
    }
  }
  for (const frames of Object.values(pack.actions || {})) {
    if (Array.isArray(frames)) for (const f of frames) if (safeFile(f)) refs.add(f)
  }
  return refs
}

/**
 * 读并校验一个 pack 目录。
 * @param {string} dir 包目录绝对路径
 * @param {string} dirName 目录名（= 期望的 persona id）
 * @returns {Promise<{ok:boolean, pack?:object, reason?:string}>}
 */
export async function loadPackDir(dir, dirName, assetDirs) {
  if (!safeFile(dirName)) return { ok: false, reason: '目录名不合法' }
  // 资产存在性的候选目录：默认「与 pack.json 同目录」；内置包的资产实际
  // 住在包内 assets/（与发布期布局一致），所以内置扫描会额外传那个目录。
  const candidates = assetDirs && assetDirs.length ? assetDirs : [dir]
  const file = join(dir, 'pack.json')
  let raw
  try {
    const st = await stat(file)
    if (!st.isFile()) return { ok: false, reason: 'pack.json 不是文件' }
    if (st.size > PACK_MAX_BYTES) return { ok: false, reason: `pack.json 超 ${PACK_MAX_BYTES} 字节上限` }
    raw = await readFile(file, 'utf8')
  } catch (e) {
    return { ok: false, reason: 'pack.json 读不到' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, reason: 'pack.json 不是合法 JSON' }
  }
  const shape = validatePackShape(parsed, dirName)
  if (!shape.ok) return { ok: false, reason: shape.reason }
  const pack = shape.pack
  for (const ref of collectRefs(pack)) {
    let found = false
    for (const base of candidates) {
      if (await fileExists(join(base, ref))) {
        found = true
        break
      }
    }
    if (!found) {
      return { ok: false, reason: `引用的资产缺失：${ref}` }
    }
  }
  return { ok: true, pack }
}

/** 目录枚举（子目录名列表，忽略文件与模板目录） */
async function listPackDirs(root) {
  const { readdir } = await import('node:fs/promises')
  let dirs
  try {
    dirs = await readdir(root, { withFileTypes: true })
  } catch (e) {
    return [] // 目录不存在 / 不可读：当作空（用户目录没建是常态）
  }
  return dirs
    .filter((d) => d.isDirectory() && !TEMPLATE_IDS.has(d.name) && safeFile(d.name))
    .map((d) => d.name)
    .sort()
}

/**
 * 扫描内置 + 用户目录，产出运行期注册表。
 *
 * @param {object} opts
 * @param {string} opts.builtinDir 包内 pets/ 绝对路径
 * @param {string} [opts.builtinAssetDir] 包内 assets/ 绝对路径（内置包资产的真实住处）
 * @param {string} [opts.userDir] 用户宠物目录绝对路径（$DSH_HOME/dsh-pet/pets）
 * @param {(msg:string)=>void} [opts.log] 警告输出（宿主传 logger；测试里收集数组）
 * @returns {Promise<{personas:Array, userDirs:Map<string,string>, warnings:string[]}>}
 *   personas 已按「内置顺序 + 用户字母序」排好，用户包覆盖同 id 内置包；
 *   每个 persona 注入 assetBase（内置 '/dsh-pet/assets'，用户 '/dsh-pet/pets/<id>'）。
 */
export async function scanPersonas({ builtinDir, builtinAssetDir, userDir, log }) {
  const warnings = []
  const warn = (msg) => {
    warnings.push(msg)
    try {
      if (log) log('[dsh-pet] ' + msg)
    } catch (e) {
      /* ignore */
    }
  }
  const ordered = new Map()
  const userDirs = new Map()

  const addDir = async (root, isUser) => {
    const names = await listPackDirs(root)
    const orderedNames = isUser
      ? names
      : PREFERRED_IDS.filter((id) => names.includes(id)).concat(
          names.filter((id) => !PREFERRED_IDS.includes(id)),
        )
    for (const name of orderedNames) {
      const dir = join(root, name)
      const loaded = await loadPackDir(
        dir,
        name,
        isUser ? [dir] : builtinAssetDir ? [dir, builtinAssetDir] : [dir],
      )
      if (!loaded.ok) {
        // 拒载不覆盖内置同 id：用户包坏了不应该把内置形象弄丢
        warn(`pets/${name}：${loaded.reason}，已拒载`)
        continue
      }
      ordered.set(name, { ...loaded.pack })
      if (isUser) userDirs.set(name, dir)
    }
  }

  await addDir(builtinDir, false)
  if (userDir) await addDir(userDir, true)

  const personas = []
  for (const [id, pack] of ordered) {
    // assetBase：用户包走 /dsh-pet/pets/<id>（petAssetHandler 服务），
    // 内置包走 /dsh-pet/assets（assetHandler 服务，发布期布局）
    const assetBase = userDirs.has(id) ? '/dsh-pet/pets/' + id : '/dsh-pet/assets'
    personas.push({ ...pack, assetBase })
  }
  return { personas, userDirs, warnings }
}

/**
 * voice.json 台词覆盖（R-07）：warn-and-drop，按键丢弃，不整包失败。
 *
 * 输入形状（已由调用方 JSON.parse，与 pack.json 台词包同构）：
 *   { "<personaId 或 *>": { "lines"|"linesEn"|...: { "<mood>": ["台词", ...] } } }
 * 值键只接受 VOICE_LINE_KEYS；每个 mood 数组 ≤200 条、每条 ≤300 字，
 * 超出的 mood 键整个丢弃并 warn，不截断 —— 截一半的台词表比没有更奇怪。
 *
 * @returns {{personas:Array, warnings:string[]}} 新数组（不就地改入参）
 */
export function applyVoiceOverrides(personas, voiceJson, { log } = {}) {
  const warnings = []
  const warn = (msg) => {
    warnings.push(msg)
    try {
      if (log) log('[dsh-pet] ' + msg)
    } catch (e) {
      /* ignore */
    }
  }
  const out = personas.map((p) => ({ ...p }))
  if (!voiceJson || typeof voiceJson !== 'object' || Array.isArray(voiceJson)) {
    warn('voice.json：顶层不是对象，整体忽略')
    return { personas: out, warnings }
  }
  for (const [key, block] of Object.entries(voiceJson)) {
    const targets = key === '*' ? out : out.filter((p) => p.id === key)
    if (!targets.length) {
      warn(`voice.json：没有匹配的形象（${key}），整条忽略`)
      continue
    }
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      warn(`voice.json[${key}]：不是对象，整条忽略`)
      continue
    }
    for (const [lineKey, pack] of Object.entries(block)) {
      if (!VOICE_LINE_KEYS.includes(lineKey)) {
        warn(`voice.json[${key}].${lineKey}：不在允许清单（${VOICE_LINE_KEYS.join('/')}），丢弃`)
        continue
      }
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
        warn(`voice.json[${key}].${lineKey}：不是台词包对象（{ mood: [台词...] }），丢弃`)
        continue
      }
      const valid = {}
      for (const [mood, list] of Object.entries(pack)) {
        if (!isStr(mood)) {
          warn(`voice.json[${key}].${lineKey}：mood 键不是非空字符串，丢弃`)
          continue
        }
        const okShape =
          Array.isArray(list) &&
          list.length <= 200 &&
          list.every((x) => typeof x === 'string' && x.length <= 300)
        if (!okShape) {
          warn(`voice.json[${key}].${lineKey}.${mood}：不是合规台词数组（≤200 条、每条 ≤300 字），丢弃`)
          continue
        }
        valid[mood] = [...list]
      }
      for (const p of targets) p[lineKey] = { ...(p[lineKey] || {}), ...valid }
    }
  }
  return { personas: out, warnings }
}
