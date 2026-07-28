import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RETENTION_POLICY, runRetentionCleanup } from '@/lib/retention'

/**
 * 保留期清理是**自动跑的删除任务**,删错了没有回头路(只能翻备份)。
 * 所以这里盯的不是「删得干不干净」,而是几条不能破的底线:
 *   · 各表的截止时间算对了(算错一位就是多删几个月的数据)
 *   · 学生正在编辑的那一版文书**绝不能被删**
 *   · 刻意封存的留痕(润色前 / 终稿)不被清掉
 *   · 一张表失败不会拖垮其余两张
 */

const deleteMany = {
  verificationCode: vi.fn(),
  analyticsEvent: vi.fn(),
  essayVersion: vi.fn(),
}
const essayFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    verificationCode: { deleteMany: (...a: unknown[]) => deleteMany.verificationCode(...a) },
    analyticsEvent: { deleteMany: (...a: unknown[]) => deleteMany.analyticsEvent(...a) },
    essayVersion: { deleteMany: (...a: unknown[]) => deleteMany.essayVersion(...a) },
    essay: { findMany: (...a: unknown[]) => essayFindMany(...a) },
  },
}))

const NOW = new Date('2026-07-28T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  deleteMany.verificationCode.mockResolvedValue({ count: 3 })
  deleteMany.analyticsEvent.mockResolvedValue({ count: 5 })
  deleteMany.essayVersion.mockResolvedValue({ count: 7 })
  essayFindMany.mockResolvedValue([])
})

/** 取某次 deleteMany 调用里的 createdAt.lt 截止时间 */
function cutoffOf(fn: { mock: { calls: unknown[][] } }): Date {
  const arg = fn.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }
  return arg.where.createdAt.lt
}

describe('截止时间', () => {
  it('验证码按小时算,埋点与文书版本按天算', async () => {
    await runRetentionCleanup(NOW)

    const hours = (d: Date) => (NOW.getTime() - d.getTime()) / 3600_000
    const days = (d: Date) => (NOW.getTime() - d.getTime()) / 86_400_000

    expect(hours(cutoffOf(deleteMany.verificationCode))).toBe(RETENTION_POLICY.verificationCodeHours)
    expect(days(cutoffOf(deleteMany.analyticsEvent))).toBe(RETENTION_POLICY.analyticsEventDays)
    expect(days(cutoffOf(deleteMany.essayVersion))).toBe(RETENTION_POLICY.essayVersionDays)
  })

  it('验证码的保留期必须长于限流窗口(1 小时),否则会把还在用的行删掉', () => {
    expect(RETENTION_POLICY.verificationCodeHours).toBeGreaterThan(1)
  })

  it('埋点保留期覆盖得住看板的 7 天口径', () => {
    expect(RETENTION_POLICY.analyticsEventDays).toBeGreaterThan(7)
  })
})

describe('文书版本 —— 最不能出错的一项', () => {
  it('把所有 currentVersionId 排除在删除之外', async () => {
    essayFindMany.mockResolvedValue([
      { currentVersionId: 'v-current-1' },
      { currentVersionId: 'v-current-2' },
    ])

    await runRetentionCleanup(NOW)

    const where = (deleteMany.essayVersion.mock.calls[0][0] as {
      where: { id: { notIn: string[] } }
    }).where
    expect(where.id.notIn).toEqual(['v-current-1', 'v-current-2'])
  })

  it('currentVersionId 为 null 的不会混进排除名单', async () => {
    essayFindMany.mockResolvedValue([{ currentVersionId: 'v-1' }, { currentVersionId: null }])

    await runRetentionCleanup(NOW)

    const where = (deleteMany.essayVersion.mock.calls[0][0] as {
      where: { id: { notIn: string[] } }
    }).where
    // null 混进 notIn 会让整个条件在 SQL 里变成三值逻辑,可能一行都删不掉
    expect(where.id.notIn).toEqual(['v-1'])
  })

  it('只删无 label 的版本 —— 润色前 / 终稿的留痕要保住', async () => {
    await runRetentionCleanup(NOW)

    const where = (deleteMany.essayVersion.mock.calls[0][0] as {
      where: { label: null }
    }).where
    expect(where.label).toBeNull()
  })
})

describe('单表失败不拖垮其余', () => {
  it('验证码删除抛错时,另外两张照删,并把错误报上来', async () => {
    deleteMany.verificationCode.mockRejectedValue(new Error('连接被回收'))

    const res = await runRetentionCleanup(NOW)

    expect(res.verificationCodes).toBe(0)
    expect(res.analyticsEvents).toBe(5)
    expect(res.essayVersions).toBe(7)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toContain('连接被回收')
  })

  it('全部成功时 errors 为空 —— 定时任务据此决定要不要记心跳', async () => {
    const res = await runRetentionCleanup(NOW)
    expect(res.errors).toEqual([])
    expect(res).toMatchObject({ verificationCodes: 3, analyticsEvents: 5, essayVersions: 7 })
  })
})
