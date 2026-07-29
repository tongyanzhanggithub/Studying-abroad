import { describe, it, expect, vi, beforeEach } from 'vitest'
import { track } from '@/lib/analytics'

/**
 * 埋点写入的体积封顶。
 *
 * trackAssessStart / trackShare 是**不需要登录**的 server action,把调用方传的
 * 字符串原样塞进 sourceChannel 和 properties —— 而这两个字段在 schema 里是
 * 没有长度上限的 TEXT。不封顶的话 `trackShare('A'.repeat(1e7))` 就是一行 10 MB,
 * 几百次调用就是几个 GB,而 Postgres 和应用在同一台 2 核机器上。
 *
 * 封顶必须在**写入口**做:指望每个调用方各自校验,迟早会漏。
 */

const create = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { analyticsEvent: { create: (...a: unknown[]) => create(...a) } },
}))

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({})
})

/** 取出这次写入的 data */
function written() {
  return create.mock.calls[0][0].data as {
    sourceChannel: string | null
    anonymousId: string | null
    properties: Record<string, unknown>
  }
}

describe('字符串字段封顶', () => {
  it('超长 sourceChannel 被截断', async () => {
    await track('assess_start', { sourceChannel: 'A'.repeat(10_000) })
    expect(written().sourceChannel!.length).toBeLessThanOrEqual(64)
  })

  it('超长 anonymousId 被截断', async () => {
    await track('assess_start', { anonymousId: 'B'.repeat(10_000) })
    expect(written().anonymousId!.length).toBeLessThanOrEqual(64)
  })

  it('空串与纯空白存成 null,不占位', async () => {
    await track('assess_start', { sourceChannel: '   ' })
    expect(written().sourceChannel).toBeNull()
  })

  it('正常值原样保留', async () => {
    await track('assess_start', { sourceChannel: 'wechat' })
    expect(written().sourceChannel).toBe('wechat')
  })
})

describe('properties 封顶', () => {
  it('超大 properties 整体丢弃并留标记', async () => {
    await track('assess_share', { properties: { shareCode: 'A'.repeat(10_000_000) } })
    const p = written().properties
    expect(p._dropped).toBe('too_large')
    // 关键:原始的巨大字符串没有被写进去
    expect(JSON.stringify(p).length).toBeLessThan(200)
  })

  /**
   * ⚠️ 丢弃而不是截断:截断会产生半截 JSON,分析时更难发现数据是坏的;
   *    一个明确的 _dropped 标记能让人一眼看出这里发生过什么。
   */
  it('丢弃时带上原始体积,便于事后判断是不是被攻击', async () => {
    await track('assess_share', { properties: { x: 'A'.repeat(100_000) } })
    expect(written().properties._size).toBeGreaterThan(100_000)
  })

  it('正常大小的 properties 原样保留', async () => {
    await track('assess_share', { properties: { shareCode: 'abc123', n: 3 } })
    expect(written().properties).toEqual({ shareCode: 'abc123', n: 3 })
  })

  it('不可序列化的对象不会让埋点抛错', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(track('assess_share', { properties: circular })).resolves.toBeUndefined()
    expect(written().properties._dropped).toBe('unserializable')
  })

  it('没有 properties 时写空对象', async () => {
    await track('assess_start', {})
    expect(written().properties).toEqual({})
  })
})

describe('写入失败不影响主流程', () => {
  it('数据库报错时不向上抛', async () => {
    create.mockRejectedValue(new Error('数据库炸了'))
    await expect(track('assess_start', {})).resolves.toBeUndefined()
  })
})
