'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { DIRECTION_LABEL, DIRECTION_ORDER } from '@/lib/programs/types'
import type { ExtractedProgram, FieldKey } from '@/lib/collect/extract'
import { approveDraft, rejectDraft, type ReviewedValues } from '../actions'
import type { Direction } from '@prisma/client'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

/**
 * 逐字段审核。
 *
 * 布局上把「AI 抽出来的值」和「原文出处」放在一起 ——
 * 审核的人要判断的从来不是「这个值看着对不对」,
 * 而是「原文是不是真这么写的」。只给值不给出处,审核就退化成盲签。
 */
function Row({
  label,
  value,
  onChange,
  evidence,
  rows,
  children,
}: {
  label: string
  value?: string
  onChange?: (v: string) => void
  evidence: string | null
  rows?: number
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-ink-100 py-3 first:border-0">
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <div className="pt-2">
          <span className="text-sm font-medium text-ink-800">{label}</span>
          {!evidence && (
            <span
              className="ml-1.5 rounded bg-red-50 px-1 py-0.5 text-[10px] text-red-700"
              title="模型没能从原文里找到依据,这个字段被丢弃了"
            >
              无出处
            </span>
          )}
        </div>
        <div>
          {children ??
            (rows ? (
              <textarea
                value={value}
                rows={rows}
                onChange={(e) => onChange?.(e.target.value)}
                className={inputCls}
              />
            ) : (
              <input
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                className={inputCls}
              />
            ))}

          {evidence ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="mt-1 text-xs text-brand-600 hover:underline"
            >
              {open ? '收起原文' : '看原文出处'}
            </button>
          ) : (
            <p className="mt-1 text-xs text-ink-400">
              页面里没找到明确写法,已留空。确实有的话请自己填,并在下方来源里补链接。
            </p>
          )}

          {open && evidence && (
            <blockquote className="mt-1.5 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-700">
              {evidence}
            </blockquote>
          )}
        </div>
      </div>
    </div>
  )
}

