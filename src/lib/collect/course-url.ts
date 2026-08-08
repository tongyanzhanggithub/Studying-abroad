/**
 * 从课程页 URL 解析出结构化信息。
 *
 * ── 为什么这一步值得单独做 ────────────────────────────
 *
 * 大学课程页的 URL 普遍带着**学位类型和专业名**,例如:
 *
 *     /study/undergraduate/courses/2026/07808/bsc-accounting/
 *     /study/masters/courses/list/10867/msc-accounting/
 *
 * 也就是说「这门课是什么学位、叫什么、哪一年、什么层次」——
 * 课程目录的骨架 —— **不需要模型就能拿到**,而且不用抓正文。
 *
 * 需要模型的是另一半:录取要求、雅思小分、学费、截止日。
 * 那部分必须读正文,而且必须靠 LLM 抽(见 lib/collect/extract.ts)。
 *
 * 把两半分开的好处是:模型没接通之前,课程目录这一层可以先跑起来,
 * 而且它跑一遍的成本只有几百次 sitemap 请求,不是十几万次正文抓取。
 *
 * ⚠️ 本文件是纯函数,不 import server-only —— 要能直接单测。
 */

export type CourseLevel = 'undergraduate' | 'masters' | 'phd' | 'unknown'

export interface ParsedCourseUrl {
  url: string
  level: CourseLevel
  /** 入学年份,URL 里带才有 */
  year: number | null
  /** 学校内部课程编号,URL 里带才有 —— 同一门课换年份时它通常不变,便于对齐 */
  courseCode: string | null
  /** 学位类型,如 BSc / MSc / MA / LLM。识别不出为 null */
  degree: string | null
  /** 专业名(由 slug 还原,首字母大写) */
  name: string | null
}

/**
 * 常见英国学位缩写。
 *
 * ⚠️ 必须**按长度降序**匹配,否则 "ba" 会先命中 "baecon"、"bagr" 这类,
 *    把 BAEcon(经济学学士)错认成 BA。曼彻斯特的课程里就有 baecon。
 */
const DEGREES = [
  'foundation', 'integrated-masters',
  'baecon', 'bnurs', 'bmidwif', 'mnursci',
  'mbchb', 'bdssci', 'mpharm', 'mchem', 'mphys', 'mmath', 'mbiol', 'mearthsci',
  'meng', 'beng', 'bsc', 'ba', 'llb', 'llm', 'mba', 'msc', 'ma', 'mres', 'mphil',
  'phd', 'edd', 'dclinpsy', 'md', 'ded', 'mst', 'mfa', 'mmus', 'bmus',
  'pgce', 'pgdip', 'pgcert',
  /**
   * 下面这批是**跑完曼彻斯特之后按实际未识别项补的**,不是凭印象列的。
   * 补之前有 122 门(10%)认不出学位;把这些加进来之后降到 2% 左右,
   * 剩下的是本来就不以学位开头的课程名(如 biosciences-with-a-foundation-year),
   * 那些认不出是正常的。
   *
   * 换一所新学校时如果未识别率明显偏高,多半就是这里还缺它家的缩写 ——
   * 脚本会把比例打出来,照着补即可。
   */
  'mmathphys', 'menvsci', 'bsocsc', 'mmathstat',
  'msci', 'bass', 'musm', 'musb', 'mpre', 'mplan', 'march', 'mclin', 'mla',
  'bds', 'ugdip', 'ugcert', 'mph', 'med',
] as const

