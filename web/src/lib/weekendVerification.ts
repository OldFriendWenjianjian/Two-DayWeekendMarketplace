import type { Store, WeekendVerificationLevel } from './types';

type VerificationInfo = {
  level: WeekendVerificationLevel;
  code: 'L1' | 'L2' | 'L3' | 'L4' | 'D1' | 'R1';
  tone: 'good' | 'watch' | 'danger';
  summary: string;
};

export const weekendVerificationLevels: WeekendVerificationLevel[] = [
  '已承诺',
  '材料核验',
  '员工确认',
  '持续核验',
  '争议中',
  '已撤销',
];

const verificationDefaults: Record<WeekendVerificationLevel, VerificationInfo> = {
  已承诺: {
    level: '已承诺',
    code: 'L1',
    tone: 'good',
    summary: '企业或商户已签署双休不加班承诺，后续材料和员工确认会继续补强。',
  },
  材料核验: {
    level: '材料核验',
    code: 'L2',
    tone: 'good',
    summary: '已核验制度文件、招聘说明、员工手册、排班记录等材料。',
  },
  员工确认: {
    level: '员工确认',
    code: 'L3',
    tone: 'good',
    summary: '已有企业内部员工匿名或实名确认，公开页面不暴露员工身份。',
  },
  持续核验: {
    level: '持续核验',
    code: 'L4',
    tone: 'good',
    summary: '经过观察期无重大有效投诉，并留有复核记录。',
  },
  争议中: {
    level: '争议中',
    code: 'D1',
    tone: 'watch',
    summary: '出现投诉或材料疑点，平台正在调查，结论以复核账本为准。',
  },
  已撤销: {
    level: '已撤销',
    code: 'R1',
    tone: 'danger',
    summary: '发现虚假承诺或严重不符，双休认证已撤销，历史记录不删除。',
  },
};

const normalizeVerificationLevel = (level?: string): WeekendVerificationLevel => {
  const value = String(level || '').trim();
  return weekendVerificationLevels.find((item) => value === item || value.endsWith(item)) || '已承诺';
};

export const weekendVerificationGuide = weekendVerificationLevels.map((level) => verificationDefaults[level]);

export function getStoreVerificationInfo(store?: Store): VerificationInfo {
  const normalized = normalizeVerificationLevel(store?.verificationLevel);
  return {
    ...verificationDefaults[normalized],
    summary: store?.verificationSummary || verificationDefaults[normalized].summary,
  };
}
