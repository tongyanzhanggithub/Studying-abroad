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
 * ⚠️ 抽出来时是**原样搬的,一行逻辑没改**(用 git 逐字比对确认过),
 *    测试补齐之后才动的口径 —— 见下面 sanitizeDeadlines 上的说明。
 *    顺序是刻意的:先有测试,再改行为,否则改完没人知道改动了什么。
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
 * ── 口径(2026-08-19 定)────────────────────────────
 *
 * `finalDeadline` = **申请通道关闭的那一天**,只认 final_deadline,
 * 不拿轮次日期顶替。理由和实测数据见下面函数上的注释。
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
     * 否则用户会看到「还有 -20 天」。
     *
     * ⚠️ 口径:倒计时表示**申请通道关闭**,所以这一列**只认 final_deadline**,
     *    不拿轮次日期顶替。
     *
     *    原来取的是「所有已知日期里最早的未来日期」,而那批日期同时包含各轮次 ——
     *    于是有轮次的项目,列里存的其实是**下一轮**的日期,卡片却写「还有 N 天截止」,
     *    而那天什么都不会关闭。拿 data/raw 的 310 个项目实测(以 2026-09-01 为今天):
     *    76 个有未来的最终截止日,其中 **31 个(41%)**倒计时指向的是更早的轮次。
     *    最夸张的是 UBC 的 Master of Management:倒计时到 2026-10-06,
     *    而申请通道 2027-05-04 才关 —— 早了七个月。学生会以为自己错过了。
     *
     * ⚠️ 拿不到可用的最终截止日时**置 null,不用最后一轮顶替**。
     *    前端显示「截止日待公布」,详情页照样列出轮次表,学生看得到。
     *    顶替等于我们替官网宣布了一个它没说过的关闭日期 —— 正是这一轮
     *    在反复修的那类错误。实测这种情况只有 1 个项目(NUS 供应链)。
     */
    const finalIsStale = !!finalDate && finalDate < today
    const channelClose = finalDate && finalDate >= today ? finalDate : null

    const hasFutureRound = roundDates.some((x) => x >= today)
    const noCloseButRounds = !channelClose && hasFutureRound

    return {
      deadlines: {
        opens_at: d.opens_at ?? null,
        rolling: d.rolling ?? false,
        rounds,
        final_deadline: finalIsStale ? null : (d.final_deadline ?? null),
        notes: finalIsStale
          ? `【最终截止日期 ${d.final_deadline} 已过期,已置空】该日期可能是上一届残留,轮次表中仍有未来日期。${d.notes ?? ''}`
          : noCloseButRounds
            ? `【无可用的最终截止日】轮次表里有未来日期,但官网未给出申请通道关闭日,故不做倒计时。${d.notes ?? ''}`
            : (d.notes ?? null),
      },
      finalDeadline: channelClose,
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
