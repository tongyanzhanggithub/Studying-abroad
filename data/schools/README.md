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

**二、榜单版本按年份分开存,不强行统一。**(已决策)

上表里 126 所是 QS 2026,57 所是 QS 2027(2026-06-18 发布,当前版)。
**结论:两版并存,`SchoolRanking` 本来就是按 `(school, provider, year)` 存的。**
UI 取每所学校年份最大的那条,并把年份一起显示出来 ——
页面上会同时出现「QS 2026 综合 #113」和「QS 2027 综合 #4」,用户看得见自己在比什么。

由此带来两条代码约束,改动时别破坏:

- `syncQsRanking` **只动被指定的那一年**,绝不删其它年份
- 后台编辑排名时**年份是必填的**(`saveProgram` 会拦)。一个不知道是哪一届的
  名次没法安放进按年份分的表,也没法在页面上诚实标注

仍然存在的取舍:「综合排名优先」排序会跨版本比大小。相邻两届 QS 名次通常只差几位,
而且年份就摆在卡片上,可接受;等 126 所补齐 2027 数据后自然消失。

## 数据红线(PRD 4.2)

早先库里的 QS 排名是凭记忆填的,抽查 6 所错了 5 所,已全部清空重来。
现在导入器强制:**排名有数字就必须带 `source_url`**,否则那条排名直接丢弃并告警。

- QS 未收录的院校 → 整条 `rankings` 留空数组(如 `Frankfurt School of Finance & Management`、`HEC Paris`)
- 只给区间的(如 `801-850`)→ `rank: null` + `rank_text: "801-850"`

宁可不显示,绝不编一个数字。给潜在客户看的排名一旦造假就是法律风险。
