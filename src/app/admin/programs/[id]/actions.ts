'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { notifyProgramChange } from '@/lib/notifications/send'
import { readDeadlines, readRequirements } from '@/lib/programs/types'
import type { ProgramDeadlines, ProgramRequirements } from '@/lib/programs/types'
import type { BarChangeFlag } from '@prisma/client'

/**
 * 批量标记已核对 —— 只作用于运营在列表里手动勾选的那些行。
 *
 * 只有走过这一步的数据,前端才会以确定值展示(PRD 4.2 红线)。
 * 刻意不提供「一键全选全库」:那会让 90% 核对率的门槛变成走过场。
 */
export async function markVerifiedBatch(programIds: string[]) {
  const admin = await requireAdmin('data_entry')
  if (programIds.length === 0) return { ok: true as const, count: 0 }
  const res = await db.program.updateMany({
    where: { id: { in: programIds } },
    data: {
      confidence: 'verified',
      lastVerifiedAt: new Date(),
      verifiedBy: admin.adminId,
    },
  })
  revalidatePath('/admin/programs')
  return { ok: true as const, count: res.count }
}

/**
 * 撤销核对,退回待核对队列。
 *
 * 需要这个是因为核对会出错:标错了、或者事后发现当时对的是过期页面。
 * 没有退路的话,唯一的补救办法是去改数据库 —— 那等于没有补救办法,
 * 结果就是错误数据顶着「已核对」的标签继续放给用户看。
 */
export async function unverifyProgram(programId: string) {
  await requireAdmin('data_entry')
  await db.program.update({
    where: { id: programId },
    data: { confidence: 'ai_collected', lastVerifiedAt: null, verifiedBy: null },
  })
  revalidatePath('/admin/programs')
  revalidatePath(`/admin/programs/${programId}`)
  return { ok: true as const }
}

/** ── 编辑 ─────────────────────────────────────────────── */

export interface ProgramEditInput {
  nameZh: string
  faculty: string
  durationMonths: string
  tuition: string
  campus: string
  isOnlineOnly: boolean
  competitiveness: string
  barChangeFlag: BarChangeFlag
  sourceUrls: string
  notes: string

  undergradBackground: string
  chinaUniversityList: string
  gpaRequirement: string
  ieltsOverall: string
  ieltsSubscores: string
  toeflOverall: string
  toeflSubscores: string
  cet6Accepted: string
  gmatGre: string
  prerequisites: string
  workExperience: string
  interview: string

  opensAt: string
  rolling: boolean
  finalDeadline: string
  deadlineNotes: string
}

