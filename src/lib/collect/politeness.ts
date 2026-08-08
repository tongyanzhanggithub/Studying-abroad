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

/**
 * 抓取礼貌层:robots.txt 遵守 + 按站点限速。
 *
 * ── 为什么在放量前必须先有这一层 ──────────────────────
 *
 * 现在的 fetchPageText 只做了 SSRF 防护和超时,**既不读 robots.txt,
 * 也不限速**。手工采一条一条的时候无所谓;一旦要覆盖上百所大学、
 * 十几万个课程页,不加这层的后果是确定的:
 *
 *   · IP 被封 —— 大学官网普遍有 WAF,连续高频请求会直接拉黑,
 *     而封的是**服务器出口 IP**,封掉之后连正常的人工采集也做不了
 *   · 违反对方使用条款 —— robots.txt 是站点明示的爬取意愿,
 *     一个把「数据可信、可核对」当卖点的产品,自己无视它说不过去
 *
 * ── 边界(诚实说明)────────────────────────────────
 *
 * 限速状态是**进程内**的。单进程部署(见 deploy/compass.service)下成立;
 * 将来多实例并行抓取时,每个进程各限各的,需要换成共享状态。
 * robots 缓存同理,进程重启即失效 —— 那只是多请求几次 robots.txt,无害。
 */

/** 我们的爬虫标识 —— 必须和 fetch.ts 里 user-agent 中的名字一致 */
export const BOT_NAME = 'CompassBot'

/** 没有 Crawl-delay 时,对同一站点的默认间隔 */
const DEFAULT_DELAY_MS = 1500

/**
 * 允许的最大 Crawl-delay。
 *
 * 有些站点写着 Crawl-delay: 120,老实等两分钟一页,十万个页面要跑几年。
 * 超过这个值就认为「这个站点不欢迎批量抓取」,直接跳过它,而不是
 * 假装遵守却实际上永远跑不完。
 */
const MAX_ACCEPTABLE_DELAY_MS = 30_000

/** robots.txt 自身的抓取超时 —— 它不该拖慢整体 */
const ROBOTS_TIMEOUT_MS = 8000

export interface RobotsRules {
  /** 按长度降序排好的规则,便于「最长匹配优先」 */
  rules: Array<{ path: string; allow: boolean }>
  crawlDelayMs: number
  /** 拿不到 robots.txt(404 / 超时 / 报错)时为 true —— 按「允许」处理 */
  unavailable: boolean
}

const robotsCache = new Map<string, RobotsRules>()
/** 上一次请求某站点的时间戳 */
const lastHitAt = new Map<string, number>()
/** 同一站点的请求排队,保证间隔真的被拉开 */
const hostQueue = new Map<string, Promise<void>>()

/**
 * 解析 robots.txt。
 *
 * ⚠️ 只取**最具体**的那个 User-agent 分组:精确匹配 CompassBot 优先于 `*`。
 *    两个都没有就等于没有限制。这是 robots 协议的通行做法 ——
 *    把所有分组的规则并起来是错的,那会把针对别的爬虫的禁令也套到自己头上。
 */
