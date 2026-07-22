/**
 * 院校数据导入脚本
 *   npm run data:import
 *
 * 读取 data/raw/*.json(采集产出),清洗后写入 schools / programs 表。
 *
 * ⚠️ 核心原则(PRD 4.2「数据准确性是本产品的生命线」):
 *    导入的数据一律标记为 ai_collected + lastVerifiedAt=null,
 *    进入后台「待核对」队列。**未经人工核对不得作为确定值展示给用户。**
 *
 * ⚠️ 过期周期兜底:
 *    采集时院校官网可能仍挂着上一届(已截止)的申请周期。过期的截止日期
 *    比没有日期危险得多 —— 用户会照着它规划。因此任何早于今天的截止日期
 *    一律置空并降级置信度,原值保留在 notes 里供运营核对时参考。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PrismaClient, type Confidence, type Direction, type Region } from '@prisma/client'

const db = new PrismaClient()
const RAW_DIR = join(process.cwd(), 'data', 'raw')

const VALID_DIRECTIONS: Direction[] = [
  'finance', 'accounting', 'management', 'marketing', 'business_analytics',
  'economics', 'international_business', 'supply_chain', 'hr',
  'computer_science', 'data_science_ai', 'engineering', 'architecture',
  'mathematics_statistics', 'natural_sciences', 'life_sciences_medicine',
  'social_sciences', 'media_communication', 'law_public_policy', 'education',
  'arts_design', 'humanities', 'environment_sustainability',
  'agriculture_food_science', 'hospitality_tourism', 'public_health', 'other',
]
const VALID_REGIONS: Region[] = [
  'UK', 'HK', 'SG', 'AU', 'CA', 'MO', 'JP', 'KR', 'NZ', 'IE', 'NL', 'DE', 'FR', 'CH',
]

/**
 * 地区别名。采集 agent 可能写国家全称、中文名或其它代码,
 * 与其回头改数据文件,不如在导入端归一化 —— 采集是持续的。
 */
const REGION_ALIASES: Record<string, Region> = {
  uk: 'UK', gb: 'UK', gbr: 'UK', 'united kingdom': 'UK', britain: 'UK', 英国: 'UK',
  hk: 'HK', hkg: 'HK', 'hong kong': 'HK', 香港: 'HK', 中国香港: 'HK',
  sg: 'SG', sgp: 'SG', singapore: 'SG', 新加坡: 'SG',
  au: 'AU', aus: 'AU', australia: 'AU', 澳大利亚: 'AU', 澳洲: 'AU',
  ca: 'CA', can: 'CA', canada: 'CA', 加拿大: 'CA',
  mo: 'MO', mac: 'MO', macau: 'MO', macao: 'MO', 澳门: 'MO', 中国澳门: 'MO',
  jp: 'JP', jpn: 'JP', japan: 'JP', 日本: 'JP',
  kr: 'KR', kor: 'KR', 'south korea': 'KR', korea: 'KR', 韩国: 'KR',
  nz: 'NZ', nzl: 'NZ', 'new zealand': 'NZ', 新西兰: 'NZ',
  ie: 'IE', irl: 'IE', ireland: 'IE', 爱尔兰: 'IE',
  nl: 'NL', nld: 'NL', netherlands: 'NL', holland: 'NL', 荷兰: 'NL',
  de: 'DE', deu: 'DE', germany: 'DE', 德国: 'DE',
  fr: 'FR', fra: 'FR', france: 'FR', 法国: 'FR',
  ch: 'CH', che: 'CH', switzerland: 'CH', 瑞士: 'CH',
}

function normalizeRegion(raw: string | undefined): Region | undefined {
  if (!raw) return undefined
  const key = raw.trim().toLowerCase()
  return REGION_ALIASES[key] ?? (VALID_REGIONS.includes(raw.trim() as Region) ? (raw.trim() as Region) : undefined)
}

interface RawRound {
  name?: string
  deadline?: string | null
  decision_by?: string | null
}

interface RawProgram {
  school_name_en?: string
  school_name_zh?: string | null
  school_short?: string | null
  region?: string
  program_name_en?: string
  program_name_zh?: string | null
  faculty?: string | null
  direction?: string
  duration_months?: number | null
  tuition?: string | null
  campus?: string | null
  requirements?: Record<string, unknown>
  deadlines?: {
    opens_at?: string | null
    rolling?: boolean | null
    rounds?: RawRound[] | null
    final_deadline?: string | null
    notes?: string | null
  }
  materials?: string[] | null
  source_urls?: string[]
  confidence?: string
  notes?: string | null
}

