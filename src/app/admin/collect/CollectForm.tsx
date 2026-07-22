'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { REGION_LABEL, REGION_ORDER } from '@/lib/programs/types'
import { createDraftFromText, createDraftFromUrl } from './actions'
import { SchoolCollect } from './SchoolCollect'
import type { Region } from '@prisma/client'

const input =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

interface Line {
  url: string
  status: 'waiting' | 'running' | 'ok' | 'fail'
  message?: string
}

export function CollectForm({ hasKey }: { hasKey: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<'school' | 'url' | 'text'>('school')
  const [region, setRegion] = useState<Region>('UK')
  const [urls, setUrls] = useState('')
  const [pasteUrl, setPasteUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pending, startTransition] = useTransition()

  const runUrls = () => {
    const list = urls
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length === 0) return

    setLines(list.map((url) => ({ url, status: 'waiting' })))

    startTransition(async () => {
      // 串行,不并发 —— 并发抓官网容易被限流甚至封 IP,
      // 而且一次几十个请求的账单跳得比想象中快
      for (let i = 0; i < list.length; i++) {
        setLines((prev) => prev.map((l, j) => (j === i ? { ...l, status: 'running' } : l)))
        const res = await createDraftFromUrl(list[i], region)
        setLines((prev) =>
          prev.map((l, j) =>
            j === i
              ? {
                  ...l,
                  status: res.ok ? 'ok' : 'fail',
                  message: res.ok
                    ? res.isUpdate
                      ? '已入待审队列(命中库里已有项目,是更新)'
                      : '已入待审队列(新项目)'
                    : res.error,
                }
              : l,
          ),
        )
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* 没有 key 只挡「抽取」,不挡「查找项目」——
          查找只是抓一个页面 + 正则,不调模型,没理由一起锁掉 */}
      {!hasKey && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-ink-800">
            还没配置 AI 服务,<strong>抽取会失败</strong>。请先到{' '}
            <a href="/admin/settings" className="text-brand-600 underline">
              AI 设置
            </a>{' '}
            填 API key。「查找项目」不需要 key,可以先试。
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-600">
            没 key 时抽取直接报错,而不是退回 mock 输出 ——
            mock 的假数据混进待审队列比功能不可用危险得多。
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['school', '按学校采集'],
              ['url', '按链接采集'],
              ['text', '粘贴正文采集'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                mode === m
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-ink-200 bg-white text-ink-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          <Field label="地区">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className={input}
            >
              {REGION_ORDER.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>

          {mode === 'school' ? (
            <SchoolCollect region={region} />
          ) : mode === 'url' ? (
            <Field
              label="官网链接"
              hint="一行一个,每个链接应当是某个具体硕士项目的页面,不是学院的项目列表页。会逐个串行处理。"
            >
              <textarea
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                rows={6}
                placeholder={'https://www.ed.ac.uk/…/msc-finance\nhttps://www.ed.ac.uk/…/msc-accounting'}
                className={`${input} font-mono text-xs`}
              />
            </Field>
          ) : (
            <>
              <Field label="官网链接" hint="仍然要填 —— 审核的人要靠它对照原文。">
                <input
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  className={`${input} font-mono text-xs`}
                />
              </Field>
              <Field
                label="页面正文"
                hint="很多官网是前端渲染的,服务端抓回来是空壳;PDF 招生简章也抓不了。这时直接复制粘贴。"
              >
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={10}
                  className={`${input} text-xs`}
                />
              </Field>
            </>
          )}
        </div>

        {/* 「按学校采集」有自己的两段式按钮,这里不再出现总的「开始采集」*/}
        <div className={`mt-4 flex items-center gap-3 ${mode === 'school' ? 'hidden' : ''}`}>
          <Button
            disabled={pending}
            onClick={
              mode === 'url'
                ? runUrls
                : () =>
                    startTransition(async () => {
                      const res = await createDraftFromText(pasteUrl, pasteText, region)
                      setLines([
                        {
                          url: pasteUrl || '(粘贴的正文)',
                          status: res.ok ? 'ok' : 'fail',
                          message: res.ok ? '已入待审队列' : res.error,
                        },
                      ])
                      if (res.ok) setPasteText('')
                      router.refresh()
                    })
            }
          >
            {pending ? '采集中…' : '开始采集'}
          </Button>
          <span className="text-xs text-ink-500">
            采集结果一律进待审队列,不会直接对用户可见。
          </span>
        </div>
      </Card>

      {mode !== 'school' && lines.length > 0 && (
        <Card>
          <h2 className="mb-3 font-medium text-ink-900">本次结果</h2>
          <ul className="space-y-2 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    l.status === 'ok'
                      ? 'bg-green-50 text-green-800'
                      : l.status === 'fail'
                        ? 'bg-red-50 text-red-700'
                        : l.status === 'running'
                          ? 'bg-brand-50 text-brand-700'
                          : 'bg-ink-100 text-ink-500'
                  }`}
                >
                  {l.status === 'ok'
                    ? '成功'
                    : l.status === 'fail'
                      ? '失败'
                      : l.status === 'running'
                        ? '处理中'
                        : '排队'}
                </span>
                <span className="min-w-0 flex-1 break-all text-xs text-ink-600">{l.url}</span>
                {l.message && (
                  <span className="w-full text-xs text-ink-500 sm:w-auto">{l.message}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
