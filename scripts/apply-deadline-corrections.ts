/**
 * 应用人工核查得出的截止日修正。
 *
 *   npm run fix:deadlines            预演,只打印会改什么,不写库
 *   npm run fix:deadlines -- --write 真正写入
 *   (PGlite 单连接:先 Ctrl+C 停掉 dev server 再跑)
 *
 * ── 为什么要有这个脚本 ──────────────────────────────────
 * 2026-08 那轮核查发现 UCL 把一个**已经关闭两个月**的申请通道显示成
 * 「还有 13 天截止」(见 docs/数据核查-2026-08.md)。这类修正有三个要求:
 *
 *   1. **要能进 git。** data/raw 在 .gitignore 里,直接改那边换台机器就没了,
 *      云上更不会有。修正表放 data/corrections/ 跟着代码走。
 *   2. **要能追溯。** 改的是学生用来做决定的日期,必须留下官网原话和链接 ——
 *      所以每条修正强制带 official_quote + source_url,缺一个就拒绝执行。
 *   3. **不能顺手把核对状态冲掉。** 只动截止日和备注,不碰 confidence /
 *      lastVerifiedAt —— 运营已经核过的项目不该因为一次修正被打回待核对。
 *
 * ⚠️ 默认预演。写库要显式加 --write,理由同上:这是钱和申请季,不是配置项。
 * ⚠️ 匹配不上的项目**报错列出,绝不新建** —— 新建会凭空多出一个没有任何来源的项目。
 * ⚠️ 幂等:值已经是目标值就跳过,重复跑不会重复往备注里追加。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PrismaClient, type DeadlineAudience } from '@prisma/client'

const db = new PrismaClient()
const DIR = join(process.cwd(), 'data', 'corrections')
const FILE = join(DIR, 'deadlines-2026-08.json')
const AUDIENCE_FILE = join(DIR, 'deadline-audience-2026-08.json')
const WRITE = process.argv.includes('--write')

interface Correction {
  school_name_en: string
  programs: string[]
  current_final_deadline: string | null
  new_final_deadline: string | null
  reason: string
  official_quote: string
  source_url: string
  note_append: string
}

/** 备注里已经有这句话就不再追加 —— 保证重复执行不会把备注撑爆 */
function appendNote(existing: string | null, addition: string): string {
  const cur = (existing ?? '').trim()
  if (cur.includes(addition)) return cur
  return cur ? `${cur}\n${addition}` : addition
}

