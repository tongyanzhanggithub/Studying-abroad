/**
 * 课程目录发现 —— 走 sitemap,不抓正文,不用模型。
 *
 *   npx tsx scripts/discover-courses.ts                 # 跑注册表里全部院校
 *   npx tsx scripts/discover-courses.ts manchester      # 只跑一所
 *   npx tsx scripts/discover-courses.ts --list-sitemaps manchester
 *
 * ── 这个脚本做什么、不做什么 ──────────────────────────
 *
 * 做:把每所大学**有哪些课**捞全 —— 课程 URL、学位类型、专业名、层次、年份。
 *     这些信息 URL 里就带着,不需要抓正文,也不需要模型。
 *     一所大学两三次 sitemap 请求就能拿到几百门课。
 *
 * 不做:录取要求、雅思小分、学费、截止日。那些必须读正文 + 用 LLM 抽
 *       (lib/collect/extract.ts),而 LLM_PROVIDER 目前是 mock。
 *
 * 分成两步是刻意的:目录这一层现在就能跑完并人工过目,
 * 而抓正文那一步一旦启动就是十几万次请求 + 真金白银的模型开销,
 * 得先知道目录里到底有什么、有多少,才谈得上放量。
 *
 * ⚠️ 所有请求都走 lib/collect/politeness.ts:遵守 robots.txt、按站点限速。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { discoverSitemaps, fetchSitemapUrls } from '../src/lib/collect/sitemap'
import { parseCourseUrl, looksLikeCourse, type CourseLevel } from '../src/lib/collect/course-url'

interface University {
  slug: string
  name: string
  nameZh: string
  origin: string
  /** 已知的课程 sitemap 关键词 —— 留空则自动从全部 sitemap 里筛 */
  sitemapHints?: string[]
}

const ROOT = process.cwd()
const REGISTRY = join(ROOT, 'data', 'uk-universities.json')
const OUT_DIR = join(ROOT, 'data', 'courses')

/** 判断一个 sitemap 是否可能装着课程页 */
function looksLikeCourseSitemap(url: string, hints?: string[]): boolean {
  const u = url.toLowerCase()
  if (hints?.length) return hints.some((h) => u.includes(h.toLowerCase()))
  return /course|programme|study|degree|undergraduate|postgraduate|master/.test(u)
}

async function runOne(uni: University, listOnly: boolean) {
  console.log(`\n${'='.repeat(60)}\n${uni.nameZh} ${uni.name}\n${uni.origin}`)

  const { sitemaps, notes } = await discoverSitemaps(uni.origin)
  for (const n of notes) console.log(`  · ${n}`)

  if (!sitemaps.length) {
    console.log('  !! 没有找到任何 sitemap —— 这所学校要单独处理')
    return null
  }

  const candidates = sitemaps.filter((s) => looksLikeCourseSitemap(s, uni.sitemapHints))
  console.log(`  找到 ${sitemaps.length} 个 sitemap,其中 ${candidates.length} 个可能是课程`)

  if (listOnly) {
    for (const s of sitemaps) {
      console.log(`    ${candidates.includes(s) ? '[课程?]' : '       '} ${s}`)
    }
    return null
  }

  const seen = new Set<string>()
  const courses: ReturnType<typeof parseCourseUrl>[] = []

  for (const sm of candidates) {
    const urls = await fetchSitemapUrls(sm)
    const kept = urls.filter((u) => !seen.has(u) && looksLikeCourse(u))
    for (const u of kept) {
      seen.add(u)
      courses.push(parseCourseUrl(u))
    }
    console.log(`    ${urls.length} 条 → 认作课程 ${kept.length} 条  ${sm.replace(uni.origin, '')}`)
  }

  const byLevel = new Map<CourseLevel, number>()
  const byYear = new Map<string, number>()
  for (const c of courses) {
    byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + 1)
    const y = c.year ? String(c.year) : '未标年份'
    byYear.set(y, (byYear.get(y) ?? 0) + 1)
  }

  console.log(`  合计 ${courses.length} 门`)
  console.log(`    按层次:${[...byLevel].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  console.log(`    按年份:${[...byYear].sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  const noDegree = courses.filter((c) => !c.degree).length
  if (noDegree) {
    console.log(`    ⚠️ 有 ${noDegree} 门认不出学位类型(占 ${Math.round((noDegree / courses.length) * 100)}%)`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const out = join(OUT_DIR, `${uni.slug}.json`)
  writeFileSync(
    out,
    JSON.stringify(
      {
        university: { name: uni.name, nameZh: uni.nameZh, origin: uni.origin },
        discoveredAt: new Date().toISOString(),
        总数: courses.length,
        courses,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`  已写入 ${out.replace(ROOT, '.')}`)

  return { slug: uni.slug, total: courses.length }
}

async function main() {
  const args = process.argv.slice(2)
  const listOnly = args.includes('--list-sitemaps')
  const only = args.filter((a) => !a.startsWith('--'))

  if (!existsSync(REGISTRY)) {
    console.error(`找不到院校注册表:${REGISTRY}`)
    process.exit(1)
  }

  const all: University[] = JSON.parse(readFileSync(REGISTRY, 'utf8'))
  const targets = only.length ? all.filter((u) => only.includes(u.slug)) : all

  if (!targets.length) {
    console.error(`注册表里没有:${only.join(', ')}`)
    console.error(`可选:${all.map((u) => u.slug).join(', ')}`)
    process.exit(1)
  }

  const results: Array<{ slug: string; total: number }> = []
  for (const uni of targets) {
    try {
      const r = await runOne(uni, listOnly)
      if (r) results.push(r)
    } catch (e) {
      console.error(`  !! ${uni.slug} 失败:${(e as Error).message}`)
    }
  }

  if (results.length > 1) {
    console.log(`\n${'='.repeat(60)}\n汇总`)
    for (const r of results) console.log(`  ${r.slug.padEnd(20)} ${r.total} 门`)
    console.log(`  合计 ${results.reduce((s, r) => s + r.total, 0)} 门`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
