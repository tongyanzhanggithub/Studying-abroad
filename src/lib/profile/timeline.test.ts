import { describe, it, expect } from 'vitest'
import {
  findGaps,
  sortTimeline,
  isValidYm,
  formatYm,
  formatRange,
  validateEntry,
  type TimelineItem,
} from '@/lib/profile/timeline'

let seq = 0
function entry(
  startYm: string,
  endYm: string | null,
  kind: TimelineItem['kind'] = 'education',
): TimelineItem {
  return { id: `e${seq++}`, kind, startYm, endYm, organization: '某机构' }
}

describe('年月格式', () => {
  it('接受合法的 YYYY-MM', () => {
    for (const v of ['2024-01', '2024-12', '1999-09']) expect(isValidYm(v)).toBe(true)
  })

  it('拒绝非法月份和其他格式', () => {
    for (const v of ['2024-00', '2024-13', '2024-1', '24-01', '2024/01', '2024', '']) {
      expect(isValidYm(v)).toBe(false)
    }
  })
})

describe('排序', () => {
  it('按开始时间升序', () => {
    const out = sortTimeline([entry('2024-01', null), entry('2020-09', '2024-06')])
    expect(out[0].startYm).toBe('2020-09')
  })

  it('同月开始时,先结束的排前面', () => {
    const out = sortTimeline([entry('2024-07', '2024-12'), entry('2024-07', '2024-08')])
    expect(out[0].endYm).toBe('2024-08')
  })

  it('至今(endYm 为 null)排在同月开始的最后', () => {
    const out = sortTimeline([entry('2024-07', null), entry('2024-07', '2024-08')])
    expect(out[0].endYm).toBe('2024-08')
    expect(out[1].endYm).toBeNull()
  })

  it('不修改入参', () => {
    const input = [entry('2024-01', null), entry('2020-09', '2024-06')]
    const first = input[0]
    sortTimeline(input)
    expect(input[0]).toBe(first)
  })
})

describe('空档检测', () => {
  it('连续的经历没有空档', () => {
    expect(findGaps([entry('2020-09', '2024-06'), entry('2024-07', null)])).toHaveLength(0)
  })

  it('三个月以内的间隔不报 —— 暑假、毕业到入学都属正常', () => {
    // 2024-07、08、09 三个月空档
    expect(findGaps([entry('2020-09', '2024-06'), entry('2024-10', null)])).toHaveLength(0)
  })

  it('超过三个月报出来,并给出准确的起止和月数', () => {
    // 2024-07 ~ 2024-12,六个月
    const gaps = findGaps([entry('2020-09', '2024-06'), entry('2025-01', null)])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ from: '2024-07', to: '2024-12', months: 6 })
  })

  /**
   * ⚠️ 这条是这个函数最容易写错的地方。
   *
   *    经历是会重叠的 —— 一边读书一边实习非常普遍。如果拿**相邻两条**比,
   *    「2020-09 至 2024-06 在读」后面跟一条「2022-07 至 2022-08 实习」,
   *    就会从实习结束的 2022-09 开始算空档,一路算到 2024 年 ——
   *    而那段时间人家明明在上学。必须按「已覆盖到的最晚月份」推进。
   */
  it('重叠的经历不会被误判成空档', () => {
    const gaps = findGaps([
      entry('2020-09', '2024-06'), // 本科四年
      entry('2022-07', '2022-08', 'work'), // 大二暑期实习,完全落在本科区间内
      entry('2023-07', '2023-09', 'work'), // 大三暑期实习
      entry('2024-07', null, 'work'), // 毕业后工作
    ])
    expect(gaps).toHaveLength(0)
  })

  it('实习比在读还晚结束时,覆盖范围要跟着延后', () => {
    const gaps = findGaps([
      entry('2020-09', '2024-06'),
      entry('2024-03', '2024-09', 'work'), // 跨过毕业,一直做到 9 月
      entry('2024-11', null, 'work'),
    ])
    // 只空了 2024-10 一个月,在容忍范围内
    expect(gaps).toHaveLength(0)
  })

  it('多段空档全部报出', () => {
    const gaps = findGaps([
      entry('2016-09', '2020-06'),
      entry('2021-09', '2023-06'), // 空 2020-07 ~ 2021-08
      entry('2024-06', null), // 空 2023-07 ~ 2024-05
    ])
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toMatchObject({ from: '2020-07', to: '2021-08', months: 14 })
    expect(gaps[1]).toMatchObject({ from: '2023-07', to: '2024-05', months: 11 })
  })

  it('前面已有「至今」的经历,后面不再报空档', () => {
    // 一段没有结束时间的经历覆盖到现在,之后的任何间隔都无从谈起
    const gaps = findGaps([entry('2020-09', null), entry('2030-01', '2030-06')])
    expect(gaps).toHaveLength(0)
  })

  it('少于两条时没有空档可言', () => {
    expect(findGaps([])).toHaveLength(0)
    expect(findGaps([entry('2020-09', '2024-06')])).toHaveLength(0)
  })

  it('忽略年月格式非法的条目,不因脏数据崩掉', () => {
    const gaps = findGaps([
      entry('2020-09', '2024-06'),
      { ...entry('乱写', null), startYm: '乱写' },
      entry('2025-06', null),
    ])
    expect(gaps).toHaveLength(1)
    expect(gaps[0].from).toBe('2024-07')
  })

  it('容忍月数可调 —— 传 0 时任何间隔都要报', () => {
    const gaps = findGaps([entry('2020-09', '2024-06'), entry('2024-08', null)], 0)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ from: '2024-07', to: '2024-07', months: 1 })
  })

  it('跨年计算正确', () => {
    const gaps = findGaps([entry('2023-01', '2023-11'), entry('2024-04', null)])
    // 2023-12、2024-01、02、03 共四个月
    expect(gaps[0]).toMatchObject({ from: '2023-12', to: '2024-03', months: 4 })
  })
})

describe('展示与校验', () => {
  it('格式化年月', () => {
    expect(formatYm('2024-07')).toBe('2024 年 7 月')
    expect(formatYm('2024-12')).toBe('2024 年 12 月')
  })

  it('格式化区间,空结束时间显示「至今」', () => {
    expect(formatRange('2020-09', '2024-06')).toBe('2020 年 9 月 — 2024 年 6 月')
    expect(formatRange('2024-07', null)).toBe('2024 年 7 月 — 至今')
  })

  it('校验:格式错、结束早于开始各给一条中文提示', () => {
    expect(validateEntry('2024-9', null)).toContain('年月格式')
    expect(validateEntry('2024-09', '2023-01')).toContain('不能早于')
    expect(validateEntry('2024-09', null)).toBeNull()
    expect(validateEntry('2024-09', '2024-09')).toBeNull()
  })
})
