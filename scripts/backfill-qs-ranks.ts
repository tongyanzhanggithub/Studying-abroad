/**
 * 回填 QS 世界大学排名(核实版)
 *   1. 先停掉 dev server(PGlite 单连接),再 `npx tsx scripts/backfill-qs-ranks.ts`
 *
 * ── 为什么有这个脚本 ──────────────────────────────────────
 * 早先库里的 QS 排名是凭记忆填的,抽查 6 所错了 5 所,已全部清空。
 * 「数据准确性是本产品的生命线」(PRD 4.2)—— 给潜在客户看的排名一旦造假就是法律风险。
 * 所以这里的每一个数字都必须是**联网核实过、带来源链接**的,来源统一记进 qsRankSourceUrl。
 *
 * 只写「有确切名次」的学校。凡是 QS 未收录、或只给区间(如 801-850)的,
 * qsRank 留空 —— 宁可不显示,也绝不编一个数字。
 *
 * 按 nameEn 匹配(与 data/raw 导入时的 school_name_en 一致)。
 * 跑完会打印:已更新 / 库里有但清单没覆盖 / 清单有但库里没找到,三类都列出来便于查漏。
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface QsRank {
  nameEn: string
  qsRank: number | null
  /** QS 榜单原文名次(如 "=54"、"801-850"),仅作核对留痕,不入库 */
  qsRankText: string | null
  qsYear: number
  sourceUrl: string
}

/**
 * ⚠️ 全部联网核实,来源见 sourceUrl。qsRank=null 表示 QS 未收录或仅有区间,
 *    按红线不填数字。
 */
