import type { AdminRole } from '@prisma/client'

/**
 * 后台角色的中文名。
 *
 * ⚠️ 这份映射原来有**两份**,而且已经漂了:
 *
 *   | 角色        | AccountEditor | admin/layout |
 *   |-------------|---------------|--------------|
 *   | operator    | 运营          | 运营管理员    |
 *   | data_entry  | 数据录入      | 数据核对      |
 *   | advisor     | 交付顾问      | **缺失**      |
 *
 * 同一个人在页头看到「运营管理员」,在账号页看到「运营」——
 * 而两处说的是同一个角色。advisor 在 layout 那份里干脆没有,
 * 只是因为顾问进不了运营后台(requireAdmin 拦着)才没露出空白。
 *
 * ⚠️ 放在 lib 而不是某个组件里,还有一个具体原因:
 *    AccountEditor 是 `'use client'` 模块,从 server component 里
 *    `import { ROLE_LABEL } from './AccountEditor'` 拿到的是 client reference,
 *    属性访问全是 undefined。/admin/me 第一版就这么写的,
 *    页面上「当前角色:」后面是空的 —— 类型检查和构建都不会报。
 */
export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: '超级管理员',
  operator: '运营',
  data_entry: '数据录入',
  advisor: '交付顾问',
}

/** 角色说明 —— 建账号时给超管看,免得凭名字猜权限 */
export const ROLE_DESC: Record<AdminRole, string> = {
  super_admin: '全部权限,含价格、AI key、账号管理',
  operator: '日常运营:派单、核对、通知、线索',
  data_entry: '只能核对院校数据',
  advisor: '只看派给自己的单,进不了运营后台',
}
