'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Button, Card } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { cn, countWords } from '@/lib/utils'
import type { RecommendationCard as RecCardData } from '@/lib/recommendation/types'
import type { ComplianceResult } from '@/lib/essays/compliance'
import {
  askInterview,
  generateOutline,
  polishText,
  saveContent,
  checkCompliance,
  finalizeEssay,
  type PolishSuggestion,
} from '@/app/app/essays/actions'

/**
 * 文书工作台(PRD 4.5)。
 *
 * ⚠️ 界面上**刻意没有**「一键生成全文」按钮。三个 AI 入口分别是:
 *    访谈提问 / 结构建议 / 逐句润色(diff 逐条接受或拒绝)。
 *    这不是遗漏,是产品红线。
 */

type Tab = 'interview' | 'outline' | 'polish' | 'compliance'

const AI_POLICY_BANNER = {
  zero_tolerance: {
    cls: 'border-red-200 bg-red-50 text-red-900',
    text: '这所学校对申请文书中使用 AI 持零容忍态度。本工作台的 AI 只做提问与语法建议,内容必须完全出自你本人。',
  },
  limited_allowed: {
    cls: 'border-amber-200 bg-amber-50 text-amber-900',
    text: '这所学校有限允许 AI 辅助(通常限语法润色)。观点与经历必须是你自己的。',
  },
  unspecified: {
    cls: 'border-ink-200 bg-ink-50 text-ink-600',
    text: '未查到这所学校的 AI 使用政策。保守做法:把 AI 当语法工具,不要让它替你产生观点。',
  },
} as const

