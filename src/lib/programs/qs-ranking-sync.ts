import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * 把 School 上冗余的 QS 字段同步进 SchoolRanking 表。
 *
 * ── 为什么必须有这个 ────────────────────────────────────
 * 排名有两处存储:
 *   - `SchoolRanking`(多榜单 × 多年份,**权威**)
 *   - `School.qsRank / qsRankYear / qsRankSourceUrl`(冗余,给 UI 直接取用)
 *
 * 用户侧全部**优先读 SchoolRanking**,读不到才回落到 School.qsRank ——
 * 见 app/schools/page.tsx 的 overallRankingOf、app/university/[id] 的 rankingRows。
 *
 * ⚠️ 但写的一侧长期只有 import-schools.ts 会写 SchoolRanking,
 *    另外三条路径(后台单条编辑、CSV 导入、data:import)**只写 School.qsRank**。
 *    结果是:一所学校只要有过 SchoolRanking 记录,运营在后台把 QS 排名改对之后 ——
 *
 *      · 后台列表显示的是改后的值(它读 School.qsRank)→ 运营以为改好了
 *      · 用户看到的还是旧值(它读 SchoolRanking)→ 谁都不会发现
 *
 *    这正是「不报错、只是结果悄悄是错的」那类问题,而排名恰恰是本产品
 *    最不能出错的数据(PRD 4.2)。跑完 schools:import 之后 126 所学校
 *    都会有 SchoolRanking 记录,这个坑就从「潜在」变成「必然」。
 *
 * 所以这三条路径写完 School.qsRank 之后,都要调一次本函数把权威表一起写掉。
 *
 * ── 语义 ────────────────────────────────────────────────
 *   有名次 + 有年份 → upsert 这一年的 QS 记录(名次、来源一并写)
 *   名次为空       → 删掉该校所有 QS 记录(运营主动清空 = 没有可信名次,
 *                    按红线宁可不显示,也不能让旧数字继续挂着)
 *   有名次 + 无年份 → 不写 SchoolRanking(建不出记录),但删掉旧的 QS 记录,
 *                    让 UI 回落到 School.qsRank —— 否则编辑照样看不见
 *
 * 返回的是未 await 的 Prisma 操作,调用方可以塞进自己的 $transaction 一起提交。
 */
export function qsRankingSyncOps(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    schoolId: string
    qsRank: number | null | undefined
    qsRankYear: number | null | undefined
    qsRankSourceUrl: string | null | undefined
  },
): Prisma.PrismaPromise<unknown>[] {
  const { schoolId, qsRank, qsRankYear, qsRankSourceUrl } = input

  // undefined = 本次没打算改这几个字段(CSV 留空 / 导入没这一列),什么都不做
  if (qsRank === undefined && qsRankYear === undefined && qsRankSourceUrl === undefined) {
    return []
  }

  if (qsRank === null || qsRank === undefined) {
    return [db.schoolRanking.deleteMany({ where: { schoolId, provider: 'qs' } })]
  }

  if (qsRankYear === null || qsRankYear === undefined) {
    return [db.schoolRanking.deleteMany({ where: { schoolId, provider: 'qs' } })]
  }

  return [
    /**
     * 只删**其它年份**的 QS 记录,不是整表清空 —— 否则下面的 upsert
     * 会把自己刚建的那条也删掉(数组事务按顺序执行)。
     *
     * 为什么要删其它年份:UI 取的是「年份最大的那条」。如果库里还留着一条更新的
     * 年份,运营这次改的值就永远显示不出来,又回到本文件开头那个问题。
     * 后台表单本来就只建模「当前这一届 QS」,不是历年榜单编辑器。
     */
    db.schoolRanking.deleteMany({
      where: { schoolId, provider: 'qs', year: { not: qsRankYear } },
    }),
    db.schoolRanking.upsert({
      where: { schoolId_provider_year: { schoolId, provider: 'qs', year: qsRankYear } },
      create: {
        schoolId,
        provider: 'qs',
        year: qsRankYear,
        rank: qsRank,
        sourceUrl: qsRankSourceUrl ?? null,
      },
      update: {
        rank: qsRank,
        sourceUrl: qsRankSourceUrl ?? null,
      },
    }),
  ]
}
