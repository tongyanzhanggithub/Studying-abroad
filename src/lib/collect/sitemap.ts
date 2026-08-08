/**
 * ⚠️ 这里**刻意不加 `server-only`**。
 *
 *    批量采集要能从命令行脚本跑(scripts/discover-courses.ts)——
 *    十几万门课不可能靠后台页面一条条点。而 `server-only` 在 Next 运行时
 *    之外会直接抛错,加了就等于把批量这条路堵死。
 *
 *    安全上不依赖它:这个文件不碰数据库、不读密钥,真正的防护是
 *    SSRF 校验(fetch.ts)与礼貌层本身。它也从来没有被客户端组件引用过。
 */
import { awaitPoliteSlot } from './politeness'

/**
 * 基于 sitemap 的课程发现。
 *
 * ── 为什么走 sitemap,而不是爬列表页 ──────────────────
 *
 * 原来的 discoverProgramLinks 是从课程列表页里抓 <a>。要覆盖上百所大学时
 * 这条路有三个问题:列表页普遍分页且结构各不相同、要发成百上千次请求、
 * HTML 一改就全崩。
 *
 * 而绝大多数大学在 robots.txt 里**主动公布了 sitemap** —— 那是站点自己
 * 维护的 URL 全集,专门给爬虫用的。以曼彻斯特为例,它的 sitemap index 里
 * 直接按年份和层次分好了:
 *
 *     study/undergraduate/courses/2026/sitemap.xml   406 门
 *     study/masters/courses/list/sitemap.xml         319 门
 *
 * 两次请求拿到 725 门课的完整 URL,而爬列表页要几十次请求还不保证全。
 * 请求量小两个数量级,对方服务器压力也小得多 —— 这本身就是更礼貌的做法。
 *
 * ⚠️ 所有取 URL 的动作都走 awaitPoliteSlot(见 politeness.ts),
 *    sitemap 也不例外。
 */

/** sitemap 文件本身的大小上限 —— 防止一个超大文件把内存吃光 */
const MAX_SITEMAP_BYTES = 20_000_000
const TIMEOUT_MS = 30_000
/** 一个站点最多展开多少个候选 sitemap —— 见 discoverSitemaps 里的说明 */
const MAX_CANDIDATE_SITEMAPS = 40

async function fetchText(url: string): Promise<string | null> {
  const u = new URL(url)
  const verdict = await awaitPoliteSlot(u)
  if (!verdict.allowed) return null

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CompassBot/1.0; +program-data-collection)' },
    })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_SITEMAP_BYTES) return null
    const text = await res.text()
    return text.length > MAX_SITEMAP_BYTES ? null : text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 robots.txt 里读出站点公布的 sitemap 地址。
 *
 * ⚠️ 拿不到就退回 /sitemap.xml 这个约定俗成的位置 —— 不少站点有 sitemap
 *    但没在 robots 里声明。两条都试不到才算这个站点没有 sitemap。
 */
export function parseSitemapUrls(robotsTxt: string): string[] {
  const out: string[] = []
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^sitemap\s*:\s*(\S+)$/i.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

/** 从 sitemap XML 里取出所有 <loc>。sitemap index 和普通 sitemap 结构相同 */
export function parseLocs(xml: string): string[] {
  const out: string[] = []
  // 用正则而不是 XML 解析器:sitemap 结构极简单,而真实世界里
  // 不少站点的 sitemap 有轻微格式问题,严格解析器会整份拒掉
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(m[1])
  return out
}

/**
 * ⚠️ 注释掉的 <sitemap> 条目要排除。
 *    曼彻斯特的 sitemap index 里就有一条被 <!-- --> 注释掉的
 *    (online-blended-learning),照抓会得到一个 404。
 */
export function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '')
}

export interface SitemapDiscovery {
  /** 站点公布的所有 sitemap(已展开 index) */
  sitemaps: string[]
  /** 抓取过程中的问题,给运营看 */
  notes: string[]
}

/**
 * 找出一个站点的全部 sitemap(自动展开 sitemap index)。
 *
 * @param origin 形如 https://www.manchester.ac.uk
 */
export async function discoverSitemaps(origin: string): Promise<SitemapDiscovery> {
  const notes: string[] = []

  const robots = await fetchText(`${origin}/robots.txt`)
  let candidates = robots ? parseSitemapUrls(robots) : []

  if (!candidates.length) {
    notes.push('robots.txt 里没有声明 sitemap,退回试 /sitemap.xml')
    candidates = [`${origin}/sitemap.xml`]
  }

  /**
   * ⚠️ 候选 sitemap 必须封顶。
   *
   *    UCL 的 robots.txt 里声明了**几百个** sitemap(每个院系一个 Drupal 子站)。
   *    逐个抓、每个还要等 1.5 秒礼貌间隔,光它一所就是十几分钟 ——
   *    实测跑 12 所学校时,预算全被它吃掉,后面的学校根本没跑到。
   *
   *    先按「路径里像不像课程」排序,再截断:真正装课程的那几个基本都在前面,
   *    而几百个 xxx-lab / xxx-institute 子站里没有课程页。
   */
  const RANK = /course|programme|study|degree|undergraduate|postgraduate|master|prospective/i
  candidates = candidates
    .sort((a, b) => Number(RANK.test(b)) - Number(RANK.test(a)))
    .slice(0, MAX_CANDIDATE_SITEMAPS)

  if (candidates.length === MAX_CANDIDATE_SITEMAPS) {
    notes.push(
      `该站点声明的 sitemap 过多,只取了看起来最像课程的前 ${MAX_CANDIDATE_SITEMAPS} 个 —— ` +
        '如果结果明显偏少,这所学校需要在注册表里用 sitemapHints 指定具体路径',
    )
  }

  const seen = new Set<string>()
  const leaves: string[] = []

  // 只展开一层 index —— 嵌套超过一层的极少见,而无限展开有被引导到别处的风险
  for (const c of candidates) {
    if (seen.has(c)) continue
    seen.add(c)

    const xml = await fetchText(c)
    if (!xml) {
      notes.push(`取不到 ${c}`)
      continue
    }

    const clean = stripXmlComments(xml)
    const isIndex = /<sitemapindex[\s>]/i.test(clean)

    if (!isIndex) {
      leaves.push(c)
      continue
    }

    for (const child of parseLocs(clean)) {
      // 只跟同源的子 sitemap,不被引导到站外
      if (!child.startsWith(origin)) {
        notes.push(`跳过跨站 sitemap:${child}`)
        continue
      }
      if (!seen.has(child)) {
        seen.add(child)
        leaves.push(child)
      }
    }
  }

  return { sitemaps: leaves, notes }
}

/** 取某个 sitemap 里的全部 URL */
export async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl)
  if (!xml) return []
  return parseLocs(stripXmlComments(xml))
}