const RANKS: QsRank[] = [
  // ── 英国 ──
  { nameEn: 'University of Oxford', qsRank: 4, qsRankText: '4', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-oxford' },
  { nameEn: 'University of Cambridge', qsRank: 6, qsRankText: '6', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-cambridge' },
  { nameEn: 'Imperial College London', qsRank: 2, qsRankText: '=2', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/imperial-college-london' },
  { nameEn: 'University College London', qsRank: 8, qsRankText: '=8', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-college-london' },
  { nameEn: "King's College London", qsRank: 37, qsRankText: '37', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/kings-college-london' },
  { nameEn: 'The University of Manchester', qsRank: 40, qsRankText: '=40', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-manchester' },
  { nameEn: 'University of Bristol', qsRank: 57, qsRankText: '57', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-bristol' },
  { nameEn: 'The London School of Economics and Political Science', qsRank: 62, qsRankText: '62', qsYear: 2027, sourceUrl: 'https://www.qs-topuniversities.cn/en/universities/london-school-economics-political-science-lse' },
  { nameEn: 'University of Warwick', qsRank: 68, qsRankText: '=68', qsYear: 2027, sourceUrl: 'https://warwick.ac.uk/news/pressreleases/university-of-warwick-rises-to-68th-in-qs-world-university-rankings1/' },
  { nameEn: 'University of Birmingham', qsRank: 68, qsRankText: '=68', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-birmingham' },
  { nameEn: 'University of Leeds', qsRank: 77, qsRankText: '=77', qsYear: 2027, sourceUrl: 'https://www.leeds.ac.uk/news-global/news/article/5980/leeds-strengthens-global-top-100-position' },
  { nameEn: 'University of Glasgow', qsRank: 80, qsRankText: '80', qsYear: 2027, sourceUrl: 'https://www.gla.ac.uk/news/headline_1278197_en.html' },
  { nameEn: 'University of Sheffield', qsRank: 82, qsRankText: '=82', qsYear: 2027, sourceUrl: 'https://sheffield.ac.uk/news/university-sheffield-strengthens-top-100-global-standing-10-place-rise-qs-world-university-rankings' },
  { nameEn: 'Durham University', qsRank: 85, qsRankText: '85', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/durham-university' },
  { nameEn: 'University of Nottingham', qsRank: 97, qsRankText: '97', qsYear: 2027, sourceUrl: 'https://www.nottingham.ac.uk/news/nottingham-named-once-again-among-worlds-top-100-universities' },
  { nameEn: 'University of Southampton', qsRank: 111, qsRankText: '=111', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-southampton' },
  { nameEn: 'University of Bath', qsRank: 125, qsRankText: '125', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-bath' },
  { nameEn: 'University of Exeter', qsRank: 136, qsRankText: '136', qsYear: 2027, sourceUrl: 'https://news.exeter.ac.uk/staff-news/exeter-achieves-highest-ever-position-in-qs-world-university-rankings/' },
  { nameEn: 'University of Liverpool', qsRank: 139, qsRankText: '139', qsYear: 2027, sourceUrl: 'https://news.liverpool.ac.uk/2026/06/18/university-breaks-into-top-140-in-qs-world-rankings-2027/' },
  { nameEn: 'Lancaster University', qsRank: 164, qsRankText: '164', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/lancaster-university' },
  // 爱丁堡大学商学院:QS 只排整所大学,取爱丁堡大学的综合名次
  { nameEn: 'University of Edinburgh Business School', qsRank: 35, qsRankText: '35', qsYear: 2027, sourceUrl: 'https://xuanxiao.org/en/universities/university-of-edinburgh' },

  // ── 爱尔兰 ──
  { nameEn: 'Trinity College Dublin', qsRank: 75, qsRankText: '75', qsYear: 2027, sourceUrl: 'https://www.tcd.ie/news_events/articles/2026/trinityholds-75thpositionin-qs-world-university-rankings/' },
  { nameEn: 'University College Dublin', qsRank: 100, qsRankText: '=100', qsYear: 2027, sourceUrl: 'https://www.ucd.ie/newsandopinion/news/2026/june/18/ucdjoinsworldstop100universitiesinlatestqsrankings/' },

  // ── 中国香港 / 新加坡 / 中国澳门 ──
  { nameEn: 'The University of Hong Kong', qsRank: 11, qsRankText: '11', qsYear: 2027, sourceUrl: 'https://www.hku.hk/press/press-releases/detail/29178.html' },
  { nameEn: 'The Chinese University of Hong Kong', qsRank: 18, qsRankText: '18', qsYear: 2027, sourceUrl: 'https://www.cpr.cuhk.edu.hk/en/press/cuhk-ranks-18th-in-qs-world-university-rankings-2027-advancement-in-international-reputation-employer-reputation-and-global-engagement/' },
  { nameEn: 'The Hong Kong University of Science and Technology', qsRank: 33, qsRankText: '33', qsYear: 2027, sourceUrl: 'https://hkust.edu.hk/news/hkust-leaps-11-places-rank-33rd-globally-qs-world-university-rankings-2027' },
  { nameEn: 'The Hong Kong Polytechnic University', qsRank: 50, qsRankText: '50', qsYear: 2027, sourceUrl: 'https://www.polyu.edu.hk/media/media-releases/2026/0618_polyu-rises-steadily-in-the-latest-qs-world-university-rankings-global-top-50/' },
  { nameEn: 'City University of Hong Kong', qsRank: 52, qsRankText: '52', qsYear: 2027, sourceUrl: 'https://www.cityu.edu.hk/media/press-release/2026/06/18/cityuhk-leaps-to-52nd-globally-in-qs-world-university-rankings-2027' },
  { nameEn: 'Hong Kong Baptist University', qsRank: 216, qsRankText: '216', qsYear: 2027, sourceUrl: 'https://collegedunia.com/hong-kong/university/719-hong-kong-baptist-university-kowloon-tong/ranking' },
  { nameEn: 'National University of Singapore', qsRank: 10, qsRankText: '10', qsYear: 2027, sourceUrl: 'https://www.ntu.edu.sg/sss/news-events/news/detail/nus-remains-in-top-ten-of-2027-qs-world-university-rankings' },
  { nameEn: 'Nanyang Technological University', qsRank: 12, qsRankText: '12', qsYear: 2027, sourceUrl: 'https://www.ntu.edu.sg/news/detail/ntu-singapore-ranks-12th-in-qs-world-university-rankings-2027' },
  { nameEn: 'Singapore Management University', qsRank: 411, qsRankText: '=411', qsYear: 2027, sourceUrl: 'https://qs-topuniversities.cn/en/universities/singapore-management-university' },
  { nameEn: 'University of Macau', qsRank: 267, qsRankText: '267', qsYear: 2027, sourceUrl: 'https://qs-topuniversities.cn/en/universities/university-macau' },
  { nameEn: 'Macau University of Science and Technology', qsRank: 398, qsRankText: '=398', qsYear: 2027, sourceUrl: 'https://qs-topuniversities.cn/en/universities/macau-university-science-technology' },

  // ── 澳大利亚 / 加拿大 ──
  { nameEn: 'University of New South Wales', qsRank: 19, qsRankText: '19', qsYear: 2027, sourceUrl: 'https://www.unsw.edu.au/newsroom/news/2026/06/unsw-claims-australias-top-spot-for-the-first-time-in-preeminent-world-university-rankings' },
  { nameEn: 'University of Sydney', qsRank: 28, qsRankText: '28', qsYear: 2027, sourceUrl: 'https://www.sydney.edu.au/about-us/our-world-rankings.html' },
  { nameEn: 'Australian National University', qsRank: 29, qsRankText: '29', qsYear: 2027, sourceUrl: 'https://www.anu.edu.au/news/all-news/anu-climbs-in-qs-world-university-rankings' },
  { nameEn: 'McGill University', qsRank: 30, qsRankText: '30', qsYear: 2027, sourceUrl: 'https://reporter.mcgill.ca/mcgill-remains-canadas-top-university-in-2027-qs-world-university-rankings/' },
  { nameEn: 'University of Toronto', qsRank: 32, qsRankText: '32', qsYear: 2027, sourceUrl: 'https://academica.ca/top-ten/qs-world-university-rankings-2027-released/' },
  { nameEn: 'University of British Columbia', qsRank: 45, qsRankText: '45', qsYear: 2027, sourceUrl: 'https://academica.ca/top-ten/qs-world-university-rankings-2027-released/' },
  { nameEn: 'Western University', qsRank: 142, qsRankText: '=142', qsYear: 2027, sourceUrl: 'https://news.westernu.ca/2026/06/western-qs-world-rankings/' },
  { nameEn: 'McMaster University', qsRank: 174, qsRankText: '=174', qsYear: 2027, sourceUrl: 'https://www.narcity.com/university-of-toronto-best-universities-world-ranking-2027-mcgill-ubc' },
  { nameEn: 'York University', qsRank: 322, qsRankText: '=322', qsYear: 2027, sourceUrl: 'https://www.yorku.ca/news/2026/06/18/york-university-climbs-11-spots-in-todays-qs-world-university-rankings/' },

  // ── 日本 / 韩国 ──
  { nameEn: 'Seoul National University', qsRank: 38, qsRankText: '38', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/seoul-national-university' },
  { nameEn: 'University of Tokyo', qsRank: 39, qsRankText: '39', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/university-tokyo' },
  { nameEn: 'Yonsei University', qsRank: 42, qsRankText: '42', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/yonsei-university' },
  { nameEn: 'Korea University', qsRank: 52, qsRankText: '=52', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/korea-university' },
  { nameEn: 'KAIST', qsRank: 65, qsRankText: '65', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/kaist-korea-advanced-institute-science-technology' },
  { nameEn: 'Waseda University', qsRank: 201, qsRankText: '=201', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/waseda-university' },
  { nameEn: 'Keio University', qsRank: 213, qsRankText: '=213', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/keio-university' },

  // ── 欧洲大陆 ──
  { nameEn: 'Technical University of Munich', qsRank: 25, qsRankText: '25', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/technical-university-munich' },
  { nameEn: 'Delft University of Technology', qsRank: 48, qsRankText: '48', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/delft-university-technology' },
  { nameEn: 'University of Amsterdam', qsRank: 60, qsRankText: '60', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/university-amsterdam' },
  { nameEn: 'Erasmus University Rotterdam', qsRank: 148, qsRankText: '148', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/erasmus-university-rotterdam' },
  { nameEn: 'University of Mannheim', qsRank: 425, qsRankText: '=425', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/universitat-mannheim' },
  { nameEn: 'Tilburg University', qsRank: 429, qsRankText: '429', qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/tilburg-university' },
  // Frankfurt School:QS 世界排名未收录(只有分学科区间),按红线留空、不显示
  { nameEn: 'Frankfurt School of Finance & Management', qsRank: null, qsRankText: null, qsYear: 2027, sourceUrl: 'https://www.topuniversities.com/universities/frankfurt-school-finance-management' },
]

async function main() {
  const schools = await db.school.findMany({ select: { id: true, nameEn: true, region: true } })
  const byName = new Map(schools.map((s) => [s.nameEn, s]))

  const updated: string[] = []
  const skippedNoRank: string[] = []
  const notFound: string[] = []
  const now = new Date()

  for (const r of RANKS) {
    const school = byName.get(r.nameEn)
    if (!school) {
      notFound.push(r.nameEn)
      continue
    }
    if (r.qsRank === null) {
      skippedNoRank.push(`${r.nameEn}（${r.qsRankText ?? 'QS 未收录'}）`)
      continue
    }
    await db.school.update({
      where: { id: school.id },
      data: {
        qsRank: r.qsRank,
        qsRankYear: r.qsYear,
        qsRankSourceUrl: r.sourceUrl,
        updatedAt: now,
      },
    })
    updated.push(`${r.nameEn} → QS ${r.qsYear} #${r.qsRank}`)
  }

  const coveredNames = new Set(RANKS.map((r) => r.nameEn))
  const uncovered = schools.filter((s) => !coveredNames.has(s.nameEn)).map((s) => `${s.nameEn}（${s.region}）`)

  console.log(`\n✓ 已更新 ${updated.length} 所：`)
  updated.forEach((x) => console.log('   ' + x))
  if (skippedNoRank.length) {
    console.log(`\n· 跳过 ${skippedNoRank.length} 所（QS 无确切名次，按红线不填）：`)
    skippedNoRank.forEach((x) => console.log('   ' + x))
  }
  if (notFound.length) {
    console.log(`\n⚠ 清单里有、但库里没匹配到 ${notFound.length} 所（检查 nameEn 是否一致）：`)
    notFound.forEach((x) => console.log('   ' + x))
  }
  if (uncovered.length) {
    console.log(`\n⚠ 库里有、但本次清单没覆盖 ${uncovered.length} 所（还需核实）：`)
    uncovered.forEach((x) => console.log('   ' + x))
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
