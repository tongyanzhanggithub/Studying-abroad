import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 推荐人卡片:一次只给一个动作。
 *
 * 改这一版之前,卡片上是 5 个状态胶囊 + 4 个文字按钮 —— 9 个同等分量的控件,
 * 没有一个是「现在该点的」。而卡片自己已经算出了下一步(STATUS[].next),
 * 只是把它写成了一句灰色小字。
 *
 * 这些守卫盯的是「别退回九选一」。
 */
const src = codeOnly(
  readFileSync(join(process.cwd(), 'src/app/app/referees/RefereeList.tsx'), 'utf8'),
)

describe('一次只给一个主动作', () => {
  it('主动作是算出来的,不是写死一个按钮', () => {
    expect(src).toContain('function primaryFor(')
    expect(src).toContain('primaryFor(item.status')
  })

  /**
   * ⚠️ 上面那条**证明不了主按钮真的渲染出来了** —— 把它包成 {false && …}
   *    测试照样绿。我写第一版时就是这么被骗过去的(反向验证时才发现)。
   *    文本扫描做不到这件事,要做只能上 jsdom 渲染整个客户端组件。
   *
   *    所以换个角度守:真正的风险不是「按钮被注释掉」,而是
   *    **有人把五个胶囊搬回卡片正面**,退回九选一的老样子。
   *    这个是能扫的 —— STATUS.map 只许出现一次,且必须在 editStatus 分支里。
   */
  it('五个状态胶囊只在「改状态」展开后出现,没有搬回卡片正面', () => {
    expect(src).toContain('改状态')

    const occurrences = src.split('STATUS.map').length - 1
    expect(occurrences).toBe(1)

    const before = src.slice(0, src.indexOf('STATUS.map'))
    expect(before.slice(-200)).toContain('editStatus && (')
  })

  it('「他婉拒了」留在外面 —— 那是真实的另一条分支,不该藏起来', () => {
    expect(src).toContain('他婉拒了')
  })

  /**
   * ⚠️ 素材一条没填就生成,产出的是只有骨架、没有事实的材料。
   *    发过去等于浪费老师一次注意力,而这一环最贵的就是这个。
   */
  it('素材 0 条时,主按钮先把人推回去填素材', () => {
    expect(src).toContain("kind: 'material'")
    expect(src).toContain('materialDone === 0')
  })

  /**
   * ⚠️ 素材包功能整个删掉了(用户:「去掉生成素材包这个功能」)。
   *    这条守卫防的是它被半途捡回来 —— 留一个按钮、没有后端,
   *    或者留一段后端、界面上进不去,都是这个项目最怕的死代码。
   */
  it('素材包已彻底移除,没有留下半截', () => {
    for (const trace of ['生成素材包', 'generatePacket', 'buildRefereePacket', 'packet']) {
      expect(src, `RefereeList 里还留着 ${trace}`).not.toContain(trace)
    }
  })
})
