import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 材料页的分母和页面上的卡片数**对不上**:13 张卡、进度写 0/11。
 * 差的两张是「加分项 · 可不交」,不计入完成度 —— 逻辑对,但不解释就像算错了。
 *
 * getMaterialProgress 早就把 optionalTotal / optionalDone 算出来了,
 * 注释里还写着「UI 可以展示成『另有 N 项加分材料』」,只是一直没人接。
 * 这条守卫盯的就是「别又把它断开」。
 */
const src = codeOnly(readFileSync(join(process.cwd(), 'src/app/app/materials/page.tsx'), 'utf8'))

describe('材料完成度的分母要解释清楚', () => {
  it('页面用上了 optionalTotal —— 否则 13 张卡配 0/11 会被当成算错', () => {
    expect(src).toContain('progress.optionalTotal')
  })

  it('已完成的加分项也要报出来,不然「另有 N 项」是个死数字', () => {
    expect(src).toContain('progress.optionalDone')
  })

  it('说明里要写清楚不交也不影响 —— 只说「不计入」还是会让人以为漏了什么', () => {
    expect(src).toContain('不交也不影响')
  })
})
