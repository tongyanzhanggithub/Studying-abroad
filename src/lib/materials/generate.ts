import 'server-only'
import { Prisma, type ApplicationStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { classifyTestRequirement } from '@/lib/assessment/engine'

/**
 * 根据选校单自动生成/合并材料清单(PRD 4.4)。
 *
 * 关键行为:**多校共用材料去重** —— 成绩单、在读证明这类材料
 * 只出现一次,并标注它适用于哪几所学校。学生不该为 8 所学校
 * 看到 8 条「成绩单」。
 */
/**
 * 几乎所有授课型硕士都要的材料。
 *
 * ⚠️ 存在的理由:`ProgramMaterialTemplate` 是给运营逐个项目精调用的,
 *    但采集进来的 310 条项目**一条都没有挂模板** —— 没有任何导入或
 *    种子代码会去建这些关联。只按关联生成的话,材料清单对真实数据
 *    永远是空的,「材料只维护一次」这条卖点直接是死的。
 *
 *    所以这里给一份保底清单:项目没精调过就用它,精调过就完全以精调为准。
 */
const BASELINE_CODES = [
  'transcript',
  'degree_certificate',
  'cv',
  'personal_statement',
  'reference',
  'english_test',
  'passport',
] as const

/** 港澳院校普遍要身份证 */
const ID_DOC_REGIONS = ['HK', 'MO']

export async function regenerateMaterials(userId: string) {
  const choices = await db.userSchoolChoice.findMany({
    where: { userId },
    include: {
      program: {
        include: { materialTemplates: { include: { template: true } } },
      },
    },
  })

  // templateId → 适用的 programId 列表
  const needed = new Map<string, { shared: boolean; programIds: string[] }>()

  const baseline = await db.materialTemplate.findMany({
    where: { code: { in: [...BASELINE_CODES, 'gmat_gre', 'id_document'] } },
  })
  const byCode = new Map(baseline.map((t) => [t.code, t]))

  const add = (templateId: string, shared: boolean, programId: string) => {
    const entry = needed.get(templateId)
    if (entry) entry.programIds.push(programId)
    else needed.set(templateId, { shared, programIds: [programId] })
  }

  for (const choice of choices) {
    if (choice.program.materialTemplates.length > 0) {
      // 运营精调过这个项目 —— 完全以精调结果为准
      for (const link of choice.program.materialTemplates) {
        add(link.templateId, link.template.sharedAcrossPrograms, choice.programId)
      }
      continue
    }

    // 没精调过 → 保底清单 + 按该项目的真实字段补两项
    const codes: string[] = [...BASELINE_CODES]

    // GMAT/GRE 只在官网确实提到时才列 —— 不要求的项目列出来会让人白准备
    const gmat = classifyTestRequirement(
      (choice.program.requirements as { gmat_gre?: string | null } | null)?.gmat_gre,
    )
    if (gmat === 'required' || gmat === 'recommended') codes.push('gmat_gre')

    if (ID_DOC_REGIONS.includes(choice.program.region)) codes.push('id_document')

    for (const code of codes) {
      const tpl = byCode.get(code)
      if (tpl) add(tpl.id, tpl.sharedAcrossPrograms, choice.programId)
    }
  }

  const existing = await db.userMaterial.findMany({ where: { userId } })

  /**
   * ⚠️ 用 upsert 而不是「读 existing 再决定 create/update」。
   *    用户快速连点加两所学校时,两次 regenerateMaterials 并发跑,都读到无 existing、
   *    都 create 同一个 (userId, templateId) → 撞 @@unique 抛 P2002 → 整个 add 请求 500。
   *    upsert 把并发/重复交给数据库的唯一约束处理:更新只动适用院校范围,
   *    不碰学生已填的状态和已上传的文件。
   */
  // 选校单里已删掉的学校 → 对应材料若从未动过就清理,动过就保留
  const staleIds = existing
    .filter((m) => !needed.has(m.templateId) && m.status === 'not_started' && !m.fileUrl)
    .map((m) => m.id)

  const ops: Prisma.PrismaPromise<unknown>[] = [...needed].map(([templateId, info]) =>
    db.userMaterial.upsert({
      where: { userId_templateId: { userId, templateId } },
      update: { programIds: info.programIds },
      create: { userId, templateId, programIds: info.programIds, status: 'not_started' },
    }),
  )
  if (staleIds.length) {
    ops.push(db.userMaterial.deleteMany({ where: { id: { in: staleIds } } }))
  }

  /**
   * ⚠️ 整批放进一个事务,而不是逐条 await。
   *
   *    这个函数在学生每次加/删一所学校时都会跑。之前是 9 条 upsert + N 条 delete
   *    **串行往返**,一次点击十几个来回;更要命的是它们不在同一个事务里 ——
   *    中途任何一条失败(网络抖动、连接被回收),学生就留下一份**残缺的材料清单**:
   *    有的学校算进去了、有的没有,而且没有任何地方会发现这件事。
   *    数组形式的 $transaction 一次发过去、要么全成要么全不成。
   */
  await db.$transaction(ops)
}

/** 材料完成度 */
export async function getMaterialProgress(userId: string) {
  const materials = await db.userMaterial.findMany({ where: { userId } })
  const done = materials.filter((m) => m.status === 'completed').length
  return {
    total: materials.length,
    done,
    percent: materials.length ? Math.round((done / materials.length) * 100) : 0,
  }
}

/**
 * 材料勾选联动推进院校申请状态(PRD 4.3)。
 * 学生手动改过状态的(statusManuallySet)不再自动推进 —— 尊重人的判断。
 */
export async function syncApplicationStatuses(userId: string) {
  const [choices, materials] = await Promise.all([
    db.userSchoolChoice.findMany({ where: { userId, statusManuallySet: false } }),
    db.userMaterial.findMany({ where: { userId } }),
  ])

  const essays = await db.essay.findMany({ where: { userId } })

  /**
   * 目标状态 → 需要改成该状态的选校记录 id。
   *
   * ⚠️ 之前是循环里逐条 `db.userSchoolChoice.update`。选了 20 所学校、
   *    材料一勾就可能触发 20 次串行往返;而目标状态其实只有 4 种,
   *    按状态归并后最多 4 条 updateMany 就够了。
   */
  const toUpdate = new Map<string, string[]>()

  for (const choice of choices) {
    // 已递交及之后的状态不回退
    if (
      ['submitted', 'interview_invited', 'admitted', 'rejected', 'waitlisted'].includes(
        choice.status,
      )
    ) {
      continue
    }

    const relevant = materials.filter((m) => m.programIds.includes(choice.programId))
    if (!relevant.length) continue

    const allDone = relevant.every((m) => m.status === 'completed')
    const anyStarted = relevant.some((m) => m.status !== 'not_started')
    const essayFinal = essays
      .filter((e) => e.programId === choice.programId)
      .every((e) => e.status === 'final')
    const hasEssay = essays.some((e) => e.programId === choice.programId)

    let next = choice.status
    if (allDone && (!hasEssay || essayFinal)) next = 'ready_to_submit'
    else if (hasEssay && !essayFinal) next = 'writing_essay'
    else if (anyStarted) next = 'preparing_materials'
    else next = 'not_started'

    if (next !== choice.status) {
      const bucket = toUpdate.get(next)
      if (bucket) bucket.push(choice.id)
      else toUpdate.set(next, [choice.id])
    }
  }

  if (toUpdate.size === 0) return
  await db.$transaction(
    [...toUpdate].map(([status, ids]) =>
      db.userSchoolChoice.updateMany({
        where: { id: { in: ids } },
        data: { status: status as ApplicationStatus },
      }),
    ),
  )
}
