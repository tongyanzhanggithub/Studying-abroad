'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui'
import { cn } from '@/lib/utils'
import { setMaterialStatus, uploadMaterialFile } from './actions'
import type { MaterialStatus } from '@prisma/client'

const STATUS_LABEL: Record<MaterialStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
}

/**
 * 到手倒计时预警。
 *   overdue = 按常规办理周期已赶不上最近截止日(要加急)
 *   urgent  = 余量不足两周
 *   ample   = 余量充足(仍显示倒计时,让人心里有数)
 *   none    = 未完成但相关学校都没公布截止日
 *   done    = 已办好
 */
export type MaterialWarning =
  | { level: 'done' | 'none' }
  | { level: 'overdue' | 'urgent' | 'ample'; days: number; lead: number; slack: number }

function WarningBadge({ w }: { w: MaterialWarning }) {
  if (!('slack' in w)) return null
  const cls =
    w.level === 'overdue'
      ? 'bg-red-50 text-red-700'
      : w.level === 'urgent'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-ink-100 text-ink-500'
  const text =
    w.level === 'overdue'
      ? `常规办不及,尽快加急`
      : w.level === 'urgent'
        ? `余量仅 ${w.slack} 天`
        : `余量 ${w.slack} 天`
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {text}
    </span>
  )
}

export function MaterialRow({
  id,
  name,
  description,
  guideMd,
  status,
  fileName,
  fileRequired,
  appliesTo,
  warning,
}: {
  id: string
  name: string
  description: string | null
  guideMd: string | null
  status: MaterialStatus
  fileName: string | null
  fileRequired: boolean
  appliesTo: string[]
  warning: MaterialWarning
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [, startTransition] = useTransition()

  const uniqueSchools = Array.from(new Set(appliesTo))

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                startTransition(async () => {
                  await setMaterialStatus(
                    id,
                    status === 'completed' ? 'not_started' : 'completed',
                  )
                  router.refresh()
                })
              }
              aria-label={status === 'completed' ? '标记为未完成' : '标记为已完成'}
              className={cn(
                // 视觉上是 20px 方框,但用负外边距把可点区域撑到 44px
                'relative flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs',
                'before:absolute before:-inset-3 before:content-[""] sm:before:hidden',
                status === 'completed'
                  ? 'border-safe bg-safe text-white'
                  : 'border-ink-200 hover:border-brand-500',
              )}
            >
              {status === 'completed' ? '✓' : ''}
            </button>
            <span
              className={cn(
                'font-medium',
                status === 'completed' ? 'text-ink-400 line-through' : 'text-ink-900',
              )}
            >
              {name}
            </span>
            <span className="text-xs text-ink-400">{STATUS_LABEL[status]}</span>
            <WarningBadge w={warning} />
          </div>

          {description && (
            <p className="mt-1 pl-7 text-sm leading-relaxed text-ink-600">{description}</p>
          )}

          {uniqueSchools.length > 0 && (
            <p className="mt-1 pl-7 text-xs text-ink-400">
              {/* 一份材料覆盖哪几所 —— 去重后学生一眼看清「办一次管几所」 */}
              {uniqueSchools.length > 1 && (
                <span className="mr-1 font-medium text-brand-600">
                  {uniqueSchools.length} 所共用
                </span>
              )}
              适用:{uniqueSchools.join('、')}
            </p>
          )}

          {/*
            以前这里只是一行纯文本,文件传上去之后没有任何地方能打开它 ——
            学生无从确认自己传对了没有(传错版本、传成截图、传了空白页都看不出来)。
          */}
          {fileName && (
            <p className="mt-1 pl-7 text-xs text-ink-600">
              已上传:
              <a
                href={`/api/materials/${id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline"
              >
                {fileName}
              </a>
              <span className="ml-1 text-ink-400">(点开确认一下传对了没有)</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {guideMd && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="inline-flex min-h-9 items-center px-1 text-xs text-brand-600 hover:underline"
            >
              {expanded ? '收起' : '怎么办理'}
            </button>
          )}
          {fileRequired && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-9 items-center rounded border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-brand-500"
              >
                上传
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setError(null)
                  const fd = new FormData()
                  fd.append('file', f)
                  startTransition(async () => {
                    const res = await uploadMaterialFile(id, fd)
                    if (!res.ok) setError(res.error)
                    else router.refresh()
                  })
                }}
              />
            </>
          )}
        </div>
      </div>

      {expanded && guideMd && (
        <div className="mt-3 ml-7 rounded-lg bg-ink-50 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-600">
          {guideMd}
        </div>
      )}

      {error && <p className="mt-2 pl-7 text-xs text-red-700">{error}</p>}
    </Card>
  )
}
