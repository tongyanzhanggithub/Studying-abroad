import { describe, it, expect } from 'vitest'
import { qsRankingSyncOps } from './qs-ranking-sync'

/**
 * 用一个假 client 把「本函数会发出哪些写操作」录下来。
 * 这里要守住的是**语义**,不是 SQL —— 语义错了的表现是
 * 「后台改了排名、用户看到的还是旧值」,没有任何报错。
 */
function fakeDb() {
  const calls: Array<{ op: string; args: unknown }> = []
  const rec = (op: string) => (args: unknown) => {
    calls.push({ op, args })
    return { __op: op } as never
  }
  return {
    calls,
    db: {
      schoolRanking: {
        deleteMany: rec('deleteMany'),
        upsert: rec('upsert'),
      },
    } as never,
  }
}

const SCHOOL = 'school_1'

describe('qsRankingSyncOps —— 不该动排名的情况', () => {
  it('三个字段都是 undefined(CSV 留空 / 导入没这几列)→ 一个写操作都不发', () => {
    const { db, calls } = fakeDb()
    const ops = qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: undefined,
      qsRankYear: undefined,
      qsRankSourceUrl: undefined,
    })
    expect(ops).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})

describe('qsRankingSyncOps —— 清空名次', () => {
  it('运营把名次清空 → 删掉该校全部 QS 记录(不能让旧数字继续挂着)', () => {
    const { db, calls } = fakeDb()
    qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: null,
      qsRankYear: 2027,
      qsRankSourceUrl: null,
    })
    expect(calls).toEqual([
      { op: 'deleteMany', args: { where: { schoolId: SCHOOL, provider: 'qs' } } },
    ])
  })

  it('有名次但没年份 → 建不出记录,删掉旧记录让 UI 回落到 School.qsRank', () => {
    const { db, calls } = fakeDb()
    qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: 4,
      qsRankYear: null,
      qsRankSourceUrl: 'https://example.edu',
    })
    expect(calls).toEqual([
      { op: 'deleteMany', args: { where: { schoolId: SCHOOL, provider: 'qs' } } },
    ])
  })
})

describe('qsRankingSyncOps —— 写入名次', () => {
  it('名次 + 年份齐全 → 先删其它年份,再 upsert 这一年', () => {
    const { db, calls } = fakeDb()
    const ops = qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: 4,
      qsRankYear: 2027,
      qsRankSourceUrl: 'https://example.edu/rank',
    })
    expect(ops).toHaveLength(2)
    expect(calls[0]).toEqual({
      op: 'deleteMany',
      args: { where: { schoolId: SCHOOL, provider: 'qs', year: { not: 2027 } } },
    })
    expect(calls[1].op).toBe('upsert')
    expect(calls[1].args).toMatchObject({
      where: { schoolId_provider_year: { schoolId: SCHOOL, provider: 'qs', year: 2027 } },
      create: { rank: 4, year: 2027, sourceUrl: 'https://example.edu/rank' },
      update: { rank: 4, sourceUrl: 'https://example.edu/rank' },
    })
  })

  /**
   * ⚠️ 删除条件必须是 `year: { not: Y }` 而不是整表清空。
   *    数组事务按顺序执行,整表清空会把紧接着 upsert 出来的那条一起带走,
   *    结果是「改完排名反而什么都不显示了」。
   */
  it('删除条件排除了本次要写的年份', () => {
    const { db, calls } = fakeDb()
    qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: 10,
      qsRankYear: 2026,
      qsRankSourceUrl: null,
    })
    const where = (calls[0].args as { where: Record<string, unknown> }).where
    expect(where.year).toEqual({ not: 2026 })
  })

  it('来源留空也照写名次 —— 来源缺失不该让排名整条丢掉', () => {
    const { db, calls } = fakeDb()
    qsRankingSyncOps(db, {
      schoolId: SCHOOL,
      qsRank: 62,
      qsRankYear: 2027,
      qsRankSourceUrl: undefined,
    })
    expect(calls[1].args).toMatchObject({ create: { sourceUrl: null } })
  })
})
