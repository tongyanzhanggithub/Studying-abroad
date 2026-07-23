'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { saveProgram, unverifyProgram, type ProgramEditInput } from './actions'
import type { BarChangeFlag } from '@prisma/client'

const input =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

function Text({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <Field label={label} hint={hint}>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={input}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={input}
        />
      )}
    </Field>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="font-medium text-ink-900">{title}</h2>
      {hint && <p className="mt-1 text-xs leading-relaxed text-ink-400">{hint}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  )
}

/**
 * 核对编辑表单。
 *
 * 核对不只是「看一眼然后打勾」—— AI 采集的数据本来就会错,
 * 运营对着官网发现错了就得能当场改。所以「保存」即等于「核对通过」:
 * 不存在改完还要再点一次打勾的两步操作。
 */
export function EditForm({
  programId,
  initial,
  isPublicRegion,
  wasVerified,
}: {
  programId: string
  initial: ProgramEditInput
  /** 该地区是否已对用户开放 —— 没开放的地区改数据没人看得见,不需要推送 */
  isPublicRegion: boolean
  wasVerified: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState<ProgramEditInput>(initial)
  const [notify, setNotify] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; list?: string[] } | null>(null)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof ProgramEditInput>(k: K, v: ProgramEditInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }))

  // 推送只在「已开放地区 + 之前已核对过」时才有意义:
  // 前者决定有没有用户看得见,后者区分「学校改了要求」和「我们当初采错了」
  const canNotify = isPublicRegion && wasVerified

  return (
    <div className="space-y-4">
      <Section
        title="基本信息"
        hint="学费保留原币种原文,不要换算成人民币 —— 汇率会变,换算过的数字很快就是错的。"
      >
        <Text label="中文名" value={f.nameZh} onChange={(v) => set('nameZh', v)} />
        <Text
          label="QS 世界排名"
          value={f.qsRank}
          onChange={(v) => set('qsRank', v)}
          placeholder="25"
        />
        <Text
          label="QS 年份"
          value={f.qsRankYear}
          onChange={(v) => set('qsRankYear', v)}
          placeholder="2026"
        />
        <Text label="学院 / Faculty" value={f.faculty} onChange={(v) => set('faculty', v)} />
        <Text
          label="学制(月)"
          value={f.durationMonths}
          onChange={(v) => set('durationMonths', v)}
          placeholder="12"
        />
        <Text label="校区" value={f.campus} onChange={(v) => set('campus', v)} />
        <div className="sm:col-span-2">
          <Text
            label="QS 排名来源链接"
            value={f.qsRankSourceUrl}
            onChange={(v) => set('qsRankSourceUrl', v)}
            placeholder="https://www.topuniversities.com/..."
            hint="QS 排名每年变化,建议写来源链接和年份。"
          />
        </div>
        <div className="sm:col-span-2">
          <Text
            label="学费"
            value={f.tuition}
            onChange={(v) => set('tuition', v)}
            rows={2}
            placeholder="GBP 38,500 for 2026/27 entry"
          />
        </div>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={f.isOnlineOnly}
            onChange={(e) => set('isOnlineOnly', e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm text-ink-700">
            纯线上 / 远程项目
            <span className="mt-0.5 block text-xs text-ink-400">
              勾上会在前台显著警告。这类项目通常不支持学生签证,混在普通项目里展示会误导学生。
            </span>
          </span>
        </label>
      </Section>

      <Section title="录取要求">
        <div className="sm:col-span-2">
          <Text
            label="均分要求"
            value={f.gpaRequirement}
            onChange={(v) => set('gpaRequirement', v)}
            hint="按官网原文写,如「985/211 均分 80,双非 85」。不要只写一个数字。"
          />
        </div>
        <div className="sm:col-span-2">
          <Text
            label="中国院校认可名单"
            value={f.chinaUniversityList}
            onChange={(v) => set('chinaUniversityList', v)}
            rows={2}
            hint="英国校常见的分档名单 —— 中国申请者最关心的字段。"
          />
        </div>
        <div className="sm:col-span-2">
          <Text
            label="本科背景要求"
            value={f.undergradBackground}
            onChange={(v) => set('undergradBackground', v)}
            rows={2}
          />
        </div>
        <Text
          label="雅思总分"
          value={f.ieltsOverall}
          onChange={(v) => set('ieltsOverall', v)}
          placeholder="7"
        />
        <Text
          label="雅思小分"
          value={f.ieltsSubscores}
          onChange={(v) => set('ieltsSubscores', v)}
          placeholder="each 6.5"
        />
        <Text
          label="托福总分"
          value={f.toeflOverall}
          onChange={(v) => set('toeflOverall', v)}
          placeholder="100"
        />
        <Text
          label="托福小分"
          value={f.toeflSubscores}
          onChange={(v) => set('toeflSubscores', v)}
        />
        <Text
          label="六级接受情况"
          value={f.cet6Accepted}
          onChange={(v) => set('cet6Accepted', v)}
          hint="港校常见。不接受就写「不接受」,别留空。"
        />
        <Text label="GMAT / GRE" value={f.gmatGre} onChange={(v) => set('gmatGre', v)} />
        <div className="sm:col-span-2">
          <Text
            label="先修课要求"
            value={f.prerequisites}
            onChange={(v) => set('prerequisites', v)}
            rows={2}
          />
        </div>
        <Text
          label="工作经验"
          value={f.workExperience}
          onChange={(v) => set('workExperience', v)}
        />
        <Text label="面试" value={f.interview} onChange={(v) => set('interview', v)} />
      </Section>

      <Section
        title="时间线"
        hint="日期写成 2026-01-15。留空表示官网还没公布 —— 比填一个过期日期安全得多,学生会照着日期规划。"
      >
        <Text
          label="开放申请"
          value={f.opensAt}
          onChange={(v) => set('opensAt', v)}
          placeholder="2025-09-01"
        />
        <Text
          label="最终截止"
          value={f.finalDeadline}
          onChange={(v) => set('finalDeadline', v)}
          placeholder="2026-01-15"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.rolling}
            onChange={(e) => set('rolling', e.target.checked)}
          />
          <span className="text-sm text-ink-700">滚动录取(先到先得)</span>
        </label>
        <div className="sm:col-span-2">
          <Text
            label="时间线备注"
            value={f.deadlineNotes}
            onChange={(v) => set('deadlineNotes', v)}
            rows={2}
          />
        </div>
      </Section>

      <Section title="运营标注">
        <Text
          label="名额紧张度"
          value={f.competitiveness}
          onChange={(v) => set('competitiveness', v)}
          placeholder="如:第一轮基本招满"
        />
        <Field label="录取门槛变化">
          <select
            value={f.barChangeFlag}
            onChange={(e) => set('barChangeFlag', e.target.value as BarChangeFlag)}
            className={input}
          >
            {/* value 必须与 schema.prisma 的 BarChangeFlag 枚举完全一致 ——
                写错了 TS 也拦不住(onChange 处有 as 断言),要等运行时数据库报错 */}
            <option value="unknown">未知</option>
            <option value="up">今年提高</option>
            <option value="down">今年降低</option>
            <option value="unchanged">与去年持平</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Text
            label="官网来源链接"
            value={f.sourceUrls}
            onChange={(v) => set('sourceUrls', v)}
            rows={3}
            hint="一行一个。核对时对照的就是这些页面,写全了下次复核能省一半时间。"
          />
        </div>
        <div className="sm:col-span-2">
          <Text label="内部备注" value={f.notes} onChange={(v) => set('notes', v)} rows={2} />
        </div>
      </Section>

      <Card className="sticky bottom-4 border-brand-200 bg-brand-50/60 backdrop-blur">
        {canNotify ? (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-ink-700">
              这是院校方的真实变更,推送给选了这个项目的用户
              <span className="mt-0.5 block text-xs text-ink-500">
                只在学校真的改了要求时勾。修正我们自己采集错的数据不要勾 ——
                那会把采集失误说成院校变更,用户会白紧张一次。
              </span>
            </span>
          </label>
        ) : (
          <p className="text-xs leading-relaxed text-ink-500">
            {!isPublicRegion
              ? '该地区尚未对用户开放,改动没有用户看得见,不会产生推送。'
              : '这条还没被核对过,本次保存视为首次核对,不推送。'}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMsg(null)
                const res = await saveProgram(programId, f, notify)
                if (!res.ok) {
                  setMsg({ kind: 'err', text: res.error })
                  return
                }
                setMsg({
                  kind: 'ok',
                  text:
                    res.changed === 0
                      ? '已保存,并标记为核对通过(内容没有变化)。'
                      : `已保存 ${res.changed} 处改动,并标记为核对通过。` +
                        (res.notified > 0 ? `已推送给 ${res.notified} 位用户。` : ''),
                  list: res.diffs,
                })
                router.refresh()
              })
            }
          >
            {pending ? '保存中…' : '保存并标记已核对'}
          </Button>
          <span className="text-xs text-ink-500">保存即代表你已对照官网核对过这一条。</span>

          {wasVerified && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await unverifyProgram(programId)
                  setMsg({ kind: 'ok', text: '已退回待核对队列,前台会重新标为「待核实」。' })
                  router.refresh()
                })
              }
              className="ml-auto text-xs text-ink-400 underline hover:text-ink-700"
            >
              撤销核对,退回队列
            </button>
          )}
        </div>

        {msg && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
            {msg.list && msg.list.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {msg.list.map((d) => (
                  <li key={d}>· {d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
