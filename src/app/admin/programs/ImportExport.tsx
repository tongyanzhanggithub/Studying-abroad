'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { exportPrograms, exportProgramTemplate, importPrograms } from './io-actions'

function downloadCsv(csv: string, filename: string) {
  // 前缀 BOM,Excel 才会按 UTF-8 读中文,否则乱码
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type ImportResult = Awaited<ReturnType<typeof importPrograms>>

export function ImportExport({ filter }: { filter: string }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().slice(0, 10)

  function onExport() {
    startTransition(async () => {
      const res = await exportPrograms(filter)
      if (res.ok) downloadCsv(res.csv, `programs-${filter}-${today}.csv`)
    })
  }

  function onTemplate() {
    startTransition(async () => {
      const res = await exportProgramTemplate()
      if (res.ok) downloadCsv(res.csv, `programs-template.csv`)
    })
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    startTransition(async () => {
      const text = await file.text()
      const res = await importPrograms(text)
      setResult(res)
      if (fileRef.current) fileRef.current.value = '' // 允许重复选同一个文件
    })
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={pending} onClick={onExport}>
          {pending ? '处理中…' : `导出 Excel(当前筛选)`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onTemplate}>
          下载空模板
        </Button>

        <span className="mx-1 h-5 w-px bg-ink-100" />

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFile}
        />
        <Button variant="primary" disabled={pending} onClick={() => fileRef.current?.click()}>
          从 Excel 导入
        </Button>
      </div>

      <p className="mt-2 text-xs text-ink-500">
        导出的是 CSV,Excel 双击即可打开编辑;改完「另存为 CSV UTF-8」再导回来。
        <br />
        <strong className="text-ink-700">导入的数据一律进「待核对」队列</strong>
        ,核对通过后才会展示给用户 —— Excel 导入不等于已核实。
      </p>

      {result && !result.ok && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          导入失败:{result.error}
        </p>
      )}

      {result && result.ok && (
        <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm">
          <p className="text-ink-800">
            共 {result.total} 行:
            <span className="text-green-700"> 新增 {result.created}</span>、
            <span className="text-blue-700"> 更新 {result.updated}</span>
            {result.failed > 0 && <span className="text-red-700">、失败 {result.failed}</span>}
            。新增/更新的项目已置为「待核对」。
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600">
              {result.errors.map((e) => (
                <li key={e.line}>
                  第 {e.line} 行:{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
