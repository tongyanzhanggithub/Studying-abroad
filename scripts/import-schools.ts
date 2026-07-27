/**
 * 批量建校 + 回填排名(Phase 1)
 *
 *   npm run schools:import
 *   (PGlite 单连接:先 Ctrl+C 停掉 dev server 再跑)
 *
 * ── 这个脚本做什么 ──────────────────────────────────────
 * 吃 `data/schools/*.json` 里的目标校清单,建/更新 School 记录 + 写入排名
 * (SchoolRanking 支持多年份、多榜单:qs / the / arwu / us_news)。
 * **只建学校与排名,不建项目** —— 项目数据走 /admin/collect 的采集流水线
 * (AI 抽取 + 人工核对),不在这里生成。
 *
 * ── 数据准确红线(PRD 4.2)──────────────────────────────
 * 早先库里的 QS 排名是凭记忆填的,抽查 6 所错了 5 所,已全部清空重来。
 * 所以本脚本强制:**排名是数字就必须带 source_url**,否则那条排名直接丢弃并告警。
 * rank 允许为 null(表示该榜未收录 / 只给区间如 801-850)—— 宁可不显示,绝不编数字。
 *
 * ⚠️ name_en 必须和库里**一模一样**,否则不是「更新」而是「新建一所重名学校」。
 *    典型坑:牛津/剑桥在库里是商学院条目(见 data/schools/README.md),
 *    写 "University of Oxford" 会凭空多出一所没有任何项目的空壳学校。
 *
 * ── 输入格式(data/schools/*.json,每个文件是一个数组)──────
 * [
 *   {
 *     "name_en": "University of Oxford",     // 必填,与采集/项目导入用的 school_name_en 一致
 *     "name_zh": "牛津大学",                  // 选填
 *     "short_name": "Oxford",                // 选填
 *     "region": "UK",                        // 必填,支持别名(见 REGION_ALIASES)
 *     "rankings": [                          // 选填,可多条(多年 + 多榜)
 *       { "provider": "qs",      "year": 2026, "rank": 3,    "rank_text": "3",  "source_url": "https://..." },
 *       { "provider": "us_news", "year": 2025, "rank": 5,    "rank_text": "5",  "source_url": "https://..." },
 *       { "provider": "qs",      "year": 2022, "rank": null, "rank_text": "range", "source_url": "https://..." }
 *     ]
 *   }
 * ]
 *
 * 幂等:可重复执行。School 按 (name_en, region) 去重,排名按 (school, provider, year) 去重。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PrismaClient, type Region, type RankingProvider } from '@prisma/client'

const db = new PrismaClient()

const SCHOOLS_DIR = join(process.cwd(), 'data', 'schools')

// ── 地区归一化(与 import-programs 保持一致)────────────────
const VALID_REGIONS: Region[] = [
  'UK', 'HK', 'SG', 'AU', 'CA', 'MO', 'JP', 'KR', 'NZ', 'IE', 'NL', 'DE', 'FR', 'CH', 'US',
]
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
  us: 'US', usa: 'US', 'united states': 'US', america: 'US', 美国: 'US',
}
function normalizeRegion(raw: string | undefined): Region | undefined {
  if (!raw) return undefined
  const key = raw.trim().toLowerCase()
  return REGION_ALIASES[key] ?? (VALID_REGIONS.includes(raw.trim() as Region) ? (raw.trim() as Region) : undefined)
}

const VALID_PROVIDERS: RankingProvider[] = ['qs', 'the', 'arwu', 'us_news']

interface RankingInput {
  provider?: string
  year?: number
  rank?: number | null
  rank_text?: string | null
  source_url?: string | null
}
interface SchoolInput {
  name_en?: string
  name_zh?: string | null
  short_name?: string | null
  region?: string
  rankings?: RankingInput[]
}

interface Stats {
  file: string
  read: number
  created: number
  updated: number
  ranksWritten: number
  skipped: number
  reasons: string[]
}

async function importFile(path: string, fileName: string): Promise<Stats> {
  const stats: Stats = { file: fileName, read: 0, created: 0, updated: 0, ranksWritten: 0, skipped: 0, reasons: [] }

  let rows: unknown
  try {
    rows = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    stats.reasons.push(`JSON 解析失败,整个文件跳过:${(err as Error).message}`)
    return stats
  }
  if (!Array.isArray(rows)) {
    stats.reasons.push('顶层不是 JSON 数组,跳过')
    return stats
  }
  stats.read = rows.length

  for (const raw of rows as SchoolInput[]) {
    const nameEn = raw.name_en?.trim()
    const region = normalizeRegion(raw.region)

    if (!nameEn) {
      stats.skipped += 1
      stats.reasons.push('缺 name_en,跳过一条')
      continue
    }
    if (!region) {
      stats.skipped += 1
      stats.reasons.push(`region 无法识别(${raw.region ?? '空'})${raw.region?.trim().toLowerCase() === 'us' ? ' —— US 尚未进 Region 枚举,见 Phase 4' : ''}:${nameEn}`)
      continue
    }

    // 先算出这条学校最新一届 QS 排名,回填到 School 的冗余字段(UI 用它显示)
    const qsRankings = (raw.rankings ?? [])
      .filter((r) => r.provider?.toLowerCase() === 'qs' && typeof r.rank === 'number' && r.source_url)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    const latestQs = qsRankings[0]

    const existing = await db.school.findUnique({
      where: { nameEn_region: { nameEn, region } },
      select: { id: true },
    })

    const school = await db.school.upsert({
      where: { nameEn_region: { nameEn, region } },
      create: {
        nameEn,
        nameZh: raw.name_zh?.trim() || null,
        shortName: raw.short_name?.trim() || null,
        region,
        qsRank: latestQs?.rank ?? null,
        qsRankYear: latestQs?.year ?? null,
        qsRankSourceUrl: latestQs?.source_url ?? null,
      },
      update: {
        // 只在提供了新值时覆盖,不用空值冲掉已有内容
        nameZh: raw.name_zh?.trim() || undefined,
        shortName: raw.short_name?.trim() || undefined,
        ...(latestQs
          ? { qsRank: latestQs.rank, qsRankYear: latestQs.year, qsRankSourceUrl: latestQs.source_url }
          : {}),
      },
    })
    if (existing) stats.updated += 1
    else stats.created += 1

    // 写入所有排名(多年 + 多榜)
    for (const r of raw.rankings ?? []) {
      const provider = r.provider?.toLowerCase() as RankingProvider | undefined
      if (!provider || !VALID_PROVIDERS.includes(provider)) {
        stats.reasons.push(`排名 provider 非法(${r.provider})跳过:${nameEn}`)
        continue
      }
      if (typeof r.year !== 'number') {
        stats.reasons.push(`排名缺 year 跳过:${nameEn} / ${provider}`)
        continue
      }
      // ⚠️ 红线:有名次数字就必须带来源,否则不写(防凭记忆编排名)
      if (typeof r.rank === 'number' && !r.source_url?.trim()) {
        stats.reasons.push(`排名有数字但无 source_url,已丢弃(数据红线):${nameEn} / ${provider} ${r.year} = ${r.rank}`)
        continue
      }

      await db.schoolRanking.upsert({
        where: { schoolId_provider_year: { schoolId: school.id, provider, year: r.year } },
        create: {
          schoolId: school.id,
          provider,
          year: r.year,
          rank: typeof r.rank === 'number' ? r.rank : null,
          rankText: r.rank_text?.trim() || null,
          sourceUrl: r.source_url?.trim() || null,
        },
        update: {
          rank: typeof r.rank === 'number' ? r.rank : null,
          rankText: r.rank_text?.trim() || null,
          sourceUrl: r.source_url?.trim() || null,
        },
      })
      stats.ranksWritten += 1
    }
  }

  return stats
}

async function main() {
  let files: string[]
  try {
    files = (await readdir(SCHOOLS_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  } catch {
    console.log(`没有找到 ${SCHOOLS_DIR} 目录。`)
    console.log('把目标校清单(格式见本脚本头部注释)放进 data/schools/*.json 再跑。')
    await db.$disconnect()
    return
  }
  if (files.length === 0) {
    console.log('data/schools 下没有 .json 文件,无事可做。')
    console.log('参考 data/schools/_example.json 的格式准备清单。')
    await db.$disconnect()
    return
  }

  const all: Stats[] = []
  for (const f of files) {
    const s = await importFile(join(SCHOOLS_DIR, f), f)
    all.push(s)
    console.log(
      `${f.padEnd(28)} 读取 ${String(s.read).padStart(3)} · 新建 ${String(s.created).padStart(3)} · ` +
      `更新 ${String(s.updated).padStart(3)} · 排名 ${String(s.ranksWritten).padStart(3)} · 跳过 ${String(s.skipped).padStart(2)}`,
    )
    for (const r of s.reasons.slice(0, 8)) console.log(`    ↳ ${r}`)
    if (s.reasons.length > 8) console.log(`    ↳ …另有 ${s.reasons.length - 8} 条`)
  }

  const sum = all.reduce(
    (a, s) => ({
      read: a.read + s.read, created: a.created + s.created,
      updated: a.updated + s.updated, ranks: a.ranks + s.ranksWritten, skipped: a.skipped + s.skipped,
    }),
    { read: 0, created: 0, updated: 0, ranks: 0, skipped: 0 },
  )
  console.log('──────────────────────────────────────────')
  console.log(`共读取 ${sum.read} 所,新建 ${sum.created},更新 ${sum.updated},写入排名 ${sum.ranks} 条,跳过 ${sum.skipped}`)
  console.log('')
  console.log('下一步:这些学校还没有任何项目。到 /admin/collect 用采集流水线逐校采项目,')
  console.log('AI 抽取 → 人工核对 → 达标后在 /admin/regions 开放对应地区。')

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
