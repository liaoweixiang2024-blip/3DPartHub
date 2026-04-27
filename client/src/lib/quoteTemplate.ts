export interface SectionConfig {
  [key: string]: string | boolean | number;
}

export interface TemplatePageConfig {
  paperSize?: "A4" | "A5";
  orientation?: "portrait" | "landscape";
  marginX?: number;
  marginY?: number;
  baseFontSize?: number;
}

export interface TemplateSection {
  id: string;
  type: "header" | "meta" | "client" | "table" | "fieldGrid" | "remark" | "terms" | "signature" | "footer" | "custom";
  visible: boolean;
  config: SectionConfig;
}

export type DocumentTemplateKind = "quote" | "contract";

export interface QuoteTemplate {
  page?: TemplatePageConfig;
  sections: TemplateSection[];
}

export interface DocumentTemplates {
  quote: QuoteTemplate;
  contract: QuoteTemplate;
}

export const SECTION_LABELS: Record<string, string> = {
  header: "页头",
  meta: "单据信息",
  client: "客户信息",
  table: "产品明细",
  fieldGrid: "字段表格",
  remark: "备注",
  terms: "合同条款",
  signature: "签署区",
  footer: "页脚",
  custom: "自定义内容",
};

export const SECTION_ICONS: Record<string, string> = {
  header: "dashboard",
  meta: "schedule",
  client: "person",
  table: "view_list",
  fieldGrid: "grid_view",
  remark: "edit",
  terms: "rule",
  signature: "edit",
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

export const DEFAULT_QUOTE_PAGE: TemplatePageConfig = {
  paperSize: "A4",
  orientation: "portrait",
  marginX: 18,
  marginY: 18,
  baseFontSize: 14,
};

export const DEFAULT_CONTRACT_PAGE: TemplatePageConfig = {
  paperSize: "A4",
  orientation: "portrait",
  marginX: 20,
  marginY: 18,
  baseFontSize: 14,
};

export const DEFAULT_CONTRACT_SECTIONS: TemplateSection[] = [
  {
    id: "header",
    type: "header",
    visible: true,
    config: { showLogo: true, showSubtitle: true, title: "购 销 合 同", subtitle: "SALES CONTRACT" },
  },
  {
    id: "meta",
    type: "meta",
    visible: true,
    config: { showQuoteNo: true, showDate: true, showContractNo: true },
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
    config: { showIndex: true, showSpec: false, showPrice: true, showSubtotal: true },
  },
  {
    id: "terms",
    type: "terms",
    visible: true,
    config: {
      title: "合同条款",
      content: "1. 付款方式：双方按报价确认内容执行，具体付款节点以双方确认为准。\n2. 交货周期：以供应商最终确认交期为准。\n3. 质量标准：按产品技术资料、样品或双方确认规格执行。\n4. 违约责任：双方协商解决，协商不成按合同签订地相关规定处理。",
    },
  },
  {
    id: "remark",
    type: "remark",
    visible: true,
    config: {},
  },
  {
    id: "signature",
    type: "signature",
    visible: true,
    config: { showDate: true },
  },
  {
    id: "footer",
    type: "footer",
    visible: true,
    config: { showCompany: true, showEmail: true, showGenerated: false, showDate: true },
  },
];

export const DEFAULT_DOCUMENT_TEMPLATES: DocumentTemplates = {
  quote: { page: DEFAULT_QUOTE_PAGE, sections: DEFAULT_SECTIONS },
  contract: { page: DEFAULT_CONTRACT_PAGE, sections: DEFAULT_CONTRACT_SECTIONS },
};

export function parseTemplate(raw: string): QuoteTemplate | null {
  if (!raw || !raw.trim()) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.sections)) return obj as QuoteTemplate;
  } catch {
    // Invalid custom templates fall back to defaults.
  }
  return null;
}

export function serializeTemplate(tpl: QuoteTemplate): string {
  return JSON.stringify(tpl, null, 2);
}

export function parseDocumentTemplates(raw: string, quoteTemplateRaw = ""): DocumentTemplates {
  const quoteFallback = parseTemplate(quoteTemplateRaw) || DEFAULT_DOCUMENT_TEMPLATES.quote;
  if (raw?.trim()) {
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.quote?.sections && obj.contract?.sections) {
        return {
          quote: { page: { ...DEFAULT_QUOTE_PAGE, ...obj.quote.page }, sections: obj.quote.sections },
          contract: { page: { ...DEFAULT_CONTRACT_PAGE, ...obj.contract.page }, sections: obj.contract.sections },
        };
      }
    } catch {
      // Invalid document template JSON falls back to defaults.
    }
  }
  return {
    quote: { page: { ...DEFAULT_QUOTE_PAGE, ...quoteFallback.page }, sections: quoteFallback.sections },
    contract: DEFAULT_DOCUMENT_TEMPLATES.contract,
  };
}

export function serializeDocumentTemplates(tpl: DocumentTemplates): string {
  return JSON.stringify(tpl, null, 2);
}