interface Stats {
  file: string
  read: number
  imported: number
  skipped: number
  cycleDowngraded: number
  /** 被识别为纯线上(通常不支持学生签证)的条数 */
  onlineFlagged: number
  reasons: string[]
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** HTML 实体还原 —— 采集自网页的文本常带 &amp; &gt; 等 */
function decodeEntities<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ') as T
  }
  if (Array.isArray(value)) return value.map(decodeEntities) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = decodeEntities(v)
    return out as T
  }
  return value
}

/**
 * 字段别名归一化。
 *
 * 不同采集批次对同一含义用了不同字段名(region/country、
 * school_name_zh/school_name_cn、materials/application_materials),
 * direction 也可能是 "Accounting & Finance" 这种自然语言而非枚举值。
 * 与其回头逐个改数据文件,不如让导入端兼容 —— 采集是持续的,
 * 归一化逻辑放在这里只写一次。
 */
const DIRECTION_ALIASES: Record<string, Direction> = {
  finance: 'finance',
  'accounting & finance': 'accounting',
  'accounting and finance': 'accounting',
  accounting: 'accounting',
  management: 'management',
  marketing: 'marketing',
  'business analytics': 'business_analytics',
  'business_analytics': 'business_analytics',
  economics: 'economics',
  'international business': 'international_business',
  'international_business': 'international_business',
  'supply chain': 'supply_chain',
  'supply_chain': 'supply_chain',
  'supply chain & operations': 'supply_chain',
  'hr management': 'hr',
  'human resource management': 'hr',
  hr: 'hr',
  'computer science': 'computer_science',
  computing: 'computer_science',
  'software engineering': 'computer_science',
  'data science': 'data_science_ai',
  'artificial intelligence': 'data_science_ai',
  ai: 'data_science_ai',
  engineering: 'engineering',
  technology: 'engineering',
  architecture: 'architecture',
  'built environment': 'architecture',
  'real estate': 'architecture',
  mathematics: 'mathematics_statistics',
  statistics: 'mathematics_statistics',
  'mathematics & statistics': 'mathematics_statistics',
  'natural sciences': 'natural_sciences',
  physics: 'natural_sciences',
  chemistry: 'natural_sciences',
  'earth sciences': 'natural_sciences',
  'life sciences': 'life_sciences_medicine',
  medicine: 'life_sciences_medicine',
  'health sciences': 'life_sciences_medicine',
  'social sciences': 'social_sciences',
  psychology: 'social_sciences',
  sociology: 'social_sciences',
  politics: 'social_sciences',
  media: 'media_communication',
  communication: 'media_communication',
  journalism: 'media_communication',
  law: 'law_public_policy',
  'public policy': 'law_public_policy',
  education: 'education',
  tesol: 'education',
  art: 'arts_design',
  arts: 'arts_design',
  design: 'arts_design',
  humanities: 'humanities',
  language: 'humanities',
  history: 'humanities',
  philosophy: 'humanities',
  environment: 'environment_sustainability',
  sustainability: 'environment_sustainability',
  agriculture: 'agriculture_food_science',
  'food science': 'agriculture_food_science',
  hospitality: 'hospitality_tourism',
  tourism: 'hospitality_tourism',
  'public health': 'public_health',
  other: 'other',
}

/**
 * 清理中文名里的译注。
 *
 * 采集 agent 会在译名后加「(本人翻译,非官方译名)」这类说明。
 * 这是负责任的标注,但不该出现在给用户看的专业名上 ——
 * 用户看到的应该是「金融经济学理学硕士」,不是一段元信息。
 */
function cleanName(v: string | null): string | null {
  if (!v) return null
  const cleaned = v
    // 全角/半角括号里含「翻译」「译名」「非官方」等字样的整体去掉
    .replace(/[（(][^）)]*(?:翻译|译名|非官方|暂译|自译)[^）)]*[）)]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || null
}

