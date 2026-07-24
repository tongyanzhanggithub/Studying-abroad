// 由《普通高等学校本科专业目录(2026)》生成 —— 国标 12 学科门类 + 专业类。
// ⚠️ 这是权威分类。生成脚本见提交说明;要更新目录,重跑解析而不是手改。
import type { Direction } from '@prisma/client'

export interface SubjectCategory { code: string; name: string }
export interface DisciplineCategory {
  code: string
  name: string
  /** 该门类下的专业类(国标)*/
  categories: SubjectCategory[]
  /** 顺延方向(海外授课项目里最对口的)*/
  primary: Direction[]
  /** 常见转向 */
  adjacent: Direction[]
}

export const UNDERGRAD_DISCIPLINES: DisciplineCategory[] = [
  { code: "01", name: "哲学",
    primary: ["humanities", "social_sciences"], adjacent: ["education", "law_public_policy", "media_communication"],
    categories: [{"code": "0101", "name": "哲学类"}] },
  { code: "02", name: "经济学",
    primary: ["finance", "economics", "business_analytics"], adjacent: ["accounting", "management", "international_business", "data_science_ai"],
    categories: [{"code": "0201", "name": "经济学类"}, {"code": "0202", "name": "财政学类"}, {"code": "0203", "name": "金融学类"}, {"code": "0204", "name": "经济与贸易类"}] },
  { code: "03", name: "法学",
    primary: ["law_public_policy", "social_sciences"], adjacent: ["international_business", "management", "public_health"],
    categories: [{"code": "0301", "name": "法学类"}, {"code": "0302", "name": "政治学类"}, {"code": "0303", "name": "社会学类"}, {"code": "0304", "name": "民族学类"}, {"code": "0305", "name": "马克思主义理论类"}, {"code": "0306", "name": "公安学类"}] },
  { code: "04", name: "教育学",
    primary: ["education", "social_sciences"], adjacent: ["media_communication", "public_health", "management"],
    categories: [{"code": "0401", "name": "教育学类"}, {"code": "0402", "name": "体育学类"}] },
  { code: "05", name: "文学",
    primary: ["humanities", "media_communication"], adjacent: ["education", "arts_design", "social_sciences"],
    categories: [{"code": "0501", "name": "中国语言文学类"}, {"code": "0502", "name": "外国语言文学类"}, {"code": "0503", "name": "新闻传播学类"}] },
  { code: "06", name: "历史学",
    primary: ["humanities", "social_sciences"], adjacent: ["education", "arts_design", "media_communication"],
    categories: [{"code": "0601", "name": "历史学类"}] },
  { code: "07", name: "理学",
    primary: ["natural_sciences", "mathematics_statistics", "data_science_ai"], adjacent: ["computer_science", "engineering", "finance", "environment_sustainability"],
    categories: [{"code": "0701", "name": "数学类"}, {"code": "0702", "name": "物理学类"}, {"code": "0703", "name": "化学类"}, {"code": "0704", "name": "天文学类"}, {"code": "0705", "name": "地理科学类"}, {"code": "0706", "name": "大气科学类"}, {"code": "0707", "name": "海洋科学类"}, {"code": "0708", "name": "地球物理学类"}, {"code": "0709", "name": "地质学类"}, {"code": "0710", "name": "生物科学类"}, {"code": "0711", "name": "心理学类"}, {"code": "0712", "name": "统计学类"}] },
  { code: "08", name: "工学",
    primary: ["engineering", "computer_science", "data_science_ai"], adjacent: ["architecture", "supply_chain", "environment_sustainability", "mathematics_statistics", "management"],
    categories: [{"code": "0801", "name": "力学类"}, {"code": "0802", "name": "机械类"}, {"code": "0803", "name": "仪器类"}, {"code": "0804", "name": "材料类"}, {"code": "0805", "name": "能源动力类"}, {"code": "0806", "name": "电气类"}, {"code": "0807", "name": "电子信息类"}, {"code": "0808", "name": "自动化类"}, {"code": "0809", "name": "计算机类"}, {"code": "0810", "name": "土木类"}, {"code": "0811", "name": "水利类"}, {"code": "0812", "name": "测绘类"}, {"code": "0813", "name": "化工与制药类"}, {"code": "0814", "name": "地质类"}, {"code": "0815", "name": "矿业类"}, {"code": "0816", "name": "纺织类"}, {"code": "0817", "name": "轻工类"}, {"code": "0818", "name": "交通运输类"}, {"code": "0819", "name": "海洋工程类"}, {"code": "0820", "name": "航空航天类"}, {"code": "0821", "name": "兵器类"}, {"code": "0822", "name": "核工程类"}, {"code": "0823", "name": "农业工程类"}, {"code": "0824", "name": "林业工程类"}, {"code": "0825", "name": "环境科学与工程类"}, {"code": "0826", "name": "生物医学工程类"}, {"code": "0827", "name": "食品科学与工程类"}, {"code": "0828", "name": "建筑类"}, {"code": "0829", "name": "安全科学与工程类"}, {"code": "0830", "name": "生物工程类"}, {"code": "0831", "name": "公安技术类"}] },
  { code: "09", name: "农学",
    primary: ["agriculture_food_science", "environment_sustainability", "life_sciences_medicine"], adjacent: ["natural_sciences", "management", "public_health"],
    categories: [{"code": "0901", "name": "植物生产类"}, {"code": "0902", "name": "自然保护与环境生态类"}, {"code": "0903", "name": "动物生产类"}, {"code": "0904", "name": "动物医学类"}, {"code": "0905", "name": "林学类"}, {"code": "0906", "name": "水产类"}, {"code": "0907", "name": "草学类"}] },
  { code: "10", name: "医学",
    primary: ["life_sciences_medicine", "public_health"], adjacent: ["data_science_ai", "management", "education", "natural_sciences"],
    categories: [{"code": "1001", "name": "基础医学类"}, {"code": "1002", "name": "临床医学类"}, {"code": "1003", "name": "口腔医学类"}, {"code": "1004", "name": "公共卫生与预防医学类"}, {"code": "1005", "name": "中医学类"}, {"code": "1006", "name": "中西医结合类"}, {"code": "1007", "name": "药学类"}, {"code": "1008", "name": "中药学类"}, {"code": "1009", "name": "法医学类"}, {"code": "1010", "name": "医学技术类"}, {"code": "1011", "name": "护理学类"}] },
  { code: "11", name: "管理学",
    primary: ["management", "marketing", "international_business", "hr", "business_analytics"], adjacent: ["finance", "accounting", "supply_chain", "hospitality_tourism", "data_science_ai"],
    categories: [{"code": "1201", "name": "管理科学与工程类"}, {"code": "1202", "name": "工商管理类"}, {"code": "1203", "name": "农业经济管理类"}, {"code": "1204", "name": "公共管理类"}, {"code": "1205", "name": "图书情报与档案管理类"}, {"code": "1206", "name": "物流管理与工程类"}, {"code": "1207", "name": "工业工程类"}, {"code": "1208", "name": "电子商务类"}, {"code": "1209", "name": "旅游管理类"}] },
  { code: "12", name: "艺术学",
    primary: ["arts_design", "media_communication"], adjacent: ["architecture", "marketing", "humanities", "education"],
    categories: [{"code": "1201", "name": "管理科学与工程类"}, {"code": "1202", "name": "工商管理类"}, {"code": "1203", "name": "农业经济管理类"}, {"code": "1204", "name": "公共管理类"}, {"code": "1205", "name": "图书情报与档案管理类"}, {"code": "1206", "name": "物流管理与工程类"}, {"code": "1207", "name": "工业工程类"}, {"code": "1208", "name": "电子商务类"}, {"code": "1209", "name": "旅游管理类"}] },
]
