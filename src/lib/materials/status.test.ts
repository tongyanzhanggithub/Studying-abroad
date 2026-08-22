import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextApplicationStatus, type StatusMaterial } from '@/lib/materials/status'
import { codeOnly } from '@/lib/source-scan'

/**
 * 院校申请状态机。
 *
 * ── 核心的那条:加分材料不该拦住任何人 ────────────────
 *
 * 种子数据里 award_certificate 的说明原文写着「这一项**不计入材料完成度**」,
 * getMaterialProgress 的注释也专门解释过为什么要排除:
 *   「把它们算进完成度,等于没得过奖的学生永远到不了 100% ——
 *     一个你再努力也满不了的进度条,传达的是『你还差着点什么』,
 *     而这恰恰是产品最该避免的焦虑来源(PRD 14)。」
 *
 * 但状态机此前把加分项一起算进「材料全齐了吗」,而且那个查询连
 * template.optional 都没 select —— 想算也算不了。
 * 于是同一批数据算出两个互相打架的结论:进度条 100%,状态却停在「准备材料中」。
 * 连带行动计划永远不说「该递交了」。
 */

const PID = 'prog-1'

const m = (over: Partial<StatusMaterial> = {}): StatusMaterial => ({
  programIds: [PID],
  status: 'completed',
  optional: false,
  ...over,
})

describe('加分材料不参与「能不能递交」的判定', () => {
  it('必交项全齐、加分项没交 → 可以递交', () => {
    expect(
      nextApplicationStatus(
        'preparing_materials',
        PID,
        [m(), m(), m({ optional: true, status: 'not_started' })],
        [],
      ),
    ).toBe('ready_to_submit')
  })

  it('必交项还差一项 → 不能递交,即使加分项交了', () => {
    expect(
      nextApplicationStatus(
        'not_started',
        PID,
        [m(), m({ status: 'in_progress' }), m({ optional: true })],
        [],
      ),
    ).toBe('preparing_materials')
  })

  /**
   * ⚠️ 只挂了加分材料时不能判「可以递交」。
   *    required 为空数组时 every() 恒为 true —— 会凭空说学生可以递交了。
   *    真实数据里不会出现(保底清单全是必交项),但这是唯一的凭空入口。
   */
  it('只有加分材料 → 不能凭空判定可以递交', () => {
    expect(
      nextApplicationStatus('not_started', PID, [m({ optional: true, status: 'completed' })], []),
    ).toBe('preparing_materials')
  })
})

describe('文书参与判定', () => {
  it('材料齐了但文书没定稿 → 写文书中', () => {
    expect(
      nextApplicationStatus('preparing_materials', PID, [m()], [
        { programId: PID, status: 'drafting' },
      ]),
    ).toBe('writing_essay')
  })

  it('材料齐了、文书也定稿 → 可以递交', () => {
    expect(
      nextApplicationStatus('writing_essay', PID, [m()], [{ programId: PID, status: 'final' }]),
    ).toBe('ready_to_submit')
  })

  /** 别的学校的文书不该影响这一所 */
  it('只看本项目的文书', () => {
    expect(
      nextApplicationStatus('preparing_materials', PID, [m()], [
        { programId: 'other', status: 'drafting' },
      ]),
    ).toBe('ready_to_submit')
  })

  /** programId 为空的是通用文书,不绑定到任何一所 */
  it('通用文书(programId 为 null)不参与', () => {
    expect(
      nextApplicationStatus('preparing_materials', PID, [m()], [
        { programId: null, status: 'drafting' },
      ]),
    ).toBe('ready_to_submit')
  })
})

describe('不该动的情况', () => {
  it.each(['submitted', 'interview_invited', 'admitted', 'rejected', 'waitlisted'])(
    '%s 之后不回退',
    (status) => {
      expect(nextApplicationStatus(status, PID, [m({ status: 'not_started' })], [])).toBeNull()
    },
  )

  it('这所学校没有任何材料 → 不动', () => {
    expect(nextApplicationStatus('not_started', PID, [m({ programIds: ['other'] })], [])).toBeNull()
  })

  it('算出来和现状一样 → 返回 null,不产生无谓的写库', () => {
    expect(nextApplicationStatus('ready_to_submit', PID, [m()], [])).toBeNull()
  })
})

/**
 * ⚠️ 判定要用 optional,而 optional 只能从 template 关联里取。
 *    原来的查询是裸的 findMany —— 字段根本没查出来。
 *    逻辑写对了但查询没取字段,是这个 bug 的另一半。
 */
describe('源码守卫:状态同步必须把 optional 查出来', () => {
  it('syncApplicationStatuses 的材料查询 select 了 template.optional', () => {
    const src = codeOnly(
      readFileSync(join(process.cwd(), 'src/lib/materials/generate.ts'), 'utf8'),
    ).replace(/\s+/g, ' ')
    expect(src).toContain('template: { select: { optional: true } }')
  })

  it('判定逻辑只有 status.ts 一份实现', () => {
    const gen = codeOnly(readFileSync(join(process.cwd(), 'src/lib/materials/generate.ts'), 'utf8'))
    expect(gen).toContain('nextApplicationStatus')
    // 老的内联判定不该再出现在 generate.ts 里
    expect(gen).not.toContain("next = 'ready_to_submit'")
  })
})