export function EssayWorkbench(props: {
  essayId: string
  title: string
  schoolName: string | null
  aiPolicyLevel: keyof typeof AI_POLICY_BANNER | null
  promptText: string | null
  wordLimit: number | null
  status: 'drafting' | 'polishing' | 'final'
  polishRound: number
  initialContent: string
  outline: string | null
  interviewMessages: Array<{ role: string; content: string }>
  complianceCheck: ComplianceResult | null
  remainingQuota: number
  recCard: RecCardData | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('interview')
  const [messages, setMessages] = useState(props.interviewMessages)
  const [input, setInput] = useState('')
  const [outline, setOutline] = useState(props.outline)
  const [suggestions, setSuggestions] = useState<PolishSuggestion[]>([])
  const [compliance, setCompliance] = useState(props.complianceCheck)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [wordCount, setWordCount] = useState(countWords(props.initialContent))
  const [pending, startTransition] = useTransition()

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 移动端只读(PRD 8 非功能需求)。
   *
   * 文书是长文本重度写作场景,小屏上编辑体验很差 ——
   * 与其给一个憋屈的编辑器,不如明确告诉用户去电脑上写,
   * 手机上保留查看与 AI 访谈(访谈是对话式的,反而适合手机)。
   */
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const readOnly = props.status === 'final' || isNarrow

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '在这里写你的文书…' }),
    ],
    content: props.initialContent,
    immediatelyRender: false,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      setWordCount(countWords(text))
      setSaved('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void saveContent(props.essayId, editor.getHTML()).then(() => setSaved('saved'))
      }, 1200)
    },
  })

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  // editable 只在初始化时读取,窗口尺寸变化后需要显式同步
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const banner = props.aiPolicyLevel ? AI_POLICY_BANNER[props.aiPolicyLevel] : null

  function run(fn: () => Promise<void>) {
    setError(null)
    startTransition(() => void fn())
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{props.title}</h1>
          {props.schoolName && <p className="text-sm text-ink-600">{props.schoolName}</p>}
        </div>
        <div className="text-right text-xs text-ink-400">
          <p>
            {wordCount} 字
            {props.wordLimit ? ` / ${props.wordLimit}` : ''}
            {saved === 'saving' && ' · 保存中…'}
            {saved === 'saved' && ' · 已保存'}
          </p>
          <p className="mt-0.5">今日 AI 剩余 {props.remainingQuota} 次</p>
        </div>
      </div>

      {/* 院校 AI 政策警告 —— 零容忍必须显著 */}
      {banner && (
        <div className={cn('rounded-lg border px-4 py-3 text-sm leading-relaxed', banner.cls)}>
          {banner.text}
        </div>
      )}

      {props.promptText && (
        <Card className="bg-ink-50">
          <p className="text-xs text-ink-400">文书题目</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-800">{props.promptText}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* 编辑器 */}
        <Card className="min-h-[24rem] lg:min-h-[32rem]">
          {props.status === 'final' && (
            <p className="mb-3 rounded bg-safe/10 px-3 py-2 text-sm text-safe">
              已标记为终稿,内容已锁定。如需修改请先在右侧取消终稿状态。
            </p>
          )}

          {/* PRD 8:文书编辑器不支持 <768px 全功能,移动端只读 */}
          {isNarrow && props.status !== 'final' && (
            <p className="mb-3 rounded bg-ink-100 px-3 py-2 text-sm leading-relaxed text-ink-600">
              手机上暂为只读。文书是长文本写作,小屏幕上很难写好 ——
              建议在电脑上打开这一页动笔。
              <br />
              右侧的<strong>素材访谈</strong>是对话式的,手机上完全可用,
              可以先把经历聊清楚。
            </p>
          )}

          <EditorContent editor={editor} className="tiptap" />
        </Card>

        {/* 侧栏 */}
        <div className="space-y-3">
          {props.recCard && <RecommendationCard card={props.recCard} />}

          <Card className="p-0">
            <div className="flex border-b border-ink-100 text-sm">
              {([
                ['interview', '素材访谈'],
                ['outline', '结构'],
                ['polish', '润色'],
                ['compliance', '合规'],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    'flex-1 px-2 py-2.5',
                    tab === k
                      ? 'border-b-2 border-brand-500 font-medium text-brand-700'
                      : 'text-ink-600 hover:text-ink-900',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {error && (
                <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}

              {/* 素材访谈 */}
              {tab === 'interview' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-ink-400">
                    AI 会一次问一个问题,帮你把经历讲具体。它不会替你写文书 ——
                    要求它写整段会被拒绝。
                  </p>

                  <div className="max-h-80 space-y-3 overflow-y-auto">
                    {messages.length === 0 && (
                      <p className="text-sm text-ink-400">
                        先说说你为什么想申这个专业,随便说,不用组织语言。
                      </p>
                    )}
                    {messages.map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                          m.role === 'user'
                            ? 'bg-brand-50 text-ink-800'
                            : 'bg-ink-50 text-ink-800',
                        )}
                      >
                        {m.content}
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    rows={3}
                    placeholder="说说你的经历…"
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  <Button
                    size="sm"
                    disabled={pending || !input.trim()}
                    className="w-full"
                    onClick={() =>
                      run(async () => {
                        const res = await askInterview(props.essayId, input)
                        if (!res.ok) {
                          setError(res.error)
                          return
                        }
                        setMessages((p) => [
                          ...p,
                          { role: 'user', content: input },
                          { role: 'assistant', content: res.reply },
                        ])
                        setInput('')
                      })
                    }
                  >
                    {pending ? '思考中…' : '发送'}
                  </Button>
                </div>
              )}

              {/* 结构建议 */}
              {tab === 'outline' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-ink-400">
                    基于访谈素材给出段落大纲。只有要点,不会给你可以直接抄的句子。
                  </p>
                  {outline ? (
                    <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-800">
                      {outline}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-400">还没有生成结构建议。</p>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    className="w-full"
                    onClick={() =>
                      run(async () => {
                        const res = await generateOutline(props.essayId)
                        if (!res.ok) setError(res.error)
                        else setOutline(res.outline)
                      })
                    }
                  >
                    {pending ? '生成中…' : outline ? '重新生成' : '生成结构建议'}
                  </Button>
                </div>
              )}

              {/* 逐句润色 */}
              {tab === 'polish' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-ink-400">
                    在左边选中一段文字,然后点下面的按钮。修改建议会逐条列出,
                    你自己决定接受哪些。已润色 {props.polishRound} 轮。
                  </p>

                  {isNarrow && (
                    <p className="rounded bg-ink-100 px-3 py-2 text-xs leading-relaxed text-ink-600">
                      润色需要修改正文,手机上是只读的。请在电脑上使用。
                    </p>
                  )}

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || isNarrow}
                    className="w-full"
                    onClick={() =>
                      run(async () => {
                        if (!editor) return
                        const { from, to } = editor.state.selection
                        const selected = editor.state.doc.textBetween(from, to, ' ')
                        const target = selected.trim() || editor.getText()
                        const res = await polishText(props.essayId, target)
                        if (!res.ok) setError(res.error)
                        else setSuggestions(res.suggestions)
                      })
                    }
                  >
                    {pending ? '润色中…' : '润色选中段落'}
                  </Button>

                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <div key={i} className="rounded-lg border border-ink-200 p-2.5 text-sm">
                        <p className="diff-del px-1">{s.original}</p>
                        <p className="diff-ins mt-1 px-1">{s.suggestion}</p>
                        <p className="mt-1.5 text-xs text-ink-400">{s.reason}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            className="rounded border border-safe px-2 py-0.5 text-xs text-safe"
                            onClick={() => {
                              if (!editor) return
                              const html = editor.getHTML().replace(s.original, s.suggestion)
                              editor.commands.setContent(html)
                              void saveContent(props.essayId, html)
                              setSuggestions((p) => p.filter((_, j) => j !== i))
                            }}
                          >
                            接受
                          </button>
                          <button
                            className="rounded border border-ink-200 px-2 py-0.5 text-xs text-ink-600"
                            onClick={() => setSuggestions((p) => p.filter((_, j) => j !== i))}
                          >
                            拒绝
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 合规检查 */}
              {tab === 'compliance' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-ink-400">
                    标记终稿前必须通过合规检查。标红的问题必须处理。
                  </p>

                  {compliance && (
                    <div className="space-y-2">
                      {compliance.issues.map((issue, i) => (
                        <div
                          key={i}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-xs leading-relaxed',
                            issue.severity === 'blocker' && 'border-red-200 bg-red-50 text-red-900',
                            issue.severity === 'warning' &&
                              'border-amber-200 bg-amber-50 text-amber-900',
                            issue.severity === 'info' && 'border-ink-200 bg-ink-50 text-ink-600',
                          )}
                        >
                          <p className="font-medium">{issue.title}</p>
                          <p className="mt-1 whitespace-pre-wrap">{issue.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    className="w-full"
                    onClick={() =>
                      run(async () => {
                        const res = await checkCompliance(props.essayId)
                        if (!res.ok) setError(res.error)
                        else setCompliance(res.result)
                      })
                    }
                  >
                    {pending ? '检查中…' : '运行合规检查'}
                  </Button>

                  {props.status !== 'final' && (
                    <Button
                      size="sm"
                      disabled={pending}
                      className="w-full"
                      onClick={() =>
                        run(async () => {
                          const res = await finalizeEssay(props.essayId)
                          if (!res.ok) {
                            setError(res.error)
                            if (res.result) setCompliance(res.result)
                            return
                          }
                          setCompliance(res.result)
                          router.refresh()
                        })
                      }
                    >
                      标记为终稿
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
