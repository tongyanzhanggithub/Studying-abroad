import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { RefereeList } from './RefereeList'
import { groupsFor, refereeProgress } from '@/lib/essays/referee-questions'

/**
 * 推荐人管理。
 *
 * ── 为什么单独做一个模块 ──────────────────────────────
 *
 * 在这之前推荐信只是材料清单上的**一个勾**(leadTimeDays: 42)。但推荐信的
 * 真实工作量根本不在「上传文件」那一步 —— 它是唯一一项**不在学生自己手上**
 * 的材料:要找人、要等对方答应、要给对方素材、还要盯着对方按时交。
 * 一个勾承载不了这些,而这恰恰是最容易错过截止日的一环。
 *
 * ── 立场 ─────────────────────────────────────────────
 *
 * 行业里通行的做法是让学生「以推荐人的口吻」把信写好、老师签字。
 * 这个模块**刻意不做那件事**:它产出的是一份给推荐人的**素材**,
 * 帮他想起你在他课上做过什么 —— 信仍然由他自己写、自己签。
 */
export default async function RefereesPage() {
  const user = await requireUser()

  const referees = await db.referee.findMany({
    where: { userId: user.id },
    orderBy: { sort: 'asc' },
    include: { answers: { select: { questionId: true, answer: true } } },
  })

  const items = referees.map((r) => {
    const answers = Object.fromEntries(r.answers.map((a) => [a.questionId, a.answer]))
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      department: r.department,
      institution: r.institution,
      email: r.email,
      phone: r.phone,
      note: r.note,
      type: r.type,
      status: r.status,
      invitedAt: r.invitedAt?.toISOString() ?? null,
      groups: groupsFor(r.type),
      answers,
      progress: refereeProgress(answers, r.type),
    }
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">推荐人</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          推荐信是唯一一项不在你手上的材料。这里管好人、进度和要给对方的素材。
        </p>
      </div>

      {referees.length === 0 && (
        <Card className="border-brand-200 bg-brand-50/40">
          <h2 className="font-medium text-ink-900">先想清楚找谁</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-700">
            <li>· 多数项目要 <strong>2 封</strong>,其中至少 1 封来自学术推荐人</li>
            <li>· 教过你课的老师就可以,不必是专业课;通常要求副教授及以上</li>
            <li>· 优先找<strong>给你打过高分、带过你做项目</strong>的 —— 他写得出细节</li>
            <li>· <strong>提前 4-6 周联系</strong>。这是整个申请季里最不该拖的一件事</li>
          </ul>
        </Card>
      )}

      <RefereeList items={items} />

      <Card className="bg-ink-50">
        <p className="text-sm leading-relaxed text-ink-600">
          {/*
            ⚠️ 这段是模块的立场声明,不要删。
               行业惯例是学生代拟、老师签字;我们不做那件事,
               而用户需要知道我们为什么不做,以及替代做法是什么。
          */}
          <strong className="text-ink-900">关于「帮我写推荐信」:</strong>
          我们不代写、也不协助代签。院校一旦核实,后果是撤销录取并可能通报,
          {/* ⚠️ JSX 文本里不能写 markdown 的 **,星号会原样显示出来 —— 要加粗用 <strong> */}
          影响远超这一次申请。这里能做的是帮你把<strong className="text-ink-900">具体事实</strong>
          整理成一份材料交给推荐人 ——
          老师一学期教几百人,记不住你哪次作业做得好很正常,把细节递到他手上,
          他才写得出有说服力的信。这也是院校官方指引里鼓励的做法。
        </p>
      </Card>

      <Card className="bg-ink-50">
        <p className="text-sm leading-relaxed text-ink-600">
          推荐信在
          <Link href="/app/materials" className="mx-1 text-brand-600 hover:underline">
            材料中心
          </Link>
          里也有一条 —— 那边管的是「交没交」,这里管的是「怎么推进」。
        </p>
      </Card>
    </div>
  )
}
