import { NextResponse, type NextRequest } from 'next/server'

/**
 * ── 1. 把当前路径注入请求头 ──────────────────────────
 * 供 Server Component(如 admin layout)判断是否为登录页。
 * Next.js 不默认提供这个信息,而 layout 里拿不到 pathname。
 *
 * ── 2. 内容安全策略(CSP)────────────────────────────
 *
 * 之前只在 next.config.mjs 里下了 `frame-ancestors 'none'`,那儿的注释写着
 * 「不设完整 CSP:Next 的内联脚本需要 nonce 配合,配错了整站白屏,
 *   而白屏比缺一层纵深防御更糟」—— 这个权衡当时是对的,代价是完全没有
 * XSS 的纵深防御。
 *
 * 现在按 Next 官方支持的方式做:middleware 每个请求生成一个 nonce 写进 CSP,
 * Next 会**自动**把同一个 nonce 加到它注入的 script 标签上。
 *
 * ⚠️ 几条直接挡掉真实攻击类别的指令,单独说明:
 *   base-uri 'self'    挡 <base> 注入 —— 否则一处 HTML 注入就能把页面上
 *                      所有相对路径的表单和脚本改指到攻击者域名
 *   form-action 'self' 挡表单劫持 —— 登录表单被改成往外发就是凭据泄露,
 *                      而这个产品的登录用的是手机号 + 验证码
 *   object-src 'none'  挡 <object>/<embed> 这类老式脚本执行途径
 *   frame-ancestors    防点击劫持(原来就有,收进这里统一管)
 *
 * ⚠️ style-src 必须留 'unsafe-inline':Tailwind 与 Next 都注入内联样式。
 *    如实标注,不假装这一条是严的 —— 但样式注入的危害远小于脚本注入。
 *
 * ⚠️ 开发环境要额外放开 'unsafe-eval'(webpack 热更新依赖 eval)与 ws:
 *    (HMR 的 WebSocket)。生产环境都不放开。
 */
function buildCsp(nonce: string, isDev: boolean, isHttps: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    /**
     * strict-dynamic:由带 nonce 的脚本动态插入的后续脚本自动被信任。
     * 没有它就得把每个 chunk 路径列进白名单 —— 而 chunk 名字每次构建都变。
     *
     * ⚠️ 支持 strict-dynamic 的浏览器会**忽略** 'unsafe-inline' 和 https:,
     *    不支持的老浏览器则退回读那两个。所以这两项在新浏览器上不削弱策略,
     *    只是给老浏览器留一条能用的路。
     */
    "'strict-dynamic'",
    "'unsafe-inline'",
    'https:',
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ')

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // 只允许连回自己。将来接 OSS 直传之类,在这里显式加域名
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    /**
     * ⚠️ 只在**真的跑在 HTTPS 上**时才下这一条。
     *
     * upgrade-insecure-requests 会把页面上所有子资源的 http 请求改写成 https。
     * 站点只有 80、没有证书时,这等于把自己全部静态资源指向一个不存在的 443 ——
     * CSS 和 JS 全部 ERR_CONNECTION_CLOSED,用户看到一页没有样式、点不动的纯文字,
     * 而服务端一切正常(HTML 确实返回 200,日志里没有任何错误)。
     * 2026-08 的测试机就是这么「打不开」的:排查完 502(服务没起)、500(CRON_SECRET
     * 缺失)之后,页面还是坏的,最后才定位到这一行。
     *
     * 而 env.ts 的 assertProductionConfig 明确把「跑在 HTTP 上」当作演示阶段可接受的
     * 过渡态(只告警、不拒绝启动)。这条无条件下发,等于让那个过渡态根本不成立 ——
     * 两处必须一致。
     */
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function middleware(request: NextRequest) {
  // Web Crypto —— Edge 运行时里没有 node:crypto
  const nonce = btoa(crypto.randomUUID())
  const isDev = process.env.NODE_ENV !== 'production'
  /**
   * 当前请求是否真的走 HTTPS。取 nginx 传来的 X-Forwarded-Proto
   * (deploy/nginx-compass.conf 里有 proxy_set_header),直连时退回请求自身协议。
   *
   * ⚠️ 不用 NEXT_PUBLIC_SITE_URL 来判断 —— 那是「声明的地址」。把它配成 https
   *    但证书还没装好的那段时间,会再次触发整站白屏。这里要的是**这个请求**
   *    的真实协议,配错了也不会把站点打死。
   */
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  const csp = buildCsp(nonce, isDev, proto === 'https')

  const headers = new Headers(request.headers)
  headers.set('x-pathname', request.nextUrl.pathname)
  /**
   * ⚠️ nonce 与 CSP 必须设在**请求头**上,不能只设在响应上。
   *    Next 就是靠读请求上的这两个头,才知道该给自己注入的 script 标签
   *    加哪个 nonce。只设响应头的话,脚本没有 nonce → 被 CSP 拦掉 → 白屏。
   */
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // 跳过静态资源与图片优化
    '/((?!_next/static|_next/image|favicon.ico|uploads).*)',
  ],
}
