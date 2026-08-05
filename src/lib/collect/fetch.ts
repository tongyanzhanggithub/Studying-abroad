import 'server-only'
import { lookup } from 'node:dns/promises'
import { lookup as dnsLookupCb } from 'node:dns'
import { isIP } from 'node:net'
import { Agent } from 'undici'
import { awaitPoliteSlot } from './politeness'

/**
 * 抓取院校官网页面正文。
 *
 * ── 为什么这里要防 SSRF ─────────────────────────────────
 * URL 是运营在后台输入框里填的,而这段代码跑在服务器上。
 * 如果不加限制,填 http://127.0.0.1:5432 或者阿里云的元数据地址
 * http://100.100.100.200/latest/meta-data/ 就能让服务器把内网资源
 * 抓回来显示在页面上 —— 云厂商的元数据接口会吐出临时访问凭据。
 *
 * 后台账号被盗、或者运营被钓鱼骗着粘贴一个链接,都会走到这里。
 * 所以:只允许 http(s)、解析出来的 IP 必须是公网地址、不跟随跨协议跳转。
 */

const BLOCKED_MESSAGE = '只能抓取公网上的院校官网地址'

/**
 * 把任意书写形式的 IPv6 展开成 8 个 16 位段。无法解析返回 null。
 *
 * ⚠️ 原来只用正则匹配 `::1` / `fc` / `fe8` 等**压缩形式**,以下写法全部漏判成公网:
 *      [0:0:0:0:0:0:0:1](展开的回环)、[::ffff:7f00:1](十六进制映射 127.0.0.1)。
 *    展开成规范形式后按段判断,才不会被书写形式绕过。
 */
export function expandIpv6(input: string): number[] | null {
  let s = input.toLowerCase()
  const zone = s.indexOf('%') // 去掉 fe80::1%eth0 这样的 zone id
  if (zone >= 0) s = s.slice(0, zone)

  // 结尾内嵌 IPv4(::ffff:127.0.0.1 / ::127.0.0.1)—— 折成两个 16 位段
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const q = tail.split('.').map(Number)
    if (q.length !== 4 || q.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
    s =
      s.slice(0, lastColon + 1) +
      ((q[0] << 8) | q[1]).toString(16) +
      ':' +
      ((q[2] << 8) | q[3]).toString(16)
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const back = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null

  let groups: string[]
  if (back === null) {
    groups = head
  } else {
    const fill = 8 - head.length - back.length
    if (fill < 0) return null
    groups = [...head, ...Array(fill).fill('0'), ...back]
  }
  if (groups.length !== 8) return null

  const nums = groups.map((g) => parseInt(g || '0', 16))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  return nums
}

/** 私有 / 保留地址段 —— 命中任何一条都拒绝 */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const n = expandIpv6(ip)
    if (!n) return true // 解析不了的 IPv6 一律当私有,fail-closed
    // ::(未指定)与 ::1(回环)
    if (n.every((x) => x === 0)) return true
    if (n.slice(0, 7).every((x) => x === 0) && n[7] === 1) return true
    // 内嵌 IPv4:::ffff:a.b.c.d(映射)与 ::a.b.c.d(兼容)—— 落到 IPv4 规则
    if (n.slice(0, 5).every((x) => x === 0) && (n[5] === 0xffff || n[5] === 0)) {
      const v4 = `${n[6] >> 8}.${n[6] & 0xff}.${n[7] >> 8}.${n[7] & 0xff}`
      return isPrivateIp(v4)
    }
    if ((n[0] & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地
    if ((n[0] & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
    return false
  }

  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true

  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地,含云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT,阿里云元数据 100.100.100.200 在此段
  if (a >= 224) return true // 组播与保留段
  return false
}

/**
 * 在**实际建连的那个 IP** 上做 SSRF 校验的 dispatcher。
 *
 * ⚠️ 为什么不能只靠 assertPublicUrl:它「解析→校验→再用 hostname 交给 fetch」,
 *    而 fetch 内部会**再解析一次 DNS**。两次解析之间攻击者可切换记录(DNS rebinding /
 *    TOCTOU):第一次返回公网 IP 过校验,第二次返回 100.100.100.200。
 *    把校验放进连接回调、卡在真正要连的 IP 上,rebinding 第二次拿到的私网 IP 一样被拒。
 */
/**
 * 全局 fetch 的 RequestInit 类型(来自 DOM lib)不含 `dispatcher`,但 Node 运行时
 * 的 fetch 底层就是 undici、会接受它。这里补一个类型让调用处不用逐个断言。
 */
type FetchInit = RequestInit & { dispatcher?: Agent }

const ssrfAgent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      dnsLookupCb(hostname, options, (err, address, family) => {
        if (err) return cb(err, address as string, family as number)
        const addrs = Array.isArray(address)
          ? (address as unknown as Array<{ address: string }>)
          : [{ address: address as string }]
        if (addrs.some((a) => isPrivateIp(a.address))) {
          return cb(new Error(BLOCKED_MESSAGE), address as string, family as number)
        }
        cb(null, address as string, family as number)
      })
    },
  },
})

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('地址格式不对,要以 http:// 或 https:// 开头')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(BLOCKED_MESSAGE)
  }

  const host = url.hostname
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error(BLOCKED_MESSAGE)
    return url
  }

  // 域名要解析后再判断 —— 攻击者可以把自己的域名解析到 127.0.0.1
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new Error(`域名解析不了:${host}`)
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(BLOCKED_MESSAGE)
  }

  return url
}

