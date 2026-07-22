/**
 * 清空线索表(仅开发环境的临时工具)。
 *
 * 用途:schema 给 leads 增加了带默认值的必填列(share_code)时,
 * Prisma 无法为已有行回填,需要先清掉开发期的测试线索。
 * **不会**动院校库、套餐、SKU 等其它数据。
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const before = await db.lead.count()
  const res = await db.lead.deleteMany({})
  console.log(`线索表:清空前 ${before} 条,已删除 ${res.count} 条`)
}

main()
  .catch((e) => {
    console.error('失败:', e.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
