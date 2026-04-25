export interface SectionConfig {
  [key: string]: string | boolean | number;
}

export interface TemplateSection {
  id: string;
  type: "header" | "meta" | "client" | "table" | "remark" | "footer" | "custom";
  visible: boolean;
  config: SectionConfig;
}

export interface QuoteTemplate {
  sections: TemplateSection[];
}

export const SECTION_LABELS: Record<string, string> = {
  header: "页头",
  meta: "报价信息",
  client: "客户信息",
  table: "产品明细",
  remark: "备注",
  footer: "页脚",
  custom: "自定义内容",
};

export const SECTION_ICONS: Record<string, string> = {
  header: "dashboard",
  meta: "schedule",
  client: "person",
  table: "view_list",
  remark: "edit",
  footer: "more_horiz",
  custom: "description",
};

export const DEFAULT_SECTIONS: TemplateSection[] = [
  {
    id: "header",
    type: "header",
    visible: true,
    config: { showLogo: true, showSubtitle: true, title: "报 价 单", subtitle: "QUOTATION" },
  },
  {
    id: "meta",
    type: "meta",
    visible: true,
    config: { showQuoteNo: true, showDate: true, showValidDays: true, validDays: "30" },
  },
  {
    id: "client",
    type: "client",
    visible: true,
    config: { showCompany: true, showContact: true, showPhone: true },
  },
  {
    id: "table",
    type: "table",
    visible: true,
    config: { showIndex: true, showSpec: true, showPrice: true, showSubtotal: true },
  },
  {
    id: "remark",
    type: "remark",
    visible: true,
    config: {},
  },
  {
    id: "footer",
    type: "footer",
    visible: true,
    config: { showCompany: true, showEmail: true, showGenerated: true, showDate: true },
  },
];

export function parseTemplate(raw: string): QuoteTemplate | null {
  if (!raw || !raw.trim()) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.sections)) return obj as QuoteTemplate;
  } catch {}
  return null;
}

export function serializeTemplate(tpl: QuoteTemplate): string {
  return JSON.stringify(tpl, null, 2);
}
