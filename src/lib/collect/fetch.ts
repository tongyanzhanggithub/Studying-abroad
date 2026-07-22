import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

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

/** 私有 / 保留地址段 —— 命中任何一条都拒绝 */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase()
    if (v6 === '::1' || v6 === '::') return true
    // 唯一本地地址 fc00::/7、链路本地 fe80::/10
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true
    // IPv4 映射地址 ::ffff:127.0.0.1
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
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
  // 跟跳转时逐跳更新,相对 Location 要基于当前这一跳解析
  let current = url

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      // 跳转目标可能是内网地址,自己跟随才能逐跳校验
      redirect: 'manual',
      headers: {
        // ⚠️ 只能是 ASCII —— HTTP header 是 ByteString,
        //    这里放中文会让 fetch 直接抛 "Cannot convert argument to a ByteString"
        'user-agent': 'Mozilla/5.0 (compatible; CompassBot/1.0; +program-data-collection)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en,zh-CN;q=0.8',
      },
    })

    // 最多跟 3 跳,每跳都重新做公网校验
    let hops = 0
    while (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (++hops > 3) throw new Error('跳转次数过多')
      const next = await assertPublicUrl(new URL(res.headers.get('location')!, current).toString())
      current = next
      res = await fetch(next, { signal: ctrl.signal, redirect: 'manual' })
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

  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error('页面太大,超过 3MB')

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
