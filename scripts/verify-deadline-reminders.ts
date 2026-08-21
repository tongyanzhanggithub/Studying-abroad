/**
 * 实跑一次每日截止提醒,验证**档次闸门确实拦住了推送**。
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-deadline-reminders.ts
 *
 * ── 为什么单独跑 ──────────────────────────────────────
 *
 * 这是整条链路里唯一会**主动找上门**的一环。页面写错,用户可能看一眼就过去;
 * 推送写错,他会照着它熬夜赶材料、交申请费,然后发现通道早就关了。
 * 所以不能只靠源码扫描断言「SQL 里有 deadlineAudience」,要真发一次看结果。
 *
 * ⚠️ 提醒的阈值是 14/7/3/1 天,不是「小于 14 天」。所以先把测试项目的
 *    截止日精确设到 3 天后 —— 差一天就一条都不会发,那时候「没发出来」
 *    是因为没命中窗口,不是因为闸门,结论完全站不住。
 *
 * ⚠️ 只在本地库跑。
 */
import { db } from '@/lib/db'
import { runDeadlineReminders } from '@/lib/notifications/send'

function inDays(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    console.error('✗ 只在本地库跑')
    process.exit(1)
  }

  const programs = await db.program.findMany({
    where: { nameEn: { startsWith: 'MSc Gate Test' } },
    select: { id: true, nameZh: true, deadlineAudience: true },
  })
  if (!programs.length) {
    console.error('✗ 没找到测试项目,先跑 scripts/seed-deadline-scenario.ts')
    process.exit(1)
  }

  // 精确落在 3 天这一档
  await db.program.updateMany({
    where: { id: { in: programs.map((p) => p.id) } },
    data: { finalDeadline: inDays(3) },
  })
  console.log(`已把 ${programs.length} 个测试项目的截止日设为 3 天后(命中 deadline_3d 档)\n`)

  // 清掉上次的,保证这次是真发的
  await db.notification.deleteMany({ where: { dedupeKey: { contains: 'deadline' } } })

  const before = await db.notification.count()
  const result = await runDeadlineReminders()
  const after = await db.notification.count()

  console.log(`runDeadlineReminders → 发出 ${result.sent} 条,错误 ${result.errors.length} 条`)
  console.log(`通知表 ${before} → ${after}\n`)

  const notes = await db.notification.findMany({
    where: { dedupeKey: { contains: 'deadline' } },
    select: { userId: true, dedupeKey: true, payload: true },
  })

  /**
   * ⚠️ dedupeKey 的格式是 `deadline:{阈值代码}:{choiceId}` ——
   *    第三段是**选校记录 id**,不是项目 id。我第一版按 [1] 取,
   *    拿到的是 "deadline_3d",于是四个档次全判成「没推送」,
   *    结论直接反了(明明发出去 2 条)。
   */
  const choiceIdOf = (key: string | null) => key?.split(':')[2] ?? ''
  const choiceIds = notes.map((n) => choiceIdOf(n.dedupeKey)).filter(Boolean)
  const choiceRows = await db.userSchoolChoice.findMany({
    where: { id: { in: choiceIds } },
    select: { id: true, program: { select: { nameZh: true, deadlineAudience: true } } },
  })
  const byChoice = new Map(choiceRows.map((c) => [c.id, c.program]))

  console.log('实际推送的项目:')
  const pushed = new Set<string>()
  for (const n of notes) {
    const prog = byChoice.get(choiceIdOf(n.dedupeKey))
    if (!prog) {
      console.log(`  · (查不到选校记录)${n.dedupeKey}`)
      continue
    }
    pushed.add(prog.deadlineAudience)
    console.log(`  · ${prog.nameZh}(${prog.deadlineAudience})`)
  }
  if (!notes.length) console.log('  (一条都没有)')

  console.log('\n判定:')
  const ok =
    !pushed.has('home') && !pushed.has('unspecified') && (pushed.has('overseas') || pushed.has('all'))
  for (const a of ['overseas', 'all', 'home', 'unspecified'] as const) {
    const should = a === 'overseas' || a === 'all'
    const did = pushed.has(a)
    const mark = should === did ? '✓' : '✗'
    console.log(`  ${mark} ${a.padEnd(12)} 应推送=${should}  实际推送=${did}`)
  }
  console.log(ok ? '\n✓ 闸门生效' : '\n✗ 闸门没拦住')
  process.exitCode = ok ? 0 : 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