/**
 * 学费专用的对象 → 展示文本。
 *
 * ⚠️ 不能用通用的 asText:`tuition` 是**直接印在用户结果页上**的字段。
 *    通用展平会把采集时的内部记账字段原样推到前台,爱丁堡那 6 条就变成了
 *    「entry_year_of_data: 2026 entry; is_target_cycle: false; home_raw: …」——
 *    用户看到一串字段名,而且完全不知道自己该交多少钱。
 *
 *    所以这里只挑对申请人有意义的几项,其余(source_url / is_target_cycle /
 *    金额数值副本)本来就另有去处,直接丢掉。
 */
function tuitionToText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v !== 'object') return String(v)

  const o = v as Record<string, unknown>
  const str = (k: string): string | null => {
    const x = o[k]
    return typeof x === 'string' && x.trim() ? x.trim() : null
  }

  // 中国申请人交的是 international,放前面
  const intl = str('international_raw') ?? str('international') ?? str('overseas')
  const home = str('home_raw') ?? str('home')
  const parts = [intl, home].filter(Boolean)

  if (parts.length === 0) {
    // 认不出结构时宁可留空,也不要把字段名倒给用户 ——
    // 空值前台会显示「学费待补」,比一串乱码诚实
    return null
  }

  const year = str('entry_year_of_data')
  return year ? `${parts.join('; ')}(${year})` : parts.join('; ')
}

/** 强制转成字符串 —— 有的批次把字段写成了对象 */
function asText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    // 对象展平成 "key: value; key: value",保留全部信息交给运营核对
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== '')
      .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
    return parts.length ? parts.join('; ') : null
  }
  return String(v)
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'string' ? x : asText(x) ?? '')).filter(Boolean)
}

function normalizeRow(raw: Record<string, unknown>): RawProgram {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = raw[k]
      if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }

  const rawDirection = String(pick('direction') ?? '').trim().toLowerCase()
  const direction =
    DIRECTION_ALIASES[rawDirection] ??
    (VALID_DIRECTIONS.includes(rawDirection as Direction) ? (rawDirection as Direction) : undefined)

  return {
    // 有的批次把 school_name_en 写成了学院名,大学名放在 university_name_en
    school_name_en: asText(pick('university_name_en', 'school_name_en')) ?? undefined,
    school_name_zh: cleanName(asText(pick('school_name_zh', 'school_name_cn'))),
    school_short: asText(pick('school_short', 'school_abbr')),
    region: asText(pick('region', 'country')) ?? undefined,
    program_name_en: asText(pick('program_name_en', 'programme_name_en')) ?? undefined,
    program_name_zh: cleanName(asText(pick('program_name_zh', 'program_name_cn'))),
    faculty: asText(pick('faculty', 'school_name_en', 'department')),
    direction,
    duration_months: asNumber(pick('duration_months')),
    tuition: tuitionToText(pick('tuition', 'tuition_fee')),
    campus: asText(pick('campus', 'location')),
    requirements: (pick('requirements') as Record<string, unknown>) ?? {},
    deadlines: (pick('deadlines') as RawProgram['deadlines']) ?? {},
    materials: asStringArray(pick('materials', 'application_materials')),
    source_urls: asStringArray(pick('source_urls', 'sources')),
    confidence: asText(pick('confidence')) ?? undefined,
    notes: asText(pick('notes')),
  }
}

/**
 * 识别纯线上项目。
 *
 * 这类项目通常不支持学生签证 —— 学生以为自己在申请出国留学,
 * 实际拿到的是个远程学位。必须标出来。
 *
 * 判断依据是项目名、校区、备注里的线上关键词。宁可多标几个
 * (运营核对时能改回来),也不要漏标。
 */