async function main() {
  const raw = JSON.parse(await readFile(FILE, 'utf8')) as {
    reviewed_at: string
    corrections: Correction[]
  }

  console.log(`修正表:${FILE}`)
  console.log(`核查日期:${raw.reviewed_at}`)
  console.log(WRITE ? '模式:写入' : '模式:预演(加 --write 才真正写库)')
  console.log('')

  let changed = 0
  let already = 0
  const notFound: string[] = []
  const rejected: string[] = []

  for (const c of raw.corrections) {
    // 红线:改学生看的日期必须能追溯到官网原话
    if (!c.official_quote?.trim() || !c.source_url?.trim()) {
      rejected.push(`${c.school_name_en}:缺 official_quote 或 source_url,整条拒绝执行`)
      continue
    }

    const target = c.new_final_deadline ? new Date(`${c.new_final_deadline}T00:00:00Z`) : null
    if (c.new_final_deadline && Number.isNaN(target!.getTime())) {
      rejected.push(`${c.school_name_en}:new_final_deadline 不是合法日期(${c.new_final_deadline})`)
      continue
    }

    for (const name of c.programs) {
      const program = await db.program.findFirst({
        where: { nameEn: name, school: { nameEn: c.school_name_en } },
        select: { id: true, finalDeadline: true, notes: true, deadlines: true },
      })
      if (!program) {
        notFound.push(`${c.school_name_en} — ${name}`)
        continue
      }

      const cur = program.finalDeadline ? program.finalDeadline.toISOString().slice(0, 10) : null
      if (cur === c.new_final_deadline) {
        already += 1
        continue
      }

      console.log(`${c.school_name_en} — ${name}`)
      console.log(`    ${cur ?? '(空)'}  →  ${c.new_final_deadline ?? '(置空,前台显示「截止日待公布」)'}`)

      if (WRITE) {
        /**
         * deadlines 这个 Json 列里也存着 final_deadline,两处必须一起改 ——
         * 只改标量列的话,详情页读 deadlines.final_deadline 仍会显示旧值。
         */
        const dl = (program.deadlines ?? {}) as Record<string, unknown>
        await db.program.update({
          where: { id: program.id },
          data: {
            finalDeadline: target,
            deadlines: { ...dl, final_deadline: c.new_final_deadline },
            notes: appendNote(program.notes, `${c.note_append}(来源:${c.source_url})`),
            // ⚠️ 刻意不动 confidence / lastVerifiedAt / verifiedBy
          },
        })
      }
      changed += 1
    }
  }

  // ── 申请人档次标注 ──────────────────────────────────
  /**
   * ⚠️ 这一段和上面的日期修正同样重要,方向相反。
   *
   *    deadlineAudience 默认 unspecified,而 UI 对 unspecified 一律不给倒计时 ——
   *    这道闸是必要的(口径不明的日期做倒计时正是 UCL 那次事故的成因),
   *    但代价是**倒计时整个失效**,而它是 PRD 4.3 的核心功能。
   *
   *    所以逐校查证过档次的要在这里标出来,把倒计时还回去。没查证的继续留空。
   */
  const audienceRaw = JSON.parse(await readFile(AUDIENCE_FILE, 'utf8')) as {
    audiences: Array<{
      school_name_en: string
      audience: DeadlineAudience
      intake_term: string
      official_quote: string
      source_url: string
    }>
  }

  console.log('')
  console.log('── 申请人档次标注 ──────────────────────────')
  let labelled = 0
  for (const a of audienceRaw.audiences) {
    if (!a.official_quote?.trim() || !a.source_url?.trim()) {
      rejected.push(`${a.school_name_en}(档次标注):缺 official_quote 或 source_url`)
      continue
    }
    const where = {
      school: { nameEn: a.school_name_en },
      // 已经标好的不重复写 —— 保证幂等
      OR: [{ deadlineAudience: { not: a.audience } }, { intakeTerm: { not: a.intake_term } }],
    }
    const n = await db.program.count({ where })
    if (n === 0) continue
    console.log(`${a.school_name_en}  →  ${a.audience} / ${a.intake_term}  (${n} 个)`)
    if (WRITE) {
      await db.program.updateMany({
        where: { school: { nameEn: a.school_name_en } },
        data: { deadlineAudience: a.audience, intakeTerm: a.intake_term },
      })
    }
    labelled += n
  }
  if (labelled === 0) console.log('(全部已标注)')

  console.log('')
  console.log('──────────────────────────────────────────')
  console.log(`日期:需要修改 ${changed} 个,已经是目标值 ${already} 个`)
  console.log(`档次:需要标注 ${labelled} 个`)
  if (notFound.length) {
    console.log(`\n⚠️ 匹配不到 ${notFound.length} 个(**没有新建**,请核对项目名):`)
    notFound.forEach((x) => console.log('   ' + x))
  }
  if (rejected.length) {
    console.log(`\n⚠️ 拒绝执行 ${rejected.length} 条:`)
    rejected.forEach((x) => console.log('   ' + x))
  }
  if (!WRITE && (changed > 0 || labelled > 0)) {
    console.log('\n这是预演,没有写库。确认无误后执行:npm run fix:deadlines -- --write')
  }

  await db.$disconnect()
  // 匹配不上或被拒绝都算失败 —— 别让 CI / 部署脚本以为一切正常
  if (notFound.length || rejected.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
