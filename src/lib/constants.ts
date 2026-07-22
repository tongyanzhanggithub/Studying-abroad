/**
 * 跨模块共享的业务常量。
 *
 * 单独成文件的原因:`'use server'` 文件只允许导出 async 函数,
 * 常量放在 actions 里会导致整个模块编译失败。
 */

/** 当前用户协议 / 隐私政策版本 —— 内容变更时递增,已同意用户需重新确认 */
export const TERMS_VERSION = '2026-07-v1'

/** 当前申请季标识 —— 每年切换 */
export const CURRENT_SEASON = '2027fall'
