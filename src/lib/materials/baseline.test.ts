import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 保底材料清单与学历分支。
 *
 * 这里盯两类会**静默出错**的问题:
 *
 *   1. 在读证明 / 毕业证是互斥的。同时出现的话学生得自己判断哪项与自己无关,
 *      而「清单自动生成」这条卖点的全部意义就是不让他做这个判断;
 *      弄反了更糟 —— 他会按清单跑一趟学校,开回一张学校根本开不出的证明。
 *
 *   2. 清单里写的 code 必须在种子模板里真的存在。拼错一个字符不会报错,
 *      那一项只是**悄悄不出现**在所有人的清单上(generate.ts 里
 *      `const tpl = byCode.get(code); if (tpl) add(...)` 会把找不到的跳过)。
 *      这正是我这次差点犯的错:建了 award_certificate / research_output
 *      两个模板却忘了加进 BASELINE_CODES,它们对谁都不会出现。
 *
 * 用源码文本检查,不连库 —— 目的是防「对不上」,不是验运行时行为。
 */

const SRC = join(process.cwd(), 'src')
const generateSrc = readFileSync(join(SRC, 'lib/materials/generate.ts'), 'utf8')
const seedSrc = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8')

/** 从 generate.ts 里抠出 BASELINE_CODES 数组里的字符串 */
function baselineCodes(): string[] {
  const block = generateSrc.slice(
    generateSrc.indexOf('const BASELINE_CODES'),
    generateSrc.indexOf('] as const', generateSrc.indexOf('const BASELINE_CODES')),
  )
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

/** 种子里定义了哪些模板 code */
function seededCodes(): string[] {
  const block = seedSrc.slice(
    seedSrc.indexOf('async function seedMaterialTemplates'),
    seedSrc.indexOf('async function seedServiceSkus'),
  )
  return [...block.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])
}

describe('保底清单里的 code 都真实存在', () => {
  const seeded = seededCodes()

  it('种子里至少有这次新增的几项', () => {
    for (const code of [
      'enrollment_certificate',
      'internship_certificate',
      'award_certificate',
      'research_output',
      'letterhead_paper',
      'intl_credit_card',
    ]) {
      expect(seeded).toContain(code)
    }
  })

  it.each(baselineCodes())('BASELINE_CODES 里的 %s 在种子中有定义', (code) => {
    expect(seeded).toContain(code)
  })

  it('两个学历分支的 code 也在种子中', () => {
    expect(seeded).toContain('enrollment_certificate')
    expect(seeded).toContain('degree_certificate')
  })

  it('种子里的 code 不重复 —— 重复会让 upsert 互相覆盖', () => {
    expect(new Set(seeded).size).toBe(seeded.length)
  })
})

describe('学历证明必须互斥', () => {
  it('BASELINE_CODES 里不含任何一个学历证明', () => {
    // 它们由 ENROLLMENT_CODES 按学历状态二选一加入,写死在保底清单里就会两个都出现
    const codes = baselineCodes()
    expect(codes).not.toContain('enrollment_certificate')
    expect(codes).not.toContain('degree_certificate')
  })

  it('ENROLLMENT_CODES 两个分支都映射到了正确的 code', () => {
    const block = generateSrc.slice(
      generateSrc.indexOf('const ENROLLMENT_CODES'),
      generateSrc.indexOf('}', generateSrc.indexOf('const ENROLLMENT_CODES')),
    )
    expect(block).toContain("enrolled: 'enrollment_certificate'")
    expect(block).toContain("graduated: 'degree_certificate'")
  })

  it('种子里两项各自标了 forEnrollment,否则运营在后台看不出它们是互斥的', () => {
    const block = seedSrc.slice(
      seedSrc.indexOf("code: 'enrollment_certificate'"),
      seedSrc.indexOf("code: 'cv'"),
    )
    expect(block).toContain("forEnrollment: 'enrolled'")
    expect(block).toContain("forEnrollment: 'graduated'")
  })
})

describe('可选材料不该被算进完成度', () => {
  it('getMaterialProgress 明确过滤掉 optional', () => {
    // 不过滤的话,没得过奖的学生永远到不了 100% —— 一个满不了的进度条
    expect(generateSrc).toContain('!m.template.optional')
  })
})
