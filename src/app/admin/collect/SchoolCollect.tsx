'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { collectOne, discoverSchoolPrograms } from './actions'
import type { Region } from '@prisma/client'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

/** 单批上限 —— 既控花费,也避免把对方官网抓到限流 */
const MAX_BATCH = 40

interface Candidate {
  url: string
  text: string
  score: number
  existing?: boolean
  /** 采集阶段的状态 */
  state?: 'waiting' | 'running' | 'ok' | 'fail'
  message?: string
}

/**
 * 按学校采集:先发现该校有哪些项目页,勾选后逐个抽取。
 *
 * 拆成两步而不是一键到底,是因为**第二步每条都要花一次模型调用**。
 * 一所大学的课程列表页动辄上百个链接,直接全抓等于把预算烧在
 * 本科课程和研究型学位上。先看清、再勾选、再花钱。
 */
export function SchoolCollect({ region }: { region: Region }) {
  const router = useRouter()
  const [listingUrl, setListingUrl] = useState('')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (url: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })

  const discover = () =>
    startTransition(async () => {
      setError(null)
      setSummary(null)
      setCandidates(null)
      setSel(new Set())
      const res = await discoverSchoolPrograms(listingUrl, region)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setCandidates(res.links)
      /**
       * ⚠️ 刻意**默认一个都不勾**。
       *
       * 早先版本默认勾上所有库里没有的,PolyU 那种列表页一下就是 144 条 ——
       * 一次误点「采集」就是 144 次模型调用,钱花出去了还收不回来。
       * 而且列表页里混着本科课程和分类页,全勾等于把预算浪费在不要的东西上。
       * 让人自己勾,是这一步唯一安全的默认值。
       */
      setSel(new Set())
    })

  const collect = () => {
    if (!candidates) return
    const targets = candidates.filter((c) => sel.has(c.url))
    if (targets.length === 0) return
    if (targets.length > MAX_BATCH) {
      setError(
        `一次最多采 ${MAX_BATCH} 条(当前选了 ${targets.length} 条)。` +
          '分批跑不只是为了控制花费 —— 一次几十条抓下来,官网那边也容易把你限流。',
      )
      return
    }
    setError(null)

    setCandidates((prev) =>
      prev!.map((c) => (sel.has(c.url) ? { ...c, state: 'waiting', message: undefined } : c)),
    )

    startTransition(async () => {
      let ok = 0
      let fail = 0
      for (const t of targets) {
        setCandidates((prev) =>
          prev!.map((c) => (c.url === t.url ? { ...c, state: 'running' } : c)),
        )
        const res = await collectOne(t.url, region)
        if (res.ok) ok++
        else fail++
        setCandidates((prev) =>
          prev!.map((c) =>
            c.url === t.url
              ? {
                  ...c,
                  state: res.ok ? 'ok' : 'fail',
                  message: res.ok
                    ? res.isUpdate
                      ? '已入待审(更新已有项目)'
                      : '已入待审'
                    : res.error,
                }
              : c,
          ),
        )
      }
      setSummary(`采集完成:成功 ${ok} 条,失败 ${fail} 条。全部在下方待审队列里等审核。`)
      router.refresh()
    })
  }

  const selectedCount = sel.size

  return (
    <div className="space-y-4">
      <Field
        label="学校的项目列表页"
        hint="填学院或研究生院列出所有授课型硕士的那一页,不是某一个项目的页面。例:https://www.ed.ac.uk/studying/postgraduate/degrees"
      >
        <div className="flex flex-wrap gap-2">
          <input
            value={listingUrl}
            onChange={(e) => setListingUrl(e.target.value)}
            placeholder="https://www.bath.ac.uk/…/taught-postgraduate-courses/"
            className={`${inputCls} flex-1 font-mono text-xs`}
          />
          <Button disabled={pending || !listingUrl.trim()} onClick={discover}>
            {pending && !candidates ? '查找中…' : '查找项目'}
          </Button>
        </div>
      </Field>

      <p className="text-xs leading-relaxed text-ink-500">
        查找这一步只抓一个页面、不调 AI,基本不花钱,可以多试几个入口页。
        真正消耗额度的是下一步逐个抽取 —— 所以先勾选再采。
      </p>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-xs leading-relaxed text-red-800">{error}</p>
        </Card>
      )}

      {candidates && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium text-ink-900">
              找到 {candidates.length} 个候选项目
            </h3>
            <label className="flex items-center gap-1.5 text-sm text-ink-600">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === candidates.length}
                onChange={(e) =>
                  setSel(e.target.checked ? new Set(candidates.map((c) => c.url)) : new Set())
                }
              />
              全选
            </label>
            <span className={`text-sm ${selectedCount > MAX_BATCH ? 'text-red-600' : 'text-ink-500'}`}>
              已选 {selectedCount} / 单批上限 {MAX_BATCH}
            </span>
            <Button disabled={pending || selectedCount === 0} onClick={collect}>
              {pending && candidates.some((c) => c.state === 'running')
                ? '采集中…'
                : `采集选中的 ${selectedCount} 条`}
            </Button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            按「像项目详情页」的程度排序,<strong>默认一条都不勾</strong> ——
            勾一条就是一次模型调用,得你自己决定花在哪些上。
            列表页里难免混着课程分类页、本科课程和研究型学位,勾之前扫一眼链接文字。
            {candidates.some((c) => c.existing) && ' 灰底的是库里已经有的。'}
          </p>

          {summary && (
            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
              {summary}
            </p>
          )}

          <div className="mt-3 max-h-[520px] overflow-y-auto rounded-lg border border-ink-100">
            {candidates.map((c, i) => (
              <div
                key={c.url}
                className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 ${
                  i > 0 ? 'border-t border-ink-100' : ''
                } ${c.existing ? 'bg-ink-50' : ''} ${sel.has(c.url) ? 'bg-brand-50/40' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={sel.has(c.url)}
                  onChange={() => toggle(c.url)}
                  disabled={pending}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-900">{c.text}</p>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-ink-400 hover:text-brand-600 hover:underline"
                  >
                    {c.url}
                  </a>
                  {c.message && (
                    <p
                      className={`mt-0.5 text-xs ${
                        c.state === 'fail' ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      {c.message}
                    </p>
                  )}
                </div>
                {c.existing && (
                  <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-500">
                    库里已有
                  </span>
                )}
                {c.state && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                      c.state === 'ok'
                        ? 'bg-green-50 text-green-800'
                        : c.state === 'fail'
                          ? 'bg-red-50 text-red-700'
                          : c.state === 'running'
                            ? 'bg-brand-50 text-brand-700'
                            : 'bg-ink-100 text-ink-500'
                    }`}
                  >
                    {c.state === 'ok'
                      ? '成功'
                      : c.state === 'fail'
                        ? '失败'
                        : c.state === 'running'
                          ? '处理中'
                          : '排队'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
