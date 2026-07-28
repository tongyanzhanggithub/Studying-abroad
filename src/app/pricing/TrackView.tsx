'use client'

import { useEffect, useRef } from 'react'
import { recordPricingView } from './actions'

/**
 * 定价页浏览埋点。渲染任何东西都不是它的职责 —— 只在真正挂载后回调一次。
 *
 * 见 actions.ts 里 recordPricingView 的注释:原来是在服务端渲染期直接写库,
 * 被 Next 的预取和重渲重复计数,而且给匿名流量制造了写放大。
 *
 * ⚠️ 用 ref 挡住第二次执行:React 严格模式(开发环境)会**故意**把 effect
 *    跑两遍来暴露副作用,不挡的话本地调试时每次都记两条。生产只跑一遍,
 *    但这个守卫本身没有代价,留着更保险。
 * ⚠️ catch 掉 —— 埋点失败绝不能冒泡成页面错误。这是一个卖东西的页面,
 *    统计挂了不该影响任何人付款。
 */
export function TrackPricingView({ usingFallback }: { usingFallback: boolean }) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    void recordPricingView(usingFallback).catch(() => {})
  }, [usingFallback])

  return null
}
