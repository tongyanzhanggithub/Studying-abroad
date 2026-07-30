import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * CSP。
 *
 * 这一条改动的风险是**整站白屏** —— next.config.mjs 里原来的注释就写着
 * 「不设完整 CSP:配错了整站白屏,而白屏比缺一层纵深防御更糟」。
 * 所以这里的断言盯的不是「策略够不够严」,而是几个**一改就白屏**的前提条件。
 */

const ROOT = process.cwd()
const mw = codeOnly(readFileSync(join(ROOT, 'src/middleware.ts'), 'utf8'))
const nextConfig = codeOnly(readFileSync(join(ROOT, 'next.config.mjs'), 'utf8'))

describe('会导致白屏的前提', () => {
  /**
   * ⚠️ 同名响应头出现两次时,浏览器会**同时执行两条策略、取交集**。
   *    next.config 里那条老的只有 frame-ancestors,和 middleware 那条取交集
   *    等于 script-src 变成「什么都不许」—— 白屏。
   */
  it('next.config 不再下 Content-Security-Policy', () => {
    expect(nextConfig).not.toContain('Content-Security-Policy')
  })

  /**
   * ⚠️ Next 靠读**请求头**上的 x-nonce / CSP 才知道给自己注入的 script
   *    加哪个 nonce。只设响应头 → 脚本没 nonce → 被自己的 CSP 拦掉 → 白屏。
   */
  it('nonce 与 CSP 同时设在请求头上', () => {
    const reqBlock = mw.slice(mw.indexOf('const headers = new Headers'), mw.indexOf('NextResponse.next'))
    expect(reqBlock).toContain("headers.set('x-nonce'")
    expect(reqBlock).toContain("headers.set('Content-Security-Policy'")
  })

  it('响应头上也设了 CSP —— 否则浏览器根本不会执行策略', () => {
    expect(mw).toContain("response.headers.set('Content-Security-Policy'")
  })

  it('每个请求生成新 nonce,不是写死的常量', () => {
    expect(mw).toContain('crypto.randomUUID()')
  })

  /**
   * ⚠️ 开发环境不放开 unsafe-eval 的话,webpack 热更新直接不工作;
   *    生产环境放开就等于把 CSP 对脚本的防护废掉一大半。必须按环境区分。
   */
  it('unsafe-eval 只在开发环境放开', () => {
    expect(mw).toMatch(/isDev\s*\?\s*\["'unsafe-eval'"\]/)
  })
})

describe('挡住真实攻击类别的指令都在', () => {
  it.each([
    ["base-uri 'self'", '挡 <base> 注入 —— 否则一处 HTML 注入就能把所有相对路径改指到攻击者域名'],
    ["form-action 'self'", '挡表单劫持 —— 登录表单被改成往外发就是凭据泄露'],
    ["object-src 'none'", '挡 <object>/<embed> 这类老式脚本执行途径'],
    ["frame-ancestors 'none'", '防点击劫持'],
    ["default-src 'self'", '兜底'],
  ])('%s(%s)', (directive) => {
    expect(mw).toContain(directive)
  })

  it('script-src 用 nonce + strict-dynamic', () => {
    expect(mw).toContain('nonce-')
    expect(mw).toContain("'strict-dynamic'")
  })

  it('connect-src 只允许自己 —— 挡数据外发', () => {
    expect(mw).toContain("connect-src 'self'")
  })

  /**
   * style-src 留了 unsafe-inline(Tailwind 与 Next 都注入内联样式)。
   * 这条测试不是要求收紧,而是**确认这是有意为之**并写清了理由 ——
   * 免得以后有人以为这是漏配、贸然收紧导致样式全丢。
   */
  it('style-src 的 unsafe-inline 有注释说明理由', () => {
    const raw = readFileSync(join(ROOT, 'src/middleware.ts'), 'utf8')
    expect(raw).toContain('style-src')
    expect(raw).toMatch(/Tailwind[\s\S]{0,200}内联样式/)
  })

  it('X-Frame-Options 仍然保留 —— 老浏览器不认 frame-ancestors', () => {
    expect(nextConfig).toContain('X-Frame-Options')
  })
})
