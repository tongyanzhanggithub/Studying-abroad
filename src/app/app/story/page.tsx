import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { StoryForm } from './StoryForm'
import { visibleSections, storyProgress } from '@/lib/essays/question-bank'

/**
 * 个人素材库。
 *
 * ── 为什么单独一个页面,而不是塞进文书工作台 ──────────────
 *
 * 素材是**跟人走**的:高中、大学、实习、性格,一个人只有一份。
 * 而文书是**跟项目走**的,申 8 所学校就有 8 篇。
 * 放在工作台里意味着每开一篇新文书都要重答一遍自己的经历 ——
 * 这和材料中心「一份材料不用交八遍」是同一个问题。
 *
 * ⚠️ 这一页**不依赖 AI**。模型没接通的时候它照样有用:
 *    把散在脑子里的经历落到纸面上,本来就是写文书最难的一步。
 *    接上模型之后,这些答案会成为素材访谈的起点(见 essays/actions.ts),
 *    让 AI 顺着已有的往下深挖,而不是把问题再问一遍。
 */
export default async function StoryPage() {
  const user = await requireUser()

  const [rows, profile] = await Promise.all([
    db.storyAnswer.findMany({
      where: { userId: user.id },
      select: { questionId: true, answer: true },
    }),
    db.profile.findUnique({
      where: { userId: user.id },
      select: { enrollmentStatus: true, isMajorSwitch: true },
    }),
  ])

  const answers = Object.fromEntries(rows.map((r) => [r.questionId, r.answer]))

  /**
   * 已毕业 → 显示「工作经历」小节。
   *
   * 这是个近似:已毕业不等于一定有全职工作。但把这一节对所有人都显示,
   * 应届生会对着「按时间顺序说一下你的工作履历」发愣;
   * 而漏显示的代价只是有工作经验的人少了一节 —— 后者更容易被察觉和补救。
   */
  const ctx = {
    hasWorkExperience: profile?.enrollmentStatus === 'graduated',
    isMajorSwitch: profile?.isMajorSwitch ?? false,
  }

  const sections = visibleSections(ctx)
  const progress = storyProgress(answers, ctx)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">素材库</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          先把经历写下来,再谈怎么组织成文书。这里答一次,所有学校的文书都能用。
        </p>
      </div>

      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-600">
            核心问题已答 <strong className="text-ink-900">{progress.done}</strong> / {progress.total}
          </span>
          <span className="text-sm font-medium text-ink-900">{progress.percent}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          {/*
            ⚠️ 明确告诉用户「选答不计入进度」。不说的话,他看到进度条满不了
               只会以为自己还差着什么 —— 材料中心的加分项是同一个处理。
          */}
          标了「选答」的不计入进度,答了更好、不答也不影响。
          不用一次填完,随时可以回来接着写,输入后会自动保存。
        </p>
      </Card>

      <StoryForm sections={sections} answers={answers} />

      <Card className="bg-ink-50">
        <p className="text-sm leading-relaxed text-ink-600">
          素材攒得差不多了,就可以
          <Link href="/app/essays" className="mx-1 text-brand-600 hover:underline">
            去文书工作台
          </Link>
          按学校分别写正文 —— 那里会针对具体项目问「为什么是这所学校」。
        </p>
      </Card>
    </div>
  )
}
