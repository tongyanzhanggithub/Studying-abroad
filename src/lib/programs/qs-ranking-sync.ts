import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * 把后台/导入写的 QS 排名同步进 SchoolRanking(权威表),并回写 School 上的冗余字段。
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
 * ── 多年份并存是**刻意保留**的 ──────────────────────────
 * 库里同时有 QS 2026 和 QS 2027 的数据(前者来自多国扩展清单,后者是已有院校的回填)。
 * 已决定**按年份分开存**,不强行统一到一版:UI 取每所学校年份最大的那条,
 * 并把年份一起显示出来(「QS 2026 综合 #113」),用户看得见自己在比什么。
 *
 * ⚠️ 所以这里**只动被指定的那一年**,绝不删其它年份 ——
 *    早先版本会把非本年的 QS 记录一并删掉,那等于把历年榜单抹平成一条,
 *    和「按年份分」的决定正相反。
 *
 * ── 语义 ────────────────────────────────────────────────
 *   三个字段都是 undefined  → 本次不打算改排名(CSV 留空 / 导入没这几列),什么都不做
 *   有名次 + 有年份         → upsert 这一年的 QS 记录
 *   名次为空 + 有年份       → 删掉这一年的记录(撤回这一年的数字);
 *                             若还有更早年份的记录,它自然成为当前展示的那条
 *   有名次 + 无年份         → 调用方应当先拦住(见 saveProgram 的校验)。
 *                             真走到这里就只写冗余字段、不碰权威表 ——
 *                             年份不明的名次没法在多年份表里安放,但也不能凭空丢掉。
 *
 * 最后把 School 的冗余字段对齐到**年份最大的那条**记录;一条记录都没有时,
 * 才落回调用方传进来的值。这样冗余字段永远等于 UI 实际展示的那个数。
 */
export async function syncQsRanking(
  db: Db,
  input: {
    schoolId: string
    qsRank: number | null | undefined
    qsRankYear: number | null | undefined
    qsRankSourceUrl: string | null | undefined
  },
): Promise<void> {
  const { schoolId, qsRank, qsRankYear, qsRankSourceUrl } = input

  if (qsRank === undefined && qsRankYear === undefined && qsRankSourceUrl === undefined) {
    return
  }

  if (typeof qsRankYear === 'number') {
    if (typeof qsRank === 'number') {
      await db.schoolRanking.upsert({
        where: { schoolId_provider_year: { schoolId, provider: 'qs', year: qsRankYear } },
        create: {
          schoolId,
          provider: 'qs',
          year: qsRankYear,
          rank: qsRank,
          sourceUrl: qsRankSourceUrl ?? null,
        },
        update: { rank: qsRank, sourceUrl: qsRankSourceUrl ?? null },
      })
    } else if (qsRank === null) {
      // 撤回这一年的名次。只删这一年 —— 其它年份是独立的事实,不该被连坐
      await db.schoolRanking.deleteMany({
        where: { schoolId, provider: 'qs', year: qsRankYear },
      })
    }
  }

  /**
   * 冗余字段对齐到年份最大的那条 —— 它就是 UI 会展示的那条(latestRanking 按年份倒序取第一)。
   * 不这么做的话,后台列表(读冗余字段)和用户侧(读权威表)会显示两个不同的数字,
   * 而这正是本文件开头那个 bug 的形态。
   */
  const latest = await db.schoolRanking.findFirst({
    where: { schoolId, provider: 'qs' },
    orderBy: { year: 'desc' },
    select: { year: true, rank: true, sourceUrl: true },
  })

  await db.school.update({
    where: { id: schoolId },
    data: latest
      ? { qsRank: latest.rank, qsRankYear: latest.year, qsRankSourceUrl: latest.sourceUrl }
      : {
          // 权威表里一条都没有 —— 只能用调用方给的值(可能是年份不明的名次)
          qsRank: qsRank ?? null,
          qsRankYear: qsRankYear ?? null,
          qsRankSourceUrl: qsRankSourceUrl ?? null,
        },
  })
}
