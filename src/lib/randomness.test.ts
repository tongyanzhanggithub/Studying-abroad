import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import { generateOutTradeNo } from '@/lib/utils'

/**
 * 随机数卫生。
 *
 * ── 为什么单独拉一条 ──────────────────────────────────
 *
 * V8 的 Math.random() 是 xorshift128+,观察到几个输出就能反推内部状态、
 * 预测后续值。凡是「猜中就有后果」的标识符 —— 验证码、订单号、令牌、
 * 一次性链接 —— 都不能用它。
 *
 * 这条规则在 lib/auth/verification.ts 里早就写明了(验证码那儿用的是
 * node:crypto 的 randomInt,还留了注释解释为什么),但 generateOutTradeNo
 * 当时没跟上 —— 说明光在一个文件里写注释是留不住规则的,得有测试。
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

describe('安全相关的标识符不用 Math.random', () => {
  /**
   * 只盯**生成标识符**的文件。UI 里用 Math.random 做个动画抖动是无所谓的,
   * 一刀切禁掉会逼人写 eslint-disable,反而稀释规则。
   */
  const SENSITIVE = [
    'lib/utils.ts', // generateOutTradeNo
    'lib/auth/verification.ts', // 验证码
    'lib/auth/password.ts', // 盐
    'lib/auth/session.ts', // 会话
    'lib/payment/index.ts', // 支付单
    'lib/storage/local.ts', // 文件加密 IV
  ]

  it.each(SENSITIVE)('%s 不出现 Math.random', (rel) => {
    const src = codeOnly(readFileSync(join(SRC, rel), 'utf8'))
    expect(src).not.toContain('Math.random')
  })

  it('清单里的文件都真的存在 —— 文件改名后这条会红,提醒更新清单', () => {
    for (const rel of SENSITIVE) {
      expect(() => readFileSync(join(SRC, rel), 'utf8'), rel).not.toThrow()
    }
  })

  /**
   * 兜底:全项目扫一遍,把用了 Math.random 的文件列出来。
   * 出现在这个名单里不一定是问题,但必须是**有人看过并接受**的。
   */
  it('全项目里用 Math.random 的文件在预期范围内', () => {
    const users = walk(SRC)
      .filter((p) => codeOnly(readFileSync(p, 'utf8')).includes('Math.random'))
      .map((p) => p.slice(SRC.length + 1).replace(/\\/g, '/'))
      .sort()

    // 目前应当一个都没有。将来若有 UI 动画之类的正当用途,加进这里并说明理由。
    expect(users).toEqual([])
  })
})

describe('订单号本身', () => {
  it('前缀 + 14 位时间戳 + 8 位随机段', () => {
    const no = generateOutTradeNo('SUB')
    expect(no).toMatch(/^SUB\d{14}[0-9A-HJKMNP-TV-Z]{8}$/)
  })

  it('随机段不含易混字符 I L O U(Crockford Base32)', () => {
    for (let i = 0; i < 50; i++) {
      const tail = generateOutTradeNo('SUB').slice(-8)
      expect(tail).not.toMatch(/[ILOU]/)
    }
  })

  it('同一毫秒内也不会撞 —— 时间戳只到秒,靠随机段区分', () => {
    const set = new Set(Array.from({ length: 2000 }, () => generateOutTradeNo('SUB')))
    expect(set.size).toBe(2000)
  })
})
