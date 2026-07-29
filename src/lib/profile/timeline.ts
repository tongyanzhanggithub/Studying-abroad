/**
 * 经历时间轴的纯计算部分:排序、空档检测、格式化。
 *
 * ── 为什么值得单独做 ──────────────────────────────────
 *
 * 海外网申普遍要求「从某年起的完整经历,不得有无法解释的空档」。
 * 行业里那份《申请人信息表》为此专门有一节「空闲时段说明」,写着
 * 「如您从大学毕业到现在超过 3 个月,请详细填写…如有中断或辍学,请做出详细解释」——
 * 也就是把「哪儿有空档」这件事**交给学生自己对着日期算**。
 *
 * 表格做不到,产品能做到:把教育和工作合并成一条时间轴,空档就是可计算的。
 * 这是这一块相对纸质表格唯一真正的增量,所以逻辑抽成纯函数并写测试。
 *
 * ⚠️ 全部用 YYYY-MM 字符串比较,不转 Date。
 *    网申问的就是年月,转成 Date 会凭空造出一个「几号」,还要处理时区 ——
 *    而这个项目已经因为时区问题吃过一次亏(见 lib/utils.ts 的 localDay)。
 *    字符串按字典序比较对 YYYY-MM 天然正确。
 */

export interface TimelineItem {
  id: string
  kind: 'education' | 'work' | 'other'
  /** YYYY-MM */
  startYm: string
  /** YYYY-MM,null = 至今 */
  endYm: string | null
  organization: string
  role?: string | null
}

export interface TimelineGap {
  /** 空档的起止(YYYY-MM),from 是上一段结束的次月,to 是下一段开始的前一月 */
  from: string
  to: string
  months: number
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidYm(v: string): boolean {
  return YM.test(v)
}

/** YYYY-MM → 从 0 年 1 月起的月数,用于做差 */
function toMonths(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return y * 12 + (m - 1)
}

function fromMonths(n: number): string {
  const y = Math.floor(n / 12)
  const m = (n % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/** 按开始时间升序;同月开始的把先结束的排前面 */
export function sortTimeline<T extends TimelineItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.startYm !== b.startYm) return a.startYm.localeCompare(b.startYm)
    const ae = a.endYm ?? '9999-12'
    const be = b.endYm ?? '9999-12'
    return ae.localeCompare(be)
  })
}

/**
 * 找出时间轴上的空档。
 *
 * ⚠️ 必须按「已覆盖到的最晚月份」推进,不能拿相邻两条比。
 *    经历是会重叠的 —— 一边读书一边实习非常普遍。拿相邻两条比的话,
 *    「2023-09 至 2027-06 在读」后面跟一条「2024-07 至 2024-08 实习」,
 *    会被误判成从 2027-07 开始有空档,而实际上整段都被在读覆盖着。
 *
 * @param graceMonths 容忍的空档月数。默认 3 —— 和行业表格「超过 3 个月需说明」
 *                    的口径一致,也符合暑假、毕业到入学之间的正常间隔。
 */
export function findGaps(items: TimelineItem[], graceMonths = 3): TimelineGap[] {
  const valid = items.filter((i) => isValidYm(i.startYm))
  if (valid.length < 2) return []

  const sorted = sortTimeline(valid)
  const gaps: TimelineGap[] = []

  // 已经被覆盖到的最晚月份(闭区间)
  let coveredTo = sorted[0].endYm && isValidYm(sorted[0].endYm)
    ? toMonths(sorted[0].endYm)
    : Infinity

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    // 前面有一段「至今」,后面不可能存在空档
    if (coveredTo === Infinity) break

    const start = toMonths(cur.startYm)
    const gapMonths = start - coveredTo - 1

    if (gapMonths > graceMonths) {
      gaps.push({
        from: fromMonths(coveredTo + 1),
        to: fromMonths(start - 1),
        months: gapMonths,
      })
    }

    const end = cur.endYm && isValidYm(cur.endYm) ? toMonths(cur.endYm) : Infinity
    coveredTo = Math.max(coveredTo, end)
  }

  return gaps
}

/** 展示用:2024-07 → 2024 年 7 月 */
export function formatYm(ym: string): string {
  if (!isValidYm(ym)) return ym
  const [y, m] = ym.split('-')
  return `${y} 年 ${Number(m)} 月`
}

export function formatRange(startYm: string, endYm: string | null): string {
  return `${formatYm(startYm)} — ${endYm ? formatYm(endYm) : '至今'}`
}

/**
 * 校验一条经历的时间是否合法。
 * 返回 null 表示没问题,否则返回给用户看的中文提示。
 */
export function validateEntry(startYm: string, endYm: string | null): string | null {
  if (!isValidYm(startYm)) return '开始时间请填成 2024-09 这样的年月格式。'
  if (endYm) {
    if (!isValidYm(endYm)) return '结束时间请填成 2024-09 这样的年月格式,或留空表示至今。'
    if (endYm < startYm) return '结束时间不能早于开始时间。'
  }
  return null
}
