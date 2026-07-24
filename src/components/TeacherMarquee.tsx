import { db } from '@/lib/db'

/**
 * 官网老师展示栏(横向无缝滚动)。
 *
 * ⚠️ 数据**全部来自数据库**,一个字都不写死。展示的是给潜在客户看的资质,
 *    写死"示例老师"配真实感的院校名就是伪造资质 —— 是实打实的法律风险。
 *
 * ⚠️ **没有数据时整块不渲染**(返回 null),不显示占位卡片。
 *    要它出现:后台「老师库」录真实老师 → 勾选「在官网展示」。
 */

type Teacher = {
  id: string
  name: string
  role: string
  publicTitle: string | null
  education: string | null
  yearsExp: number | null
  specialties: string | null
  highlight: string | null
}

export async function TeacherMarquee() {
  let teachers: Teacher[] = []
  try {
    teachers = await db.deliverer.findMany({
      where: { active: true, showOnSite: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        publicTitle: true,
        education: true,
        yearsExp: true,
        specialties: true,
        highlight: true,
      },
    })
  } catch {
    return null // 数据库不可用时静默跳过,这一栏是锦上添花
  }

  if (teachers.length === 0) return null

  /**
   * ⚠️ 补满一屏,避免"人少时右边一大片空白"。
   *
   *    无缝滚动的做法是把内容渲染两遍首尾相接、平移 -50% 接回起点。
   *    但只有 1-2 位老师时,两遍加起来也填不满一屏宽,右侧就露空。
   *    先把老师列表**重复到至少 8 张**(约一屏多),再整体渲染两遍 ——
   *    这样无论几位老师,轨道都是满的、滚动也连续。
   */
  const MIN_CARDS = 8
  const filled: Teacher[] = []
  while (filled.length < MIN_CARDS) filled.push(...teachers)
  const track = [...filled, ...filled]

  return (
    <section className="border-y border-white/70 bg-white/70 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-5">
        <p className="gradient-text text-sm font-semibold">OUR TEAM</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-semibold text-ink-900">带你申请的老师</h2>
          <p className="text-xs text-ink-400">
            共 {teachers.length} 位老师 · 背景均可核实
          </p>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          做定位、精修名单、批改文书,都由真人老师完成。他们的学历与经历都写明来源,
          需要专业判断时由他们接单 —— 而不是把你交给一套模板。
        </p>
      </div>

      <div className="marquee-viewport mt-6">
        <div
          className="marquee-track"
          style={{ ['--marquee-duration' as string]: `${Math.max(24, filled.length * 5)}s` }}
        >
          {track.map((t, i) => {
            const tags = (t.specialties ?? '')
              .split(/[,,、]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 3)
            return (
              <article
                key={`${t.id}-${i}`}
                aria-hidden={i >= filled.length}
                className="mx-2 flex w-72 shrink-0 flex-col rounded-xl border border-ink-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="insta-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold text-white">
                    {t.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate font-medium text-ink-900">{t.name}</p>
                      {t.yearsExp != null && (
                        <span className="shrink-0 text-xs text-ink-400">从业 {t.yearsExp} 年</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-500">{t.publicTitle ?? t.role}</p>
                  </div>
                </div>

                {t.education && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-700">
                    <span aria-hidden>🎓</span>
                    <span className="min-w-0">{t.education}</span>
                  </p>
                )}

                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {t.highlight && (
                  <p className="mt-2.5 line-clamp-3 border-t border-ink-100 pt-2.5 text-xs leading-relaxed text-ink-500">
                    {t.highlight}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