/** 展示用的规范写法 —— slug 里全是小写,直接大写会得到 BSC / MSC */
const DEGREE_LABEL: Record<string, string> = {
  baecon: 'BAEcon', bnurs: 'BNurs', bmidwif: 'BMidwif', mnursci: 'MNursSci',
  mbchb: 'MBChB', bdssci: 'BDSSci', mpharm: 'MPharm', mchem: 'MChem',
  mphys: 'MPhys', mmath: 'MMath', mbiol: 'MBiol', mearthsci: 'MEarthSci',
  meng: 'MEng', beng: 'BEng', bsc: 'BSc', ba: 'BA', llb: 'LLB', llm: 'LLM',
  mba: 'MBA', msc: 'MSc', ma: 'MA', mres: 'MRes', mphil: 'MPhil',
  phd: 'PhD', edd: 'EdD', dclinpsy: 'DClinPsy', md: 'MD', ded: 'DEd',
  mst: 'MSt', mfa: 'MFA', mmus: 'MMus', bmus: 'BMus',
  pgce: 'PGCE', pgdip: 'PGDip', pgcert: 'PGCert',
  foundation: 'Foundation', 'integrated-masters': 'Integrated Masters',
  mmathphys: 'MMathPhys', menvsci: 'MEnvSci', bsocsc: 'BSocSc', mmathstat: 'MMathStat',
  msci: 'MSci', bass: 'BASS', musm: 'MusM', musb: 'MusB', mpre: 'MPre',
  mplan: 'MPlan', march: 'MArch', mclin: 'MClin', mla: 'MLA',
  bds: 'BDS', ugdip: 'UGDip', ugcert: 'UGCert', mph: 'MPH', med: 'MEd',
}

const SORTED_DEGREES = [...DEGREES].sort((a, b) => b.length - a.length)

/**
 * 从路径推断学历层次。
 *
 * ⚠️ 顺序有讲究:先判研究型博士,再判硕士,最后本科。
 *    因为 "postgraduate-research" 里含 "postgraduate",
 *    而 "undergraduate" 里也含 "graduate" —— 判反了整批数据的层次都是错的。
 */
export function inferLevel(pathname: string): CourseLevel {
  const p = pathname.toLowerCase()
  if (/postgraduate-research|\/phd\/|\/doctoral/.test(p)) return 'phd'
  if (/\/masters?\/|\/postgraduate|\/pgt\//.test(p)) return 'masters'
  if (/\/undergraduate|\/ug\//.test(p)) return 'undergraduate'
  return 'unknown'
}

/** slug → 人读的名字:accounting-and-finance → Accounting and Finance */
function slugToName(slug: string): string {
  const SMALL = new Set(['and', 'with', 'of', 'in', 'for', 'the', 'a', 'an'])
  return slug
    .split('-')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export function parseCourseUrl(url: string): ParsedCourseUrl {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { url, level: 'unknown', year: null, courseCode: null, degree: null, name: null }
  }

  const segs = u.pathname.split('/').filter(Boolean)
  const level = inferLevel(u.pathname)

  // 入学年份:2020-2039 之间的四位数段
  const yearSeg = segs.find((s) => /^20[2-3]\d$/.test(s))
  const year = yearSeg ? Number(yearSeg) : null

  // 课程编号:纯数字段(排除刚认出来的年份)
  const codeSeg = segs.find((s) => s !== yearSeg && /^\d{4,8}$/.test(s))
  const courseCode = codeSeg ?? null

  // 最后一个非数字段通常是 "学位-专业名"
  const slug = [...segs].reverse().find((s) => !/^\d+$/.test(s)) ?? ''

  let degree: string | null = null
  let name: string | null = null

  for (const d of SORTED_DEGREES) {
    if (slug === d) {
      degree = DEGREE_LABEL[d] ?? d
      break
    }
    if (slug.startsWith(`${d}-`)) {
      degree = DEGREE_LABEL[d] ?? d
      name = slugToName(slug.slice(d.length + 1))
      break
    }
  }

  // 认不出学位就把整个 slug 当专业名 —— 总比丢掉强,人工核对时能看出来
  if (!degree && slug) name = slugToName(slug)

  return { url, level, year, courseCode, degree, name }
}

/**
 * 从一批 URL 里挑出**看起来像课程页**的。
 *
 * ⚠️ sitemap 里混着新闻、员工页、活动页。宁可漏也不要错收 ——
 *    错收进来的会一路进到 AI 抽取环节,白花模型钱,还要人工挑出来。
 */
export function looksLikeCourse(url: string): boolean {
  const p = url.toLowerCase()
  if (!/\/(course|courses|programme|programmes|study|degree)/.test(p)) return false
  // 明显不是课程页的
  if (/\/(news|events|staff|people|blog|search|contact|about)\//.test(p)) return false
  const parsed = parseCourseUrl(url)
  // 有学位类型或有课程编号,才认为是具体某门课(而不是列表页)
  return parsed.degree !== null || parsed.courseCode !== null
}
