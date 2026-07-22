import 'server-only'
import { db } from '@/lib/db'
import { countWords } from '@/lib/utils'
import type { AiPolicyLevel } from '@prisma/client'

/**
 * 文书合规检查器(PRD 4.5 步骤 5 / 10.2)。
 *
 * ⚠️ 这是法律防线,PRD 12 明确列为「绝不砍」。
 *    终稿前强制运行,不可跳过。
 *
 * 检查项:
 *   1. 目标院校 AI 政策 —— 零容忍院校显著警告
 *   2. AI 使用声明提醒(Common App 类)
 *   3. 语言水平与雅思写作分数差距过大的风险提示
 *   4. 字数限制
 */

export type Severity = 'blocker' | 'warning' | 'info'

export interface ComplianceIssue {
  severity: Severity
  title: string
  detail: string
}

export interface ComplianceResult {
  passed: boolean
  issues: ComplianceIssue[]
  checkedAt: string
}

const POLICY_COPY: Record<AiPolicyLevel, { severity: Severity; title: string; detail: string }> = {
  zero_tolerance: {
    severity: 'blocker',
    title: '该院校对 AI 辅助写作持零容忍态度',
    detail:
      '这所学校明确禁止在申请文书中使用 AI 生成内容。请确认你提交的文本完全由自己撰写 —— ' +
      '本系统的 AI 只提供提问与逐句语法建议,但最终判断责任在你。' +
      '若不确定,建议关掉 AI 润色功能重写一遍,或咨询学校招生办。',
  },
  limited_allowed: {
    severity: 'warning',
    title: '该院校有限允许 AI 辅助',
    detail:
      '这所学校允许在一定范围内使用 AI 工具(通常限于语法检查、润色),' +
      '但要求内容与观点为申请人本人。请确保文书的经历、动机、判断都是你自己的。',
  },
  unspecified: {
    severity: 'info',
    title: '该院校未公开 AI 使用政策',
    detail:
      '我们没有找到这所学校明确的 AI 使用政策。保守做法:把 AI 当成语法检查工具,' +
      '不要让它替你产生观点或经历。如果申请系统里有 AI 使用声明,如实填写。',
  },
}

export async function runComplianceCheck(essayId: string): Promise<ComplianceResult> {
  const essay = await db.essay.findUnique({
    where: { id: essayId },
    include: {
      program: { include: { school: true } },
      versions: { orderBy: { createdAt: 'desc' }, take: 1 },
      user: { include: { profile: true } },
    },
  })
  if (!essay) throw new Error('文书不存在')

  const issues: ComplianceIssue[] = []
  const content = essay.versions[0]?.content ?? ''
  const words = countWords(content)

  // 1. 院校 AI 政策
  if (essay.program?.school) {
    const level = essay.program.school.aiPolicyLevel
    const copy = POLICY_COPY[level]
    issues.push({
      severity: copy.severity,
      title: `${essay.program.school.nameZh ?? essay.program.school.nameEn}:${copy.title}`,
      detail:
        copy.detail +
        (essay.program.school.aiPolicyNote ? `\n\n学校说明:${essay.program.school.aiPolicyNote}` : ''),
    })
  }

  // 2. AI 使用声明提醒
  issues.push({
    severity: 'info',
    title: '记得如实填写 AI 使用声明',
    detail:
      '部分申请系统(如 Common App 及各校自有系统)会要求你声明是否使用了 AI 工具。' +
      '如实填写 —— 隐瞒被发现的后果远大于如实说明。',
  })

  // 3. 语言水平与文书水平的落差风险
  const profile = essay.user.profile
  if (profile?.languageType === 'ielts' && profile.languageScore && words > 100) {
    if (profile.languageScore <= 6.0) {
      issues.push({
        severity: 'warning',
        title: '文书语言水平与雅思成绩可能存在落差',
        detail:
          `你的雅思总分是 ${profile.languageScore}。如果文书的英文水平明显高于这个分数,` +
          '招生官可能会产生疑问 —— 这在部分院校会触发进一步核查。' +
          '建议保持文书语言在你真实能达到的水平,内容的说服力比辞藻更重要。',
      })
    }
  }

  // 4. 字数
  if (essay.wordLimit) {
    if (words > essay.wordLimit) {
      issues.push({
        severity: 'blocker',
        title: `超出字数限制(${words} / ${essay.wordLimit})`,
        detail: '超出字数的部分可能被系统截断或直接扣分,请精简。',
      })
    } else if (words < essay.wordLimit * 0.6) {
      issues.push({
        severity: 'warning',
        title: `字数偏少(${words} / ${essay.wordLimit})`,
        detail: '明显低于字数上限通常意味着论述不够充分,建议补充具体事例。',
      })
    }
  }

  if (!content.trim()) {
    issues.push({
      severity: 'blocker',
      title: '文书内容为空',
      detail: '还没有写任何内容。',
    })
  }

  const result: ComplianceResult = {
    passed: !issues.some((i) => i.severity === 'blocker'),
    issues,
    checkedAt: new Date().toISOString(),
  }

  await db.essay.update({
    where: { id: essayId },
    data: { complianceCheck: result as unknown as object },
  })

  return result
}