/** 空串一律存成 null —— 空字符串和「没有这项要求」在展示层是两回事。 */
function nn(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 日期字段只接受 YYYY-MM-DD。
 * 解析不出来时**保持原值不动**而不是置空 —— 运营手滑打错一个字符,
 * 不应该导致一条截止日期悄悄消失。
 */
function parseDate(v: string): { ok: true; value: Date | null } | { ok: false } {
  const t = v.trim()
  if (t === '') return { ok: true, value: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false }
  const d = new Date(`${t}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d }
}

/** 用于生成变更摘要的字段中文名 */
const FIELD_LABEL: Record<string, string> = {
  'requirements.gpa_requirement': '均分要求',
  'requirements.china_university_list': '中国院校认可名单',
  'requirements.undergrad_background': '本科背景要求',
  'requirements.ielts': '雅思要求',
  'requirements.toefl': '托福要求',
  'requirements.cet6_accepted': '六级接受情况',
  'requirements.gmat_gre': 'GMAT / GRE 要求',
  'requirements.prerequisites': '先修课要求',
  'requirements.work_experience': '工作经验要求',
  'requirements.interview': '面试要求',
  'deadlines.final_deadline': '最终截止日期',
  'deadlines.opens_at': '开放申请日期',
  'deadlines.rolling': '滚动录取',
  tuition: '学费',
  durationMonths: '学制',
  campus: '校区',
  isOnlineOnly: '授课形式',
}

/**
 * 保存核对结果。
 *
 * ⚠️ 这里同时做两件以前分开的事:**改数据**和**记变更**。
 *    早先后台只有「记录变更」—— 它写 ProgramChangeLog 并推送用户,
 *    却完全不动 Program 那一行。结果是推送说「均分从 80 涨到 85」,
 *    而院校页上仍然写着 80。数据是这个产品的生命线(PRD 4.2),
 *    这种不一致比没有推送更糟。现在改成:先落库,再按 diff 出变更记录。
 *
 * `notify` 只在运营明确勾选时才为 true。首次核对(把 AI 采集的错值改对)
 * 不是「学校改了要求」,不该推送 —— 那会把我们自己的采集错误说成院校变更。
 */
export async function saveProgram(
  programId: string,
  input: ProgramEditInput,
  notify: boolean,
) {
  const admin = await requireAdmin('data_entry')

  const before = await db.program.findUnique({ where: { id: programId } })
  if (!before) return { ok: false as const, error: '项目不存在' }

  const beforeReq = readRequirements(before)
  const beforeDl = readDeadlines(before)

  const finalDeadline = parseDate(input.finalDeadline)
  const opensAt = parseDate(input.opensAt)
  if (!finalDeadline.ok || !opensAt.ok) {
    return { ok: false as const, error: '日期格式要写成 2026-01-15 这样,没保存。' }
  }

  const ieltsOverall = num(input.ieltsOverall)
  const toeflOverall = num(input.toeflOverall)

  const requirements: ProgramRequirements = {
    ...beforeReq,
    undergrad_background: nn(input.undergradBackground),
    china_university_list: nn(input.chinaUniversityList),
    gpa_requirement: nn(input.gpaRequirement),
    ielts:
      ieltsOverall === null && nn(input.ieltsSubscores) === null
        ? null
        : { overall: ieltsOverall, subscores: nn(input.ieltsSubscores) },
    toefl:
      toeflOverall === null && nn(input.toeflSubscores) === null
        ? null
        : { overall: toeflOverall, subscores: nn(input.toeflSubscores) },
    cet6_accepted: nn(input.cet6Accepted),
    gmat_gre: nn(input.gmatGre),
    prerequisites: nn(input.prerequisites),
    work_experience: nn(input.workExperience),
    interview: nn(input.interview),
  }

  // rounds 结构复杂(多轮 + 放榜日),这一版不在表单里改,原样保留
  const deadlines: ProgramDeadlines = {
    ...beforeDl,
    opens_at: nn(input.opensAt),
    rolling: input.rolling,
    final_deadline: nn(input.finalDeadline),
    notes: nn(input.deadlineNotes),
  }

  await db.program.update({
    where: { id: programId },
    data: {
      nameZh: nn(input.nameZh),
      faculty: nn(input.faculty),
      durationMonths: num(input.durationMonths),
      tuition: nn(input.tuition),
      campus: nn(input.campus),
      isOnlineOnly: input.isOnlineOnly,
      competitiveness: nn(input.competitiveness),
      barChangeFlag: input.barChangeFlag,
      notes: nn(input.notes),
      sourceUrls: input.sourceUrls
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      requirements: requirements as object,
      deadlines: deadlines as object,
      finalDeadline: finalDeadline.value,
      isRolling: input.rolling,
      confidence: 'verified',
      lastVerifiedAt: new Date(),
      verifiedBy: admin.adminId,
    },
  })

  // ── 算出用户能看见的字段有哪些变了 ──────────────────────
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? '是' : '否'
    if (typeof v === 'object') {
      const o = v as { overall?: number | null; subscores?: string | null }
      return [o.overall ?? '—', o.subscores].filter(Boolean).join(' / ')
    }
    return String(v)
  }

  const diffs: Array<{ field: string; oldValue: string; newValue: string }> = []
  const cmp = (field: string, a: unknown, b: unknown) => {
    const [x, y] = [fmt(a), fmt(b)]
    if (x !== y) diffs.push({ field, oldValue: x, newValue: y })
  }

  cmp('tuition', before.tuition, nn(input.tuition))
  cmp('durationMonths', before.durationMonths, num(input.durationMonths))
  cmp('campus', before.campus, nn(input.campus))
  cmp('isOnlineOnly', before.isOnlineOnly, input.isOnlineOnly)
  for (const k of [
    'gpa_requirement',
    'china_university_list',
    'undergrad_background',
    'cet6_accepted',
    'gmat_gre',
    'prerequisites',
    'work_experience',
    'interview',
  ] as const) {
    cmp(`requirements.${k}`, beforeReq[k], requirements[k])
  }
  cmp('requirements.ielts', beforeReq.ielts, requirements.ielts)
  cmp('requirements.toefl', beforeReq.toefl, requirements.toefl)
  cmp('deadlines.final_deadline', beforeDl.final_deadline, deadlines.final_deadline)
  cmp('deadlines.opens_at', beforeDl.opens_at, deadlines.opens_at)
  cmp('deadlines.rolling', beforeDl.rolling ?? false, input.rolling)

  let notified = 0
  if (notify && diffs.length > 0) {
    const sourceUrl = input.sourceUrls.split('\n')[0]?.trim() || null
    for (const d of diffs) {
      const label = FIELD_LABEL[d.field] ?? d.field
      const log = await db.programChangeLog.create({
        data: {
          programId,
          field: d.field,
          oldValue: d.oldValue,
          newValue: d.newValue,
          summary: `${label}:${d.oldValue} → ${d.newValue}`,
          sourceUrl,
          changedBy: admin.adminId,
        },
      })
      notified += await notifyProgramChange(log.id)
    }
  }

  revalidatePath('/admin/programs')
  revalidatePath(`/admin/programs/${programId}`)
  return {
    ok: true as const,
    changed: diffs.length,
    notified,
    // 没勾推送时把 diff 带回前端,让运营看清自己改动了什么
    diffs: diffs.map((d) => `${FIELD_LABEL[d.field] ?? d.field}:${d.oldValue} → ${d.newValue}`),
  }
}
