'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui'
import { importAssessmentToShortlist } from './actions'

export function ImportToShortlist({ leadId, count }: { leadId: string; count: number }) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  if (done) {
    return (
      <div className="space-y-2">
        {msg && <p className="text-sm text-green-800">{msg.text}</p>}
        <Link href="/app/schools">
          <Button size="sm">去选校单看看 →</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null)
            const res = await importAssessmentToShortlist(leadId)
            if (!res.ok) {
              setMsg({ kind: 'err', text: res.error })
              return
            }
            const parts = [`已加入 ${res.added} 所`]
            if (res.skipped > 0) parts.push(`${res.skipped} 所已在单子里`)
            // 地区被撤下的情况要说清楚,否则用户会以为系统漏了
            if (res.dropped > 0) parts.push(`${res.dropped} 所所在地区已暂时下架`)
            setMsg({ kind: 'ok', text: `${parts.join(',')}。` })
            setDone(true)
          })
        }
      >
        {pending ? '导入中…' : `把这 ${count} 所加进选校单`}
      </Button>
      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