function detectOnlineOnly(row: RawProgram): boolean {
  const haystack = [
    row.program_name_en,
    row.program_name_zh,
    row.campus,
    row.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // "on campus" / "blended" 明确说明有线下成分的,不算纯线上
  if (/blended|hybrid|on[-\s]?campus component/.test(haystack)) return false

  return /\(online\)|100% online|fully online|online program|distance learning|远程授课|纯线上|在线硕士/.test(
    haystack,
  )
}

/**
 * 过期周期兜底。返回清洗后的 deadlines 与是否发生降级。
 */
function sanitizeDeadlines(
  raw: RawProgram['deadlines'],
  today: Date,
): { deadlines: Record<string, unknown>; finalDeadline: Date | null; downgraded: boolean } {
  const d = raw ?? {}
  const rounds = (d.rounds ?? []).filter((r): r is RawRound => !!r)

  const finalDate = parseDate(d.final_deadline)
  const roundDates = rounds.map((r) => parseDate(r.deadline)).filter((x): x is Date => !!x)
  const allDates = [finalDate, ...roundDates].filter((x): x is Date => !!x)
  const latest = allDates.sort((a, b) => b.getTime() - a.getTime())[0]

  // 所有已知日期都在今天之前 → 这是上一届的周期,整条不能用
  const isStaleCycle = !!latest && latest < today

  if (!isStaleCycle) {
    /**
     * 即便整体周期没过期,单个日期仍可能是上一届残留
     * (常见于官网轮次表已更新、但 final deadline 那一行没同步)。
     *
     * `finalDeadline` 这一列是前端倒计时的数据源,**绝不能是过去的日期** ——
     * 否则用户会看到「还有 -20 天」。取所有已知日期里最早的那个**未来**日期;
     * 一个都没有就置 null,前端会显示「截止日待公布」。
     */
    const upcoming = allDates
      .filter((x) => x >= today)
      .sort((a, b) => a.getTime() - b.getTime())[0]

    const finalIsStale = !!finalDate && finalDate < today

    return {
      deadlines: {
        opens_at: d.opens_at ?? null,
        rolling: d.rolling ?? false,
        rounds,
        final_deadline: finalIsStale ? null : (d.final_deadline ?? null),
        notes: finalIsStale
          ? `【最终截止日期 ${d.final_deadline} 已过期,已置空】该日期可能是上一届残留,轮次表中仍有未来日期。${d.notes ?? ''}`
          : (d.notes ?? null),
      },
      finalDeadline: upcoming ?? null,
      downgraded: finalIsStale,
    }
  }

  const archived = [
    d.opens_at ? `开放:${d.opens_at}` : null,
    d.final_deadline ? `最终截止:${d.final_deadline}` : null,
    ...rounds.map((r) => (r.deadline ? `${r.name ?? '轮次'}:${r.deadline}` : null)),
  ]
    .filter(Boolean)
    .join(' / ')

  return {
    deadlines: {
      opens_at: null,
      rolling: d.rolling ?? false,
      rounds: [],
      final_deadline: null,
      notes:
        `【上一届周期,日期已置空】采集到的申请周期已过期,不可用于规划。` +
        `原始日期存档:${archived}。${d.notes ?? ''}`,
    },
    finalDeadline: null,
    downgraded: true,
  }
}

function normalizeConfidence(raw: string | undefined, downgraded: boolean): Confidence {
  // 无论采集端标了什么,导入后一律是「待人工核对」。
  // downgraded 的记录额外在 notes 里已注明,置信度同样是 ai_collected。
  void raw
  void downgraded
  return 'ai_collected'
}

async function importFile(path: string, fileName: string, today: Date): Promise<Stats> {
  const stats: Stats = {
    file: fileName, read: 0, imported: 0, skipped: 0,
    cycleDowngraded: 0, onlineFlagged: 0, reasons: [],
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    stats.reasons.push(`JSON 解析失败,整个文件跳过:${(err as Error).message}`)
    return stats
  }

  if (!Array.isArray(parsed)) {
    stats.reasons.push('顶层不是 JSON 数组,跳过')
    return stats
  }

  const decoded = decodeEntities(parsed as Record<string, unknown>[])
  const rows = decoded.map(normalizeRow)
  stats.read = rows.length

  for (const row of rows) {
    const schoolNameEn = row.school_name_en?.trim()
    const programNameEn = row.program_name_en?.trim()
    const region = normalizeRegion(row.region)
    const direction = row.direction as Direction

    // 必填校验 —— 缺关键字段的记录直接丢弃,不猜测补齐
    if (!schoolNameEn || !programNameEn) {
      stats.skipped += 1
      stats.reasons.push(`缺 school/program 名称:${programNameEn ?? schoolNameEn ?? '(空)'}`)
      continue
    }
    if (!region) {
      stats.skipped += 1
      stats.reasons.push(`region 无法识别(${row.region}):${programNameEn}`)
      continue
    }
    if (!VALID_DIRECTIONS.includes(direction)) {
      stats.skipped += 1
      stats.reasons.push(`direction 非法(${row.direction}):${programNameEn}`)
      continue
    }
    const sourceUrls = (row.source_urls ?? []).filter((u) => typeof u === 'string' && u.startsWith('http'))
    if (!sourceUrls.length) {
      stats.skipped += 1
      stats.reasons.push(`无官方来源链接:${programNameEn}`)
      continue
    }

    const school = await db.school.upsert({
      where: { nameEn_region: { nameEn: schoolNameEn, region } },
      create: {
        nameEn: schoolNameEn,
        nameZh: row.school_name_zh ?? null,
        shortName: row.school_short ?? null,
        region,
      },
      update: {
        nameZh: row.school_name_zh ?? undefined,
        shortName: row.school_short ?? undefined,
      },
    })

    const { deadlines, finalDeadline, downgraded } = sanitizeDeadlines(row.deadlines, today)
    if (downgraded) stats.cycleDowngraded += 1

    const isOnlineOnly = detectOnlineOnly(row)
    if (isOnlineOnly) stats.onlineFlagged += 1

    await db.program.upsert({
      where: { schoolId_nameEn: { schoolId: school.id, nameEn: programNameEn } },
      create: {
        schoolId: school.id,
        nameEn: programNameEn,
        nameZh: row.program_name_zh ?? null,
        faculty: row.faculty ?? null,
        direction,
        region,
        durationMonths: row.duration_months ?? null,
        tuition: row.tuition ?? null,
        campus: row.campus ?? null,
        requirements: (row.requirements ?? {}) as object,
        deadlines: deadlines as object,
        finalDeadline,
        isRolling: Boolean(row.deadlines?.rolling),
        isOnlineOnly,
        confidence: normalizeConfidence(row.confidence, downgraded),
        lastVerifiedAt: null, // ← 关键:必须经人工核对才置值
        sourceUrls,
        notes: row.notes ?? null,
      },
      update: {
        nameZh: row.program_name_zh ?? undefined,
        faculty: row.faculty ?? undefined,
        durationMonths: row.duration_months ?? undefined,
        tuition: row.tuition ?? undefined,
        campus: row.campus ?? undefined,
        requirements: (row.requirements ?? {}) as object,
        deadlines: deadlines as object,
        finalDeadline,
        isRolling: Boolean(row.deadlines?.rolling),
        isOnlineOnly,
        confidence: normalizeConfidence(row.confidence, downgraded),
        lastVerifiedAt: null,
        sourceUrls,
        notes: row.notes ?? undefined,
      },
    })

    stats.imported += 1
  }

  return stats
}

async function main() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let files: string[]
  try {
    files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json'))
  } catch {
    console.error(`找不到目录 ${RAW_DIR}`)
    process.exit(1)
  }

  if (!files.length) {
    console.log('data/raw 下没有 .json 文件,无事可做。')
    return
  }

  const all: Stats[] = []
  for (const f of files) {
    const s = await importFile(join(RAW_DIR, f), f, today)
    all.push(s)
    console.log(
      `${f.padEnd(24)} 读取 ${String(s.read).padStart(3)} · 导入 ${String(s.imported).padStart(3)} · ` +
      `跳过 ${String(s.skipped).padStart(2)} · 周期降级 ${String(s.cycleDowngraded).padStart(2)}`,
    )
    for (const r of s.reasons.slice(0, 5)) console.log(`    ↳ ${r}`)
    if (s.reasons.length > 5) console.log(`    ↳ …另有 ${s.reasons.length - 5} 条`)
  }

  const total = all.reduce(
    (acc, s) => ({
      read: acc.read + s.read,
      imported: acc.imported + s.imported,
      skipped: acc.skipped + s.skipped,
      downgraded: acc.downgraded + s.cycleDowngraded,
      online: acc.online + s.onlineFlagged,
    }),
    { read: 0, imported: 0, skipped: 0, downgraded: 0, online: 0 },
  )

  console.log('\n──────────────────────────────────────────')
  console.log(`共读取 ${total.read} 条,导入 ${total.imported} 条,跳过 ${total.skipped} 条`)
  console.log(`其中 ${total.downgraded} 条因申请周期已过期,截止日期已置空`)
  if (total.online > 0) {
    console.log(`     ${total.online} 条被识别为纯线上项目(通常不支持学生签证),已标记`)
  }
  console.log('')
  console.log('⚠️  全部记录已标记为 ai_collected / 待核对。')
  console.log('   在运营后台逐条核对并置 lastVerifiedAt 之前,')
  console.log('   前端只会以「待核实」状态展示,不会作为确定值。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
