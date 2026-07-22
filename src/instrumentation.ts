/**
 * Next.js 启动钩子 —— 整个进程只跑一次。
 *
 * ⚠️ `assertProductionConfig()` 之前只是定义了,**从来没有被调用过**。
 *    一个「防止带着 mock 配置上线」的自检,不接进启动流程就是死代码,
 *    而且比没写更糟 —— 读代码的人会以为这层保护存在。
 */
export async function register() {
  // 只在 Node 运行时执行;Edge runtime 里没有这些环境变量
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertProductionConfig } = await import('@/lib/env')
  assertProductionConfig()
}