/**
 * HTML → 纯文本。
 *
 * 不引第三方解析库:这里只要「能喂给模型的可读文本」,
 * 不需要还原 DOM 结构。script/style 必须先整段删掉,
 * 否则内联 JS 会占满 token 预算,把真正的正文挤出去。
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

export interface FetchedPage {
  url: string
  /** 最终 URL(跟完跳转之后的)—— 相对链接要基于它解析,基于原始 URL 会错 */
  finalUrl: string
  html: string
  text: string
  chars: number
}

const TIMEOUT_MS = 20_000
const MAX_BYTES = 3_000_000

export async function fetchPageText(raw: string): Promise<FetchedPage> {
  const url = await assertPublicUrl(raw.trim())

  /**
   * ⚠️ 抓之前先过礼貌层:遵守 robots.txt,并等到该站点的下一个可用时隙。
   *
   *    手工一条一条采的时候无所谓;一旦要覆盖上百所大学、十几万个课程页,
   *    不限速的后果是确定的 —— 大学官网普遍有 WAF,连续高频请求会封掉
   *    **服务器出口 IP**,封了之后连正常的人工采集也做不了。
   *
   *    这一步会**阻塞**到轮到自己,所以调用方不需要自己 sleep。
   */
  const polite = await awaitPoliteSlot(url)
  if (!polite.allowed) throw new Error(polite.reason ?? '该站点不允许抓取')
  // 跟跳转时逐跳更新,相对 Location 要基于当前这一跳解析
  let current = url

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      // 在实际建连 IP 上做 SSRF 校验(防 DNS rebinding)
      dispatcher: ssrfAgent,
      // 跳转目标可能是内网地址,自己跟随才能逐跳校验
      redirect: 'manual',
      headers: {
        // ⚠️ 只能是 ASCII —— HTTP header 是 ByteString,
        //    这里放中文会让 fetch 直接抛 "Cannot convert argument to a ByteString"
        'user-agent': 'Mozilla/5.0 (compatible; CompassBot/1.0; +program-data-collection)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en,zh-CN;q=0.8',
      },
    } as FetchInit)

    // 最多跟 3 跳,每跳都重新做公网校验
    let hops = 0
    while (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (++hops > 3) throw new Error('跳转次数过多')
      const next = await assertPublicUrl(new URL(res.headers.get('location')!, current).toString())
      current = next
      res = await fetch(next, { signal: ctrl.signal, dispatcher: ssrfAgent, redirect: 'manual' } as FetchInit)
    }
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        `抓取超时(${TIMEOUT_MS / 1000} 秒):${url.hostname} 没有在时限内响应。` +
          '国外院校官网从国内访问经常很慢,可以重试,或改用「粘贴正文采集」。',
      )
    }
    // fetch 的网络错误默认只有一句 "fetch failed",对运营毫无信息量。
    // 这里把最常见的原因摆出来 —— 国内服务器访问国外官网不通是常态,不是 bug。
    if (e instanceof TypeError) {
      throw new Error(
        `连不上 ${url.hostname}(网络层失败)。常见原因:该网站从当前服务器所在网络访问不通、` +
          '域名解析被拦截、或对方拒绝了非浏览器请求。' +
          '这种情况用「粘贴正文采集」最省事:在自己浏览器里打开页面,全选复制正文粘进来。',
      )
    }
    throw e
  }
  clearTimeout(timer)

  if (!res.ok) throw new Error(`抓取失败,HTTP ${res.status}`)

  const type = res.headers.get('content-type') ?? ''
  if (!/text\/html|application\/xhtml/i.test(type)) {
    throw new Error(`这个地址返回的不是网页(${type || '类型未知'})—— PDF 招生简章暂时抓不了`)
  }

  /**
   * ⚠️ 不能 `await res.arrayBuffer()` 再判大小 —— 那样会先把整个响应体读进内存才检查,
   *    恶意服务器返回 10GB(或一个小 gzip 解压后极大)会在检查生效前撑爆内存,MAX_BYTES
   *    形同虚设。这里先看 content-length 快速拒绝,再流式读取、累计超限立即中断。
   */
  const declaredLen = Number(res.headers.get('content-length'))
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BYTES) {
    throw new Error('页面太大,超过 3MB')
  }

  const chunks: Uint8Array[] = []
  let received = 0
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_BYTES) {
        await reader.cancel()
        throw new Error('页面太大,超过 3MB')
      }
      chunks.push(value)
    }
  }
  const buf = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }

  const html = new TextDecoder('utf-8').decode(buf)
  const text = htmlToText(html)
  if (text.length < 200) {
    throw new Error(
      '抓到的正文太短 —— 这个页面很可能是前端渲染的,服务端抓不到内容。' +
        '可以改用「粘贴正文」的方式采集。',
    )
  }

  return {
    url: url.toString(),
    finalUrl: current.toString(),
    html,
    text,
    chars: text.length,
  }
}
