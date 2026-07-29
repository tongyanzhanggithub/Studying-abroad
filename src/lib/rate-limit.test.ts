import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import { rateLimit, __resetRateLimit } from '@/lib/rate-limit'

beforeEach(() => __resetRateLimit())

describe('滑动窗口', () => {
  it('窗口内放行到上限为止', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 60_000).allowed, `第 ${i + 1} 次`).toBe(true)
    }
    expect(rateLimit('k', 3, 60_000).allowed).toBe(false)
  })

  it('不同键互不影响', () => {
    rateLimit('a', 1, 60_000)
    expect(rateLimit('a', 1, 60_000).allowed).toBe(false)
    expect(rateLimit('b', 1, 60_000).allowed).toBe(true)
  })

  it('窗口滑过之后重新放行', async () => {
    expect(rateLimit('k', 1, 30).allowed).toBe(true)
    expect(rateLimit('k', 1, 30).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 45))
    expect(rateLimit('k', 1, 30).allowed).toBe(true)
  })

  it('被拒时不把这一次也计进去 —— 否则持续打会让窗口永远滑不出去', async () => {
    rateLimit('k', 1, 40)
    for (let i = 0; i < 5; i++) rateLimit('k', 1, 40) // 持续被拒
    await new Promise((r) => setTimeout(r, 60))
    expect(rateLimit('k', 1, 40).allowed).toBe(true)
  })

  it('返回窗口内已用次数,便于打日志', () => {
    expect(rateLimit('k', 5, 60_000).count).toBe(1)
    expect(rateLimit('k', 5, 60_000).count).toBe(2)
  })
})

describe('限流器自身不能成为攻击面', () => {
  /**
   * ⚠️ 攻击者伪造大量键(比如换 IP)能把 Map 撑爆 ——
   *    那就从「刷库」变成「刷内存」,换个方式达到同样目的。
   *    超过上限整体清空:代价只是短暂放宽限流,比进程 OOM 好得多。
   */
  it('键数量超上限后整体清空,不会无限增长', () => {
    for (let i = 0; i < 10_050; i++) rateLimit(`key-${i}`, 5, 60_000)
    // 清空过之后,一个早先已经打满的键会重新放行 —— 以此判断确实清了
    for (let i = 0; i < 5; i++) rateLimit('probe', 5, 60_000)
    expect(rateLimit('probe', 5, 60_000).allowed).toBe(false)
    for (let i = 0; i < 10_050; i++) rateLimit(`k2-${i}`, 5, 60_000)
    expect(rateLimit('probe', 5, 60_000).allowed).toBe(true)
  })
})

describe('匿名写接口都接上了', () => {
  const read = (rel: string) => codeOnly(readFileSync(join(process.cwd(), 'src', rel), 'utf8'))

  it.each([
    ['app/assess/actions.ts', 'trackAssessStart'],
    ['app/assess/result/[leadId]/share-actions.ts', 'trackShare'],
    ['app/r/[shareCode]/page.tsx', '分享落地页'],
  ])('%s(%s)调用了 rateLimit', (rel) => {
    expect(read(rel)).toContain('rateLimit(')
  })

  it('都只认 X-Real-IP', () => {
    for (const rel of [
      'app/assess/actions.ts',
      'app/assess/result/[leadId]/share-actions.ts',
      'app/r/[shareCode]/page.tsx',
    ]) {
      const src = read(rel)
      expect(src).toContain("get('x-real-ip')")
      expect(src.toLowerCase()).not.toContain('x-forwarded-for')
    }
  })

  /**
   * 分享链接是获客路径。防刷可以少记一条埋点,但**绝不能把真实用户挡在门外** ——
   * 重定向必须无条件执行。
   */
  it('分享落地页即便被限流也照常重定向', () => {
    const src = read('app/r/[shareCode]/page.tsx')
    // 限流结果只用来决定记不记埋点,不参与是否 redirect
    expect(src).toMatch(/const countable = rateLimit/)
    expect(src).toMatch(/if \(countable\)/)
  })
})

describe('埋点写入口本身封顶', () => {
  const src = codeOnly(
    readFileSync(join(process.cwd(), 'src/lib/analytics.ts'), 'utf8'),
  )

  /**
   * ⚠️ 这是最关键的一道:trackShare / trackAssessStart 是匿名接口,
   *    它们把调用方传的字符串塞进 sourceChannel 和 properties,
   *    而这两个字段在 schema 里是无长度上限的 TEXT。
   *    不封顶的话 `trackShare('A'.repeat(1e7))` 就是一行 10 MB。
   */
  it('sourceChannel / anonymousId 有长度上限', () => {
    expect(src).toContain('clampString(opts.anonymousId')
    expect(src).toContain('clampString(opts.sourceChannel')
  })

  it('properties 有体积上限', () => {
    expect(src).toContain('clampProperties(opts.properties)')
  })
})
