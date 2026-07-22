'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui'
import { exportLeads } from './actions'

export function ExportButton() {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await exportLeads()
          if (!res.ok) return
          const blob = new Blob(['﻿' + res.csv], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
          a.click()
          URL.revokeObjectURL(url)
        })
      }
    >
      {pending ? '导出中…' : '导出 CSV'}
    </Button>
  )
}
