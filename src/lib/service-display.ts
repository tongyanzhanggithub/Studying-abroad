type ServiceDisplayInput = {
  code: string
  name: string
  description: string | null
  delivererRole: string
  deliveryForm: string
}

const TEACHER_SERVICE_COPY: Record<string, Partial<ServiceDisplayInput>> = {
  strategy_consult: {
    name: '1对1选校规划课 60min',
    description: '选校规划老师结合你的背景与目标,梳理冲刺/匹配/保底梯度,给出可执行的选校方案。',
    delivererRole: '选校规划老师',
  },
  essay_review: {
    name: '文书老师深度终审(单篇)',
    delivererRole: '文书老师',
  },
  mock_interview: {
    delivererRole: '面试老师',
  },
  hard_case: {
    name: '疑难背景会诊课',
    description: '资深规划老师针对低 GPA、转专业、跨度大、gap year 等背景,给出申请策略。',
    delivererRole: '资深规划老师',
  },
  full_service: {
    name: '全程主理老师陪跑',
    description: '整个申请季由主理老师一对一跟进。已购单点服务可抵扣升级差价。',
    delivererRole: '主理老师',
  },
}

function normalizeTeacherText(text: string): string {
  return text
    .replaceAll('签约顾问', '选校规划老师')
    .replaceAll('资深顾问', '资深规划老师')
    .replaceAll('主顾问', '主理老师')
    .replaceAll('文书编辑', '文书老师')
    .replaceAll('在读学长学姐', '面试老师')
    .replaceAll('顾问', '老师')
}

export function serviceDisplay<T extends ServiceDisplayInput>(sku: T): T {
  const override = TEACHER_SERVICE_COPY[sku.code]
  return {
    ...sku,
    name: override?.name ?? normalizeTeacherText(sku.name),
    description: override?.description ?? (sku.description ? normalizeTeacherText(sku.description) : null),
    delivererRole: override?.delivererRole ?? normalizeTeacherText(sku.delivererRole),
    deliveryForm: override?.deliveryForm ?? normalizeTeacherText(sku.deliveryForm),
  }
}
