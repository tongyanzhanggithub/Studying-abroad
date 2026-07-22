import 'server-only'

/**
 * 从学校的项目列表页里发现各个项目详情页的链接。
 *
 * 「按学校采集」的第一步。之前一次只能采一个链接,补一所学校要人肉
 * 把二三十个 URL 一个个翻出来贴进去 —— 这一步才是真正费时间的地方,
 * 抽取反而不是。
 *
 * 做法是纯规则的(正则 + 打分),不走模型:
 * 列表页的链接结构很有规律,规则跑起来免费、可预测、出错也看得懂;
 * 而且这一步的产出**必然要人工勾选**,不需要模型来提高准确率。
 */

export interface DiscoveredLink {
  url: string
  /** 链接文字 —— 运营就是靠它判断该不该勾 */
  text: string
  /** 打分越高越像项目详情页,仅用于排序 */
  score: number
  /** 已经在库里了 */
  existing?: boolean
}

/** 一看就不是项目页的路径 */
const DENY_PATTERN =
  /\/(news|events?|blog|staff|people|contact|about|privacy|cookie|accessibility|search|login|apply-now|alumni|library|jobs|vacanc|sitemap|terms|media|press|donate|giving|shop|research-(groups?|centres?)|phd|doctoral|undergraduate|foundation)(\/|$|\?)/i

/** 像硕士项目详情页的路径特征 */
const COURSE_PATH =
  /\/(courses?|programmes?|programs?|degrees?|study|taught|masters?|postgraduate|pg|msc|ma|mba|meng|msci|llm)(\/|-)/i

/** 链接文字里的学位前缀 —— 命中基本可以确定是项目 */
const DEGREE_IN_TEXT =
  /\b(MSc|M\.Sc|MA\b|MBA|MEng|MRes|LLM|MPhil|MFin|MMath|MSci|Master(?:'s)?(?: of| in)?)\b/i

/** 明显不是项目名的链接文字 */
const NAV_TEXT =
  /^(home|next|previous|back|more|read more|apply|apply now|search|menu|skip to|view all|all courses|下一页|上一页|更多|首页)$/i

interface RawLink {
  href: string
  text: string
}

/** 从 HTML 里抠出所有 <a href> 及其可见文字 */
function rawLinks(html: string): RawLink[] {
  const out: RawLink[] = []
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({ href: m[1], text })
    if (out.length > 5000) break // 防御性上限,正常列表页远到不了
  }
  return out
}

function scoreLink(url: URL, text: string): number {
  let s = 0
  const path = url.pathname

  if (DEGREE_IN_TEXT.test(text)) s += 5
  if (COURSE_PATH.test(path)) s += 3
  // 详情页的路径通常比列表页深
  const depth = path.split('/').filter(Boolean).length
  if (depth >= 3) s += 2
  else if (depth <= 1) s -= 2
  // 项目名一般是几个词,不会是一个字也不会是一整句
  const words = text.split(/\s+/).length
  if (words >= 2 && words <= 12) s += 1
  if (text.length < 3) s -= 3
  if (/\b(online|distance learning)\b/i.test(text)) s += 1 // 仍然收,但审核时会标线上
  return s
}

export interface DiscoverOptions {
  /** 只收这个域名下的链接 */
  host: string
  /** 打分低于这个值的丢掉 */
  minScore?: number
  max?: number
}

/**
 * @param html    列表页原始 HTML
 * @param baseUrl 列表页最终 URL(跟完跳转的),相对链接基于它解析
 */
export function discoverProgramLinks(
  html: string,
  baseUrl: string,
  opts: DiscoverOptions,
): DiscoveredLink[] {
  const base = new URL(baseUrl)
  const seen = new Map<string, DiscoveredLink>()

  for (const { href, text } of rawLinks(html)) {
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue
    if (NAV_TEXT.test(text)) continue

    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      continue
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue

    /**
     * ⚠️ 只收同域链接。
     *
     * 列表页上必然有大量外链(社交媒体、合作机构、广告)。放开域名限制
     * 等于让「页面上写了什么」决定服务器去抓什么 —— 页面内容是不可信输入。
     * 同域限制同时也保证了采到的确实是这所学校自己的项目。
     */
    if (url.hostname !== opts.host) continue
    if (DENY_PATTERN.test(url.pathname)) continue

    // 锚点和查询串不同但指向同一页面的,算一条
    url.hash = ''
    const key = url.toString().replace(/\/$/, '')
    if (seen.has(key)) {
      // 同一个 URL 出现多次时保留更像项目名的那段文字
      const prev = seen.get(key)!
      if (text.length > prev.text.length && text.length < 120) prev.text = text
      continue
    }

    const score = scoreLink(url, text)
    if (score < (opts.minScore ?? 4)) continue

    // 有些学校把整张卡片(学制、截止日、中英文名)都塞进 <a> 里,
    // 原样存会让勾选列表每行几百字,反而看不清项目名
    const label = (text || url.pathname).slice(0, 140)
    seen.set(key, { url: url.toString(), text: label, score })
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, opts.max ?? 200)
}
