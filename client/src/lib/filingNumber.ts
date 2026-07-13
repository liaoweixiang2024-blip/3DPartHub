// 公安备案号查询链接构建（纯逻辑、零依赖，便于单元测试）。
//
// 全国互联网安全管理平台（beian.gov.cn）的记录号 recordcode 通常为 14 位数字。
// 由备案号字符串中提取数字：达到 14 位则生成标准查询链接，不足则返回空串
// （调用方按纯文本渲染、不可点）。缓存读写见 ./publicSettings.ts 的 getFooterPoliceUrl。

const POLICE_RECORDCODE_MIN_DIGITS = 14;
const BEIAN_GOV_QUERY_BASE = 'https://www.beian.gov.cn/portal/registerSystemInfo';

export function buildPoliceFilingUrl(policeNumber: string | null | undefined): string {
  const digits = String(policeNumber ?? '').replace(/\D/g, '');
  if (digits.length < POLICE_RECORDCODE_MIN_DIGITS) return '';
  return `${BEIAN_GOV_QUERY_BASE}?recordcode=${digits}`;
}
