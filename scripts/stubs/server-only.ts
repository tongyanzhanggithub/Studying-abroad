/**
 * `server-only` 的空实现,仅供 scripts/ 下的脚本使用。
 *
 * 真实的 server-only 包在 Next.js 之外解析到「客户端」入口并主动抛错 ——
 * 这在 Next 里是有用的防护(防止服务端模块被打进客户端 bundle),
 * 但用 tsx 直接跑脚本时会误伤。
 *
 * 通过 scripts/tsconfig.json 的 paths 只在脚本上下文替换,
 * Next 构建仍走真包,防护不受影响。
 */
export {}
