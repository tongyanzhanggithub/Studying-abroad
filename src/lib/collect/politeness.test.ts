import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import {
  parseRobots,
  isPathAllowed,
  awaitPoliteSlot,
  __resetPoliteness,
  BOT_NAME,
} from '@/lib/collect/politeness'

/**
 * 抓取礼貌层。
 *
 * 覆盖上百所大学、十几万个课程页之前,这一层是硬前提:
 * 大学官网普遍有 WAF,连续高频请求会封掉**服务器出口 IP** ——
 * 封了之后连正常的人工采集也做不了。
 */

beforeEach(() => __resetPoliteness())

describe('robots.txt 解析', () => {
  it('只取最具体的分组 —— 精确匹配优先于 *', () => {
    const r = parseRobots(`
User-agent: *
Disallow: /

User-agent: ${BOT_NAME}
Disallow: /admin
`)
    // 命中了 CompassBot 那组,所以根路径是允许的
    expect(isPathAllowed(r, '/courses/msc-finance')).toBe(true)
    expect(isPathAllowed(r, '/admin/x')).toBe(false)
  })

  /**
   * ⚠️ 把所有分组的规则并起来是错的 —— 那会把针对别的爬虫的禁令
   *    也套到自己头上,凭空少抓一大片。
   */
  it('不把别的爬虫的禁令套到自己头上', () => {
    const r = parseRobots(`
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
`)
    expect(isPathAllowed(r, '/courses')).toBe(true)
    expect(isPathAllowed(r, '/private/x')).toBe(false)
  })

  it('空的 Disallow 表示不禁,不是禁止一切', () => {
    const r = parseRobots('User-agent: *\nDisallow:')
    expect(isPathAllowed(r, '/anything')).toBe(true)
  })

  it('Disallow: / 禁止一切', () => {
    const r = parseRobots('User-agent: *\nDisallow: /')
    expect(isPathAllowed(r, '/courses')).toBe(false)
  })

  it('最长匹配优先 —— Allow 能覆盖更宽的 Disallow', () => {
    const r = parseRobots(`
User-agent: *
Disallow: /courses
Allow: /courses/postgraduate
`)
    expect(isPathAllowed(r, '/courses/undergraduate/x')).toBe(false)
    expect(isPathAllowed(r, '/courses/postgraduate/msc')).toBe(true)
  })

  it('忽略注释与空行', () => {
    const r = parseRobots(`
# 这是注释
User-agent: *   # 行尾注释
Disallow: /secret
`)
    expect(isPathAllowed(r, '/secret/x')).toBe(false)
    expect(isPathAllowed(r, '/open')).toBe(true)
  })

  it('读得出 Crawl-delay', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 5').crawlDelayMs).toBe(5000)
  })

  it('没写 Crawl-delay 时给一个保守默认值', () => {
    expect(parseRobots('User-agent: *\nDisallow: /x').crawlDelayMs).toBeGreaterThanOrEqual(1000)
  })

  it('连续的 User-agent 行属于同一分组', () => {
    const r = parseRobots(`
User-agent: FooBot
User-agent: ${BOT_NAME}
Disallow: /nope
`)
    expect(isPathAllowed(r, '/nope/x')).toBe(false)
  })

  it('空文件 = 没有限制', () => {
    expect(isPathAllowed(parseRobots(''), '/anything')).toBe(true)
  })

  it('大小写不敏感地匹配 User-agent', () => {
    const r = parseRobots(`User-agent: ${BOT_NAME.toUpperCase()}\nDisallow: /x`)
    expect(isPathAllowed(r, '/x/y')).toBe(false)
  })
})

describe('按站点限速', () => {
  /**
   * ⚠️ 这是整个模块最容易写错的地方。
   *
   *    如果实现成「每个请求各自算距上次多久」,并发发起 20 个请求时
   *    它们会**同时**看到「上次是很久以前」而一起放行 —— 限速形同虚设,
   *    而批量采集恰恰就是并发发起的。所以必须用队列真正把请求串起来。
   */
  it('并发请求会被真的拉开,而不是一起放行', async () => {
    // robots.txt 一律 404 → 按「允许 + 默认间隔」处理,结果确定
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('', { status: 404 })) as unknown as typeof fetch

    try {
      __resetPoliteness()
      const url = new URL('https://example.test/courses/a')
      const t0 = Date.now()

      const stamps = await Promise.all(
        [1, 2, 3].map(async () => {
          await awaitPoliteSlot(url)
          return Date.now() - t0
        }),
      )

      stamps.sort((a, b) => a - b)
      const gaps = [stamps[1] - stamps[0], stamps[2] - stamps[1]]
      // 默认间隔 1500ms,留 200ms 余量给调度抖动
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(1300)
    } finally {
      globalThis.fetch = realFetch
    }
  }, 15_000)

  it('不同站点互不排队', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('', { status: 404 })) as unknown as typeof fetch

    try {
      __resetPoliteness()
      const t0 = Date.now()
      await Promise.all([
        awaitPoliteSlot(new URL('https://a.test/x')),
        awaitPoliteSlot(new URL('https://b.test/x')),
        awaitPoliteSlot(new URL('https://c.test/x')),
      ])
      // 三个不同站点应当几乎同时放行,不该串成 3 倍间隔
      expect(Date.now() - t0).toBeLessThan(1000)
    } finally {
      globalThis.fetch = realFetch
    }
  }, 15_000)
})

describe('接入位置', () => {
  const fetchSrc = codeOnly(
    readFileSync(join(process.cwd(), 'src/lib/collect/fetch.ts'), 'utf8'),
  )

  /**
   * ⚠️ 礼貌层必须在**真正发请求之前**。放在后面等于没有 ——
   *    请求已经打出去了,封 IP 该发生还是会发生。
   */
  it('awaitPoliteSlot 在 fetch 之前调用', () => {
    const polite = fetchSrc.indexOf('awaitPoliteSlot(')
    const doFetch = fetchSrc.indexOf('await fetch(url')
    expect(polite).toBeGreaterThan(-1)
    expect(doFetch).toBeGreaterThan(-1)
    expect(polite).toBeLessThan(doFetch)
  })

  it('被 robots 拒绝时抛错,不继续抓', () => {
    expect(fetchSrc).toMatch(/if \(!polite\.allowed\) throw/)
  })

  it('SSRF 校验仍在最前面 —— 礼貌层不能顶掉安全校验', () => {
    const ssrf = fetchSrc.indexOf('assertPublicUrl(raw.trim())')
    const polite = fetchSrc.indexOf('awaitPoliteSlot(')
    expect(ssrf).toBeGreaterThan(-1)
    expect(ssrf).toBeLessThan(polite)
  })

  it('User-Agent 里带的名字和礼貌层用来匹配 robots 的一致', () => {
    // 不一致的话,站点针对我们写的 robots 规则会匹配不上
    expect(fetchSrc).toContain(BOT_NAME)
  })
})
