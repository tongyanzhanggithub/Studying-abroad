/**
 * 采集到的申请周期清洗 —— 决定 `Program.finalDeadline` 这一列的值。
 *
 * ── 为什么值得单独放一个文件 ──────────────────────────
 *
 * 这个函数决定**全站每一个倒计时的数据源**:院校库卡片、仪表盘、
 * 材料中心的「赶不上」、行动计划、每日提醒短信,全都读 Program.finalDeadline。
 *
 * 而它原来埋在 scripts/import-programs.ts 里,既不导出、上面又压着一个
 * 顶层就会连库跑批的 main() —— 想单独调一次都做不到,所以**一条测试都没有**。
 * 这和 planActions、settlement-math、refund-math 当初抽出来是同一个理由:
 * 影响面越大的纯逻辑,越不该只能靠人眼看。
 *
 * ⚠️ 从脚本里**原样搬过来的,一行逻辑都没改**。搬动本身不该改变任何行为,
 *    下面的测试就是用来钉住这一点的。
 */

/** 一轮申请。字段可空 —— 采集到的数据经常缺项 */
export interface RawRound {
  name?: string
  deadline?: string | null
  decision_by?: string | null
}

export interface RawDeadlines {
  opens_at?: string | null
  rolling?: boolean | null
  rounds?: RawRound[] | null
  final_deadline?: string | null
  notes?: string | null
}

export interface SanitizedDeadlines {
  /** 写进 Program.deadlines(Json 列)—— 详情页的轮次表读它 */
  deadlines: Record<string, unknown>
  /** 写进 Program.finalDeadline(独立列)—— 所有倒计时读它 */
  finalDeadline: Date | null
  /** 是否发生了降级(日期被判为上一届残留而置空),导入脚本据此告警 */
  downgraded: boolean
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 过期周期兜底。返回清洗后的 deadlines 与是否发生降级。
 *
 * ⚠️ 已知的口径分歧,**这次没有改**,只是用测试钉住现状:
 *
 *    `finalDeadline` 取的是「所有已知日期里最早的那个**未来**日期」,
 *    而 allDates 同时包含 final_deadline 和**各轮次的截止日**。
 *    于是一个有轮次的项目:
 *
 *      原始   第1轮 2026-10-15 / 第2轮 2027-01-10 / 最终截止 2027-03-01
 *      结果   finalDeadline 列 = 2026-10-15(卡片倒计时说「还有 N 天截止」)
 *             deadlines.final_deadline = 2027-03-01(详情页说「最终截止」)
 *
 *    也就是同一个项目两页两个日期,而 10-15 那天其实什么都不会关闭。
 *
 *    两种改法都说得通,取决于产品意图:
 *      · 倒计时想指向「下一个该动手的日期」→ 现在的取值是对的,该改的是文案
 *      · 倒计时想指向「申请通道关闭」→ 该只看 final_deadline
 *    没定之前不动。见 deadline-sanitize.test.ts 里那一组用例。
 */
export function sanitizeDeadlines(
  raw: RawDeadlines | null | undefined,
  today: Date,
): SanitizedDeadlines {
  const d = raw ?? {}
  const rounds = (d.rounds ?? []).filter((r): r is RawRound => !!r)

  const finalDate = parseDate(d.final_deadline)
  const roundDates = rounds.map((r) => parseDate(r.deadline)).filter((x): x is Date => !!x)
  const allDates = [finalDate, ...roundDates].filter((x): x is Date => !!x)
  const latest = allDates.sort((a, b) => b.getTime() - a.getTime())[0]

  // 所有已知日期都在今天之前 → 这是上一届的周期,整条不能用
  const isStaleCycle = !!latest && latest < today

  if (!isStaleCycle) {
    /**
     * 即便整体周期没过期,单个日期仍可能是上一届残留
     * (常见于官网轮次表已更新、但 final deadline 那一行没同步)。
     *
     * `finalDeadline` 这一列是前端倒计时的数据源,**绝不能是过去的日期** ——
     * 否则用户会看到「还有 -20 天」。取所有已知日期里最早的那个**未来**日期;
     * 一个都没有就置 null,前端会显示「截止日待公布」。
     */
    const upcoming = allDates
      .filter((x) => x >= today)
      .sort((a, b) => a.getTime() - b.getTime())[0]

    const finalIsStale = !!finalDate && finalDate < today

    return {
      deadlines: {
        opens_at: d.opens_at ?? null,
        rolling: d.rolling ?? false,
        rounds,
        final_deadline: finalIsStale ? null : (d.final_deadline ?? null),
        notes: finalIsStale
          ? `【最终截止日期 ${d.final_deadline} 已过期,已置空】该日期可能是上一届残留,轮次表中仍有未来日期。${d.notes ?? ''}`
          : (d.notes ?? null),
      },
      finalDeadline: upcoming ?? null,
      downgraded: finalIsStale,
    }
  }

  const archived = [
    d.opens_at ? `开放:${d.opens_at}` : null,
    d.final_deadline ? `最终截止:${d.final_deadline}` : null,
    ...rounds.map((r) => (r.deadline ? `${r.name ?? '轮次'}:${r.deadline}` : null)),
  ]
    .filter(Boolean)
    .join(' / ')

  return {
    deadlines: {
      opens_at: null,
      rolling: d.rolling ?? false,
      rounds: [],
      final_deadline: null,
      notes:
        `【上一届周期,日期已置空】采集到的申请周期已过期,不可用于规划。` +
        `原始日期存档:${archived}。${d.notes ?? ''}`,
    },
    finalDeadline: null,
    downgraded: true,
  }
}
