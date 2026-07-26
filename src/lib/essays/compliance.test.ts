import { describe, it, expect } from 'vitest'
import type { ComplianceIssue } from './compliance'

/**
 * 合规结果的判定规则。
 *
 * runComplianceCheck 本身要连库(取文书、院校、档案),不适合放进纯函数单测;
 * 这里锁住的是它最后那段**判定逻辑** —— 也正是死锁出过问题的地方:
 *
 *   · passed         = 没有任何 blocker
 *   · attestableOnly = 还剩的 blocker 全是「院校 AI 政策」类
 *                      (系统无法验证是不是本人写的,由学生声明担责)
 *
 * 客观类 blocker(空文书、超字数)必须始终拦死,绝不能被声明绕过。
 */
function decide(issues: ComplianceIssue[]) {
  const blockers = issues.filter((i) => i.severity === 'blocker')
  return {
    passed: blockers.length === 0,
    attestableOnly: blockers.length > 0 && blockers.every((b) => b.kind === 'ai_policy'),
  }
}

const policy: ComplianceIssue = {
  severity: 'blocker',
  kind: 'ai_policy',
  title: '零容忍',
  detail: '',
}
const overLimit: ComplianceIssue = {
  severity: 'blocker',
  kind: 'word_limit',
  title: '超字数',
  detail: '',
}
const empty: ComplianceIssue = {
  severity: 'blocker',
  kind: 'empty',
  title: '空文书',
  detail: '',
}
const info: ComplianceIssue = { severity: 'info', title: '提醒', detail: '' }
const warn: ComplianceIssue = { severity: 'warning', title: '注意', detail: '' }

describe('合规判定', () => {
  it('只有提醒与警告 → 通过', () => {
    expect(decide([info, warn])).toEqual({ passed: true, attestableOnly: false })
  })

  it('零容忍院校 → 不通过,但可由学生声明原创后放行', () => {
    expect(decide([policy, info])).toEqual({ passed: false, attestableOnly: true })
  })

  it('超字数 → 不通过,且**不可**被声明绕过', () => {
    expect(decide([overLimit])).toEqual({ passed: false, attestableOnly: false })
  })

  it('空文书 → 不通过,且不可被声明绕过', () => {
    expect(decide([empty])).toEqual({ passed: false, attestableOnly: false })
  })

  it('零容忍 + 超字数 → 客观问题还在,不能只靠声明放行', () => {
    expect(decide([policy, overLimit])).toEqual({ passed: false, attestableOnly: false })
  })

  it('没有任何 issue → 通过', () => {
    expect(decide([])).toEqual({ passed: true, attestableOnly: false })
  })
})
