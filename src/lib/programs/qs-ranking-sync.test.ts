import { describe, it, expect } from 'vitest'
import { syncQsRanking } from './qs-ranking-sync'

/**
 * 用一个假 client 录下「本函数发出了哪些写操作」。
 *
 * 这里要守住的是**语义**,不是 SQL —— 语义错了的表现是
 * 「后台改了排名、用户看到的还是旧值」,或者「改一年把别的年份也删了」,
 * 两种都不报错。
 */
function fakeDb(latest: { year: number; rank: number | null; sourceUrl: string | null } | null = null) {
  const calls: Array<{ op: string; args: unknown }> = []
  const rec = (op: string, ret?: unknown) => async (args: unknown) => {
    calls.push({ op, args })
    return ret as never
  }
  return {
    calls,
    only: (op: string) => calls.filter((c) => c.op === op),
    db: {
      schoolRanking: {
        upsert: rec('upsert'),
        deleteMany: rec('deleteMany'),
        findFirst: rec('findFirst', latest),
      },
      school: { update: rec('school.update') },
    } as never,
  }
}

const SCHOOL = 'school_1'

describe('syncQsRanking —— 不该动排名的情况', () => {
  it('三个字段都是 undefined(CSV 留空 / 导入没这几列)→ 一个写操作都不发', async () => {
    const { db, calls } = fakeDb()
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: undefined,
      qsRankYear: undefined,
      qsRankSourceUrl: undefined,
    })
    expect(calls).toHaveLength(0)
  })
})

describe('syncQsRanking —— 写入某一年', () => {
  it('名次 + 年份 → upsert 这一年', async () => {
    const { db, only } = fakeDb({ year: 2027, rank: 4, sourceUrl: 'https://example.edu/rank' })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: 4,
      qsRankYear: 2027,
      qsRankSourceUrl: 'https://example.edu/rank',
    })
    expect(only('upsert')[0].args).toMatchObject({
      where: { schoolId_provider_year: { schoolId: SCHOOL, provider: 'qs', year: 2027 } },
      create: { rank: 4, year: 2027, sourceUrl: 'https://example.edu/rank' },
      update: { rank: 4, sourceUrl: 'https://example.edu/rank' },
    })
  })

  /**
   * ⚠️ 这是「按年份分」这个决定的核心约束。
   *    早先的实现会把非本年的 QS 记录一并删掉,等于把历年榜单抹平成一条。
   *    库里现在同时存着 QS 2026(多国扩展清单)与 QS 2027(已有院校回填),
   *    删掉任何一边都是丢数据。
   */
  it('绝不删其它年份', async () => {
    const { db, only } = fakeDb({ year: 2027, rank: 4, sourceUrl: null })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: 4,
      qsRankYear: 2027,
      qsRankSourceUrl: null,
    })
    expect(only('deleteMany')).toHaveLength(0)
  })

  it('来源留空也照写名次 —— 来源缺失不该让排名整条丢掉', async () => {
    const { db, only } = fakeDb({ year: 2027, rank: 62, sourceUrl: null })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: 62,
      qsRankYear: 2027,
      qsRankSourceUrl: undefined,
    })
    expect(only('upsert')[0].args).toMatchObject({ create: { sourceUrl: null } })
  })
})

describe('syncQsRanking —— 撤回某一年', () => {
  it('名次清空 + 有年份 → 只删这一年', async () => {
    const { db, only } = fakeDb({ year: 2026, rank: 113, sourceUrl: null })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: null,
      qsRankYear: 2027,
      qsRankSourceUrl: null,
    })
    expect(only('deleteMany')[0].args).toEqual({
      where: { schoolId: SCHOOL, provider: 'qs', year: 2027 },
    })
    expect(only('upsert')).toHaveLength(0)
  })

  /** 撤回最新一年后,更早的那年自然成为当前展示的那条 */
  it('撤回后冗余字段落到剩下年份里最大的那条', async () => {
    const { db, only } = fakeDb({ year: 2026, rank: 113, sourceUrl: 'https://qs/2026' })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: null,
      qsRankYear: 2027,
      qsRankSourceUrl: null,
    })
    expect(only('school.update')[0].args).toMatchObject({
      data: { qsRank: 113, qsRankYear: 2026, qsRankSourceUrl: 'https://qs/2026' },
    })
  })
})

describe('syncQsRanking —— 冗余字段对齐', () => {
  /**
   * ⚠️ School.qsRank 必须等于「UI 实际会展示的那条」,也就是年份最大的那条。
   *    不对齐的话,后台列表(读冗余字段)和用户侧(读权威表)会显示两个不同的数字,
   *    而这正是这个文件存在的原因。
   */
  it('写完之后按年份最大的那条回写,而不是回写刚才传进来的值', async () => {
    // 传进来的是 2026 的数据,但库里还有更新的 2027
    const { db, only } = fakeDb({ year: 2027, rank: 4, sourceUrl: 'https://qs/2027' })
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: 113,
      qsRankYear: 2026,
      qsRankSourceUrl: 'https://qs/2026',
    })
    expect(only('school.update')[0].args).toMatchObject({
      data: { qsRank: 4, qsRankYear: 2027, qsRankSourceUrl: 'https://qs/2027' },
    })
  })

  it('权威表一条都没有时,才落回调用方给的值', async () => {
    const { db, only } = fakeDb(null)
    await syncQsRanking(db, {
      schoolId: SCHOOL,
      qsRank: 50,
      qsRankYear: null,
      qsRankSourceUrl: 'https://qs/unknown-year',
    })
    expect(only('school.update')[0].args).toMatchObject({
      data: { qsRank: 50, qsRankYear: null, qsRankSourceUrl: 'https://qs/unknown-year' },
    })
    // 年份不明 → 没法安放进按年份分的权威表,不写也不删
    expect(only('upsert')).toHaveLength(0)
    expect(only('deleteMany')).toHaveLength(0)
  })
})