export function parseRobots(text: string, botName = BOT_NAME): RobotsRules {
  const lines = text.split(/\r?\n/)

  // agent(小写) → 该分组下的指令
  const groups = new Map<string, string[]>()
  let currentAgents: string[] = []
  let seenDirectiveInGroup = false

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue

    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (field === 'user-agent') {
      // 连续的 User-agent 行属于同一分组;遇到指令后再出现 User-agent 则是新分组
      if (seenDirectiveInGroup) {
        currentAgents = []
        seenDirectiveInGroup = false
      }
      currentAgents.push(value.toLowerCase())
      for (const a of currentAgents) if (!groups.has(a)) groups.set(a, [])
      continue
    }

    if (!currentAgents.length) continue
    seenDirectiveInGroup = true
    for (const a of currentAgents) groups.get(a)!.push(`${field}:${value}`)
  }

  const picked = groups.get(botName.toLowerCase()) ?? groups.get('*') ?? null
  if (!picked) return { rules: [], crawlDelayMs: DEFAULT_DELAY_MS, unavailable: false }

  const rules: RobotsRules['rules'] = []
  let crawlDelayMs = DEFAULT_DELAY_MS

  for (const d of picked) {
    const i = d.indexOf(':')
    const field = d.slice(0, i)
    const value = d.slice(i + 1)

    if (field === 'disallow') {
      // 空的 Disallow 表示「什么都不禁」,不是「禁止一切」
      if (value) rules.push({ path: value, allow: false })
    } else if (field === 'allow') {
      if (value) rules.push({ path: value, allow: true })
    } else if (field === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) crawlDelayMs = Math.round(n * 1000)
    }
  }

  // 最长匹配优先 —— Allow: /a/b 应当覆盖 Disallow: /a
  rules.sort((x, y) => y.path.length - x.path.length)
  return { rules, crawlDelayMs, unavailable: false }
}

/** 某条路径是否被允许 */
export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  for (const r of rules.rules) {
    if (pathname.startsWith(r.path)) return r.allow
  }
  return true
}

/**
 * 取某站点的 robots.txt(带进程内缓存)。
 *
 * ⚠️ 拿不到就按**允许**处理,而不是按禁止。
 *    robots.txt 不存在(404)在协议上就等于没有限制;
 *    而超时/报错时一律拒绝的话,一次网络抖动会让整批采集停摆。
 */
async function loadRobots(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin)
  if (cached) return cached

  let result: RobotsRules
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ROBOTS_TIMEOUT_MS)
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        signal: ctrl.signal,
        headers: { 'user-agent': `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0)` },
      })
      result = res.ok
        ? parseRobots(await res.text())
        : { rules: [], crawlDelayMs: DEFAULT_DELAY_MS, unavailable: true }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    result = { rules: [], crawlDelayMs: DEFAULT_DELAY_MS, unavailable: true }
  }

  robotsCache.set(origin, result)
  return result
}

export interface PolitenessVerdict {
  allowed: boolean
  /** 不允许时给运营看的原因 */
  reason?: string
}

/**
 * 抓某个 URL 之前调用:检查 robots,并**等到**该站点的下一个可用时隙。
 *
 * ⚠️ 用队列串起来,而不是各自算「距上次多久」。
 *    并发发起 20 个请求时,后者会让它们同时看到「上次是很久以前」而一起放行,
 *    限速形同虚设。队列保证同一站点的请求真的被拉开。
 */
export async function awaitPoliteSlot(url: URL): Promise<PolitenessVerdict> {
  const robots = await loadRobots(url.origin)

  if (!robots.unavailable && !isPathAllowed(robots, url.pathname)) {
    return { allowed: false, reason: `${url.hostname} 的 robots.txt 不允许抓取这个路径` }
  }
  if (robots.crawlDelayMs > MAX_ACCEPTABLE_DELAY_MS) {
    return {
      allowed: false,
      reason:
        `${url.hostname} 要求每次抓取间隔 ${Math.round(robots.crawlDelayMs / 1000)} 秒,` +
        '按这个速度批量采集不现实 —— 这个站点用「粘贴正文采集」更合适。',
    }
  }

  const host = url.hostname
  const prev = hostQueue.get(host) ?? Promise.resolve()

  let release: () => void
  const mine = new Promise<void>((r) => (release = r!))
  hostQueue.set(
    host,
    prev.then(() => mine),
  )

  await prev

  const since = Date.now() - (lastHitAt.get(host) ?? 0)
  const wait = robots.crawlDelayMs - since
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))

  lastHitAt.set(host, Date.now())
  // 让出时隙 —— 排在后面的请求从这里开始算自己的等待
  release!()

  return { allowed: true }
}

/** 仅供测试:清掉进程内状态 */
export function __resetPoliteness() {
  robotsCache.clear()
  lastHitAt.clear()
  hostQueue.clear()
}
