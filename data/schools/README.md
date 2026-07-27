# 目标校清单(`npm run schools:import` 的输入)

这个目录下每个 `.json` 都是一个数组,格式见 [`scripts/import-schools.ts`](../../scripts/import-schools.ts) 头部注释。
以 `_` 开头的文件会被跳过。

| 文件 | 覆盖 | 榜单版本 |
|---|---|---|
| `qs-verified-top300.json` | 90 所**新增**院校(多国扩展) | QS 2026 |
| `verified-extra-targets.json` | 36 所**新增**院校(中段目标校) | QS 2026 |
| `qs-2027-existing.json` | 57 所**库里已有**院校的排名回填 | QS 2027 |

三份清单**校名互不重合**,可以一起导入。

## ⚠️ 两个坑

**一、`name_en` 必须和库里一模一样。**
`import-schools.ts` 按 `(name_en, region)` 做 upsert —— 名字差一个字就不是「更新排名」,
而是**新建一所重名的空壳学校**(没有任何项目,但会出现在后台列表里)。

最容易踩的是牛津和剑桥:库里的条目是商学院,不是整所大学。

| ✗ 不要写 | ✓ 库里的真实名字 |
|---|---|
| `University of Oxford` | `University of Oxford, Saïd Business School` |
| `University of Cambridge` | `University of Cambridge, Judge Business School` |
| `University of Edinburgh` | `University of Edinburgh Business School` |

这三所挂的是**整所大学**的 QS 名次(QS 只排大学,不排商学院),`source_url` 也指向整校页面。
加新条目前先确认库里叫什么:后台 `/admin/programs` 或直接查 `schools.name_en`。

**二、榜单版本目前不统一。**
上表里 126 所是 QS 2026,57 所是 QS 2027(2026-06-18 发布,当前版)。
两版并存会导致页面上混着显示「QS 2026 综合 #113」和「QS 2027 #4」,
而且「综合排名优先」排序会**跨版本比大小**,名次悄悄错位且页面没有任何提示。
上线前必须把 126 所重新按 QS 2027 核实、统一到一版。

## 数据红线(PRD 4.2)

早先库里的 QS 排名是凭记忆填的,抽查 6 所错了 5 所,已全部清空重来。
现在导入器强制:**排名有数字就必须带 `source_url`**,否则那条排名直接丢弃并告警。

- QS 未收录的院校 → 整条 `rankings` 留空数组(如 `Frankfurt School of Finance & Management`、`HEC Paris`)
- 只给区间的(如 `801-850`)→ `rank: null` + `rank_text: "801-850"`

宁可不显示,绝不编一个数字。给潜在客户看的排名一旦造假就是法律风险。
