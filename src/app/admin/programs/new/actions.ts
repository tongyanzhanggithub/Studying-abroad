'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { normalizeRegion, normalizeDirection } from '@/lib/programs/csv'

/**
 * 人工新增院校项目。
 *
 * ── 为什么要有这条路 ────────────────────────────────────
 * 此前入库只有三条路:Excel 批量导入、AI 采集、导入脚本。
 * 运营想加**一个**项目时,得去下模板、填 CSV、再上传 —— 太绕了。
 * 人工录入和 AI 采集是并行的两种采集方式,不该只有后者有入口。
 *
 * ── 只收必要字段 ────────────────────────────────────────
 * 编辑表单有 27 个字段。新增时全铺开会让人望而却步,也容易半途放弃。
 * 这里只要「能唯一定位一个项目」的最小集合,建完直接跳详情页继续补 ——
 * 录取要求、截止日、排名那些在详情页里填,那张表单已经很成熟。
 *
 * ⚠️ 合规(PRD 4.2):新建的项目一律落成**待核对**。
 *    哪怕是运营亲手照着官网敲的,也要走一次「核对」动作 ——
 *    那一步会记下核对人和时间。少这一步,「已核对」就失去了含义。
 */
export async function createProgram(input: {
  schoolNameEn: string
  schoolNameZh: string
  region: string
  nameEn: string
  nameZh: string
  direction: string
  sourceUrl: string
}) {
  const admin = await requireAdmin('data_entry')

  const schoolNameEn = input.schoolNameEn.trim()
  const nameEn = input.nameEn.trim()
  if (!schoolNameEn) return { ok: false as const, error: '学校英文名不能为空' }
  if (!nameEn) return { ok: false as const, error: '项目英文名不能为空' }

  const region = normalizeRegion(input.region)
  if (!region) return { ok: false as const, error: '请选择地区' }

  const direction = normalizeDirection(input.direction)
  if (!direction) return { ok: false as const, error: '请选择申请方向' }

  // 学校按(英文名 + 地区)唯一,已存在就复用,不重复建
  const school = await db.school.upsert({
    where: { nameEn_region: { nameEn: schoolNameEn, region } },
    create: {
      nameEn: schoolNameEn,
      nameZh: input.schoolNameZh.trim() || null,
      region,
    },
    // 学校已存在时什么都不改 —— 新增一个项目不该顺带改掉学校本身的信息,
    // 那是「编辑学校」该干的事。避免手滑把已维护好的中文名/排名覆盖掉。
    update: {},
  })

  // 同一学校下项目英文名唯一 —— 撞了就说清楚,不要静默覆盖已有数据
  const dup = await db.program.findUnique({
    where: { schoolId_nameEn: { schoolId: school.id, nameEn } },
  })
  if (dup) {
    return {
      ok: false as const,
      error: `「${school.nameZh ?? school.nameEn}」下已有同名项目,请直接编辑那一条,避免重复录入。`,
      existingId: dup.id,
    }
  }

  const program = await db.program.create({
    data: {
      schoolId: school.id,
      nameEn,
      nameZh: input.nameZh.trim() || null,
      region,
      direction,
      sourceUrls: input.sourceUrl.trim() ? [input.sourceUrl.trim()] : [],
      // ⚠️ 人工录入同样是「待核对」,核对动作单独走,才留得下核对人与时间
      confidence: 'ai_collected',
      lastVerifiedAt: null,
      verifiedBy: null,
      notes: `由 ${admin.adminId} 人工录入`,
    },
  })

  revalidatePath('/admin/programs')
  return { ok: true as const, programId: program.id }
}
