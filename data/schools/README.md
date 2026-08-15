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

## 学科排名(`subject_rankings`)

综合排名回答不了学生真正的问题(「这学校商科强不强」),所以另有一份学科排名。

```json
{
  "name_en": "The University of Manchester",
  "region": "UK",
  "rankings": [{ "provider": "qs", "year": 2027, "rank": 40, "source_url": "https://..." }],
  "subject_rankings": [
    { "provider": "qs", "year": 2027, "subject": "Accounting & Finance", "rank": 27, "source_url": "https://..." },
    { "provider": "qs", "year": 2027, "subject": "Business & Management Studies", "rank": 22, "source_url": "https://..." }
  ]
}
```

**挂在学校上,不挂在项目上。** QS 学科榜是按「大学 × 学科」发布的,曼大商学院下面
十几个授课型硕士共用同一个 Business & Management 名次。项目按自己的 `direction`
映射到学科自动继承,不用逐个填(映射表见
[`src/lib/programs/qs-subjects.ts`](../../src/lib/programs/qs-subjects.ts))。

### ⚠️ `subject` 必须和 QS 榜单英文原文一模一样

大小写、`&`、空格都要一致。拼成 `Accounting and Finance` 不会报错,
但项目按 direction **查不到自己的名次** —— 悄悄查不到。
导入脚本会拿映射表比对并告警(不拦,因为 QS 每年会调整学科划分)。

### 大类 vs 细分学科

有些方向 QS 只有**大类**(faculty area)没有细分榜,如工程、自然科学、人文。
映射表里这些标了 `broad: true`,页面上会额外标一个「大类」——
「工程与技术大类第 20」和「机械工程第 20」含金量差很远,不能都写成「专业排名」。

### 现状

**目前一条学科排名数据都没有。** 通路已经打通(导入 → 存储 → 选校卡片 → 院校详情页
→「专业排名优先」排序),缺的是联网核实过的数据。按红线,一个数字都不能凭印象填。

## 数据红线(PRD 4.2)

早先库里的 QS 排名是凭记忆填的,抽查 6 所错了 5 所,已全部清空重来。
现在导入器强制:**排名有数字就必须带 `source_url`**,否则那条排名直接丢弃并告警。

- QS 未收录的院校 → 整条 `rankings` 留空数组(如 `Frankfurt School of Finance & Management`、`HEC Paris`)
- 只给区间的(如 `801-850`)→ `rank: null` + `rank_text: "801-850"`

宁可不显示,绝不编一个数字。给潜在客户看的排名一旦造假就是法律风险。
