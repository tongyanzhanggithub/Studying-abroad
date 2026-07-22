'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { removeLlmKey, saveLlmSettings, testLlmConnection } from './actions'

const input =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

type Provider = 'anthropic' | 'openai_compatible' | 'mock'

const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { label: '豆包(方舟)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
]

export function SettingsForm({
  current,
}: {
  current: {
    provider: string
    baseUrl: string
    model: string
    source: 'db' | 'env' | 'none'
    keyHint: string
    hasKey: boolean
  }
}) {
  const router = useRouter()
  const [provider, setProvider] = useState<Provider>(
    (current.provider as Provider) ?? 'mock',
  )
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(current.baseUrl)
  const [model, setModel] = useState(current.model)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium text-ink-900">当前状态</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-500">服务商</dt>
            <dd className="text-ink-900">
              {current.provider === 'mock' ? '未配置(mock)' : current.provider}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-500">模型</dt>
            <dd className="text-ink-900">{current.model || '—'}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-500">API key</dt>
            <dd className="font-mono text-ink-900">{current.keyHint || '未配置'}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-500">配置来源</dt>
            <dd className="text-ink-900">
              {current.source === 'db'
                ? '本页面'
                : current.source === 'env'
                  ? '服务器 .env 文件'
                  : '无'}
            </dd>
          </div>
        </dl>
        {current.source === 'env' && (
          <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
            现在用的是 .env 里的配置。在这里保存一份之后会以本页面为准,改 key 就不用登服务器了。
          </p>
        )}
      </Card>

      <Card>
        <h2 className="font-medium text-ink-900">修改配置</h2>

        <div className="mt-4 space-y-4">
          <Field label="服务商">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className={input}
            >
              <option value="mock">不启用(mock)</option>
              <option value="openai_compatible">OpenAI 兼容接口(通义 / DeepSeek / 豆包 / Kimi)</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>

          {provider === 'openai_compatible' && (
            <>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setBaseUrl(p.baseUrl)
                      setModel(p.model)
                    }}
                    className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-600"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Field label="Base URL">
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={input} />
              </Field>
              <Field label="模型名">
                <input value={model} onChange={(e) => setModel(e.target.value)} className={input} />
              </Field>
            </>
          )}

          {provider === 'anthropic' && (
            <Field label="模型名" hint="留空用 claude-sonnet-5">
              <input value={model} onChange={(e) => setModel(e.target.value)} className={input} />
            </Field>
          )}

          {provider !== 'mock' && (
            <Field
              label="API key"
              hint={
                current.hasKey
                  ? '留空 = 沿用现有的 key(页面不会回显明文)。要换就粘新的进来。'
                  : '粘贴服务商给的 key。保存后会加密存进数据库,页面不再显示明文。'
              }
            >
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={current.hasKey ? '不改就留空' : 'sk-...'}
                autoComplete="off"
                className={`${input} font-mono`}
              />
            </Field>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await saveLlmSettings({ provider, apiKey, baseUrl, model })
                setMsg(
                  res.ok
                    ? { kind: 'ok', text: res.message }
                    : { kind: 'err', text: res.error },
                )
                if (res.ok) {
                  setApiKey('')
                  router.refresh()
                }
              })
            }
          >
            {pending ? '处理中…' : '保存'}
          </Button>

          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMsg(null)
                const res = await testLlmConnection()
                setMsg(
                  res.ok ? { kind: 'ok', text: res.message } : { kind: 'err', text: res.error },
                )
              })
            }
          >
            测试连接
          </Button>

          {current.hasKey && current.source === 'db' && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await removeLlmKey()
                  setMsg({ kind: 'ok', text: '已删除保存的 key。' })
                  router.refresh()
                })
              }
              className="text-xs text-ink-400 underline hover:text-red-600"
            >
              删除已保存的 key
            </button>
          )}
        </div>

        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
          </p>
        )}
      </Card>

      <Card className="border-amber-200 bg-amber-50/60">
        <h2 className="font-medium text-ink-900">关于这把 key 的存放</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-700">
          <li>
            · key 以 AES-256-GCM 加密存在数据库里,页面永远不回显明文,只显示掩码。
          </li>
          <li>
            · 加密密钥是从 <code>AUTH_SECRET</code> 派生的。也就是说,
            <strong>能登上服务器读 .env 的人一样能解开</strong> —— 这层加密防的是
            数据库备份或导出泄露,不是完整的密钥托管。
          </li>
          <li>
            · 按 PRD 10.4,正式接真实用户时应当选<strong>境内合规</strong>的模型服务。
          </li>
          <li>
            · 建议在服务商后台给这把 key 设消费上限。采集功能按页调用,
            一次批量采集几十个页面就是几十次请求。
          </li>
        </ul>
      </Card>
    </div>
  )
}