export function ReviewForm({
  draftId,
  initial,
  payload,
  sourceUrl,
  isUpdate,
}: {
  draftId: string
  initial: ReviewedValues
  payload: ExtractedProgram
  sourceUrl: string
  isUpdate: boolean
}) {
  const router = useRouter()
  const [v, setV] = useState<ReviewedValues>(initial)
  const [verified, setVerified] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof ReviewedValues>(k: K, val: ReviewedValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }))

  const ev = (k: FieldKey): string | null => payload[k]?.evidence ?? null

  const missing = (
    ['gpa_requirement', 'final_deadline', 'tuition'] as FieldKey[]
  ).filter((k) => !payload[k]?.evidence)

  return (
    <div className="space-y-4">
      {payload.uncertainties?.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="text-sm font-medium text-ink-900">模型自己说不准的地方</h2>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-700">
            {payload.uncertainties.map((u, i) => (
              <li key={i}>· {u}</li>
            ))}
          </ul>
        </Card>
      )}

      {missing.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-xs leading-relaxed text-red-900">
            关键字段没抽到:
            <strong>
              {missing
                .map((k) =>
                  k === 'gpa_requirement' ? '均分要求' : k === 'final_deadline' ? '截止日期' : '学费',
                )
                .join('、')}
            </strong>
            。学生最先看的就是这几项。要么去官网补上,要么直接丢弃这条,
            不要留一个半空的记录进库。
          </p>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 font-medium text-ink-900">基本信息</h2>
        <Row label="学校英文名" value={v.schoolNameEn} onChange={(x) => set('schoolNameEn', x)} evidence={ev('school_name_en')} />
        <Row label="学校中文名" value={v.schoolNameZh} onChange={(x) => set('schoolNameZh', x)} evidence={ev('school_name_zh')} />
        <Row label="项目英文名" value={v.programNameEn} onChange={(x) => set('programNameEn', x)} evidence={ev('program_name_en')} />
        <Row label="项目中文名" value={v.programNameZh} onChange={(x) => set('programNameZh', x)} evidence={ev('program_name_zh')} />
        <Row label="学院" value={v.faculty} onChange={(x) => set('faculty', x)} evidence={ev('faculty')} />
        <Row label="专业方向" evidence={ev('direction')}>
          <select
            value={v.direction}
            onChange={(e) => set('direction', e.target.value as Direction)}
            className={inputCls}
          >
            {DIRECTION_ORDER.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABEL[d]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="学制(月)" value={v.durationMonths} onChange={(x) => set('durationMonths', x)} evidence={ev('duration_months')} />
        <Row label="学费" value={v.tuition} onChange={(x) => set('tuition', x)} evidence={ev('tuition')} rows={2} />
        <Row label="校区" value={v.campus} onChange={(x) => set('campus', x)} evidence={ev('campus')} />
        <Row label="纯线上项目" evidence={ev('is_online_only')}>
          <label className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              checked={v.isOnlineOnly}
              onChange={(e) => set('isOnlineOnly', e.target.checked)}
            />
            <span className="text-sm text-ink-700">是纯线上 / 远程项目(通常不支持学生签证)</span>
          </label>
        </Row>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium text-ink-900">录取要求</h2>
        <Row label="均分要求" value={v.gpaRequirement} onChange={(x) => set('gpaRequirement', x)} evidence={ev('gpa_requirement')} rows={2} />
        <Row label="中国院校认可名单" value={v.chinaUniversityList} onChange={(x) => set('chinaUniversityList', x)} evidence={ev('china_university_list')} rows={2} />
        <Row label="本科背景要求" value={v.undergradBackground} onChange={(x) => set('undergradBackground', x)} evidence={ev('undergrad_background')} rows={2} />
        <Row label="雅思总分" value={v.ieltsOverall} onChange={(x) => set('ieltsOverall', x)} evidence={ev('ielts_overall')} />
        <Row label="雅思小分" value={v.ieltsSubscores} onChange={(x) => set('ieltsSubscores', x)} evidence={ev('ielts_subscores')} />
        <Row label="托福总分" value={v.toeflOverall} onChange={(x) => set('toeflOverall', x)} evidence={ev('toefl_overall')} />
        <Row label="托福小分" value={v.toeflSubscores} onChange={(x) => set('toeflSubscores', x)} evidence={ev('toefl_subscores')} />
        <Row label="六级接受情况" value={v.cet6Accepted} onChange={(x) => set('cet6Accepted', x)} evidence={ev('cet6_accepted')} />
        <Row label="GMAT / GRE" value={v.gmatGre} onChange={(x) => set('gmatGre', x)} evidence={ev('gmat_gre')} />
        <Row label="先修课" value={v.prerequisites} onChange={(x) => set('prerequisites', x)} evidence={ev('prerequisites')} rows={2} />
        <Row label="工作经验" value={v.workExperience} onChange={(x) => set('workExperience', x)} evidence={ev('work_experience')} />
        <Row label="面试" value={v.interview} onChange={(x) => set('interview', x)} evidence={ev('interview')} />
      </Card>

      <Card>
        <h2 className="mb-1 font-medium text-ink-900">时间线</h2>
        <p className="mb-2 text-xs leading-relaxed text-ink-500">
          日期格式 2026-01-15。不确定是哪一届的就留空 ——
          一个过期的截止日比没有日期危险得多,学生会照着它规划。
        </p>
        <Row label="开放申请" value={v.opensAt} onChange={(x) => set('opensAt', x)} evidence={ev('opens_at')} />
        <Row label="最终截止" value={v.finalDeadline} onChange={(x) => set('finalDeadline', x)} evidence={ev('final_deadline')} />
        <Row label="滚动录取" evidence={ev('rolling')}>
          <label className="flex items-center gap-2 pt-2">
            <input type="checkbox" checked={v.rolling} onChange={(e) => set('rolling', e.target.checked)} />
            <span className="text-sm text-ink-700">滚动录取(先到先得)</span>
          </label>
        </Row>
        <Row label="时间线备注" value={v.deadlineNotes} onChange={(x) => set('deadlineNotes', x)} evidence={ev('deadline_notes')} rows={2} />
      </Card>

      <Card className="sticky bottom-4 border-brand-200 bg-brand-50/70 backdrop-blur">
        {isUpdate && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            库里已有同名项目,采纳会<strong>覆盖</strong>它的字段。确认这次抓的是最新一届的页面再采纳。
          </p>
        )}

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm text-ink-700">
            我已逐字段对照官网核对过,直接标记为「已核对」
            <span className="mt-0.5 block text-xs text-ink-500">
              不勾的话会以「待核对」进库,之后还要在院校库里走一次核对流程。
              只扫了一眼没发现明显问题 —— 那不叫核对过,别勾。
            </span>
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMsg(null)
                const res = await approveDraft(draftId, v, verified)
                if (!res.ok) {
                  setMsg({ kind: 'err', text: res.error })
                  return
                }
                router.push('/admin/collect')
                router.refresh()
              })
            }
          >
            {pending ? '处理中…' : verified ? '采纳并标记已核对' : '采纳(进待核对队列)'}
          </Button>

          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:underline"
          >
            打开官网对照 ↗
          </a>

          <button
            type="button"
            onClick={() => setRejecting(!rejecting)}
            className="ml-auto text-xs text-ink-400 underline hover:text-red-600"
          >
            丢弃这条
          </button>
        </div>

        {rejecting && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="丢弃原因,如:抓的是列表页 / 是上一届的信息"
              className={`${inputCls} flex-1`}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await rejectDraft(draftId, reason)
                  router.push('/admin/collect')
                  router.refresh()
                })
              }
            >
              确认丢弃
            </Button>
          </div>
        )}

        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
          </p>
        )}
      </Card>
    </div>
  )
}
