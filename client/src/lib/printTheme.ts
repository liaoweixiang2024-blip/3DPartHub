export const INQUIRY_PRINT_COLORS = {
  bodyBackground: '#e5e7eb',
  pageBackground: '#ffffff',
  text: '#0f172a',
  mutedText: '#64748b',
  border: '#cbd5e1',
  subtleBackground: '#f1f5f9',
  rowBackground: '#f8fafc',
  actionPrimary: '#2563eb',
  noteText: '#334155',
  signatureLine: '#94a3b8',
} as const;

export const INQUIRY_PRINT_ACTION_SHADOW = '0 8px 24px rgba(15, 23, 42, .18)';

export function buildInquiryPrintCss(): string {
  const c = INQUIRY_PRINT_COLORS;
  return `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: ${c.bodyBackground}; color: ${c.text}; font-family: Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: ${c.pageBackground}; padding: 22mm 18mm; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border-bottom: 2px solid ${c.text}; padding-bottom: 16px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand img, .logo-fallback { width: 46px; height: 46px; object-fit: contain; border: 1px solid ${c.border}; display: grid; place-items: center; font-size: 20px; font-weight: 900; }
    .company { font-size: 22px; font-weight: 900; line-height: 1.2; }
    .en { margin-top: 4px; color: ${c.mutedText}; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; }
    .title { text-align: right; }
    .title h1 { margin: 0; font-size: 32px; letter-spacing: 0.18em; }
    .title p { margin: 4px 0 0; color: ${c.mutedText}; font-size: 12px; font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; margin-top: 18px; border: 1px solid ${c.border}; font-size: 12px; }
    .meta-block { display: grid; grid-template-columns: 88px 1fr; }
    .meta-block:first-child { border-right: 1px solid ${c.border}; }
    .label, .value { padding: 8px 10px; border-bottom: 1px solid ${c.border}; }
    .meta-block .label:nth-last-child(2), .meta-block .value:last-child { border-bottom: 0; }
    .label { background: ${c.subtleBackground}; font-weight: 800; }
    .value { font-weight: 600; }
    .section-head { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; margin-bottom: 8px; }
    .section-head h2 { margin: 0; font-size: 14px; font-weight: 900; }
    .section-head span { color: ${c.mutedText}; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
    th { background: ${c.text}; color: ${c.pageBackground}; border: 1px solid ${c.text}; padding: 8px 6px; text-align: left; }
    td { border: 1px solid ${c.border}; padding: 9px 6px; vertical-align: top; line-height: 1.55; word-break: break-word; }
    tbody tr:nth-child(even) { background: ${c.rowBackground}; }
    .center { text-align: center; }
    .right { text-align: right; }
    .strong { font-weight: 800; }
    .muted { color: ${c.mutedText}; }
    .note { display: grid; grid-template-columns: 90px 1fr; margin-top: 18px; border: 1px solid ${c.border}; font-size: 12px; }
    .note .label { border-bottom: 0; border-right: 1px solid ${c.border}; }
    .note .body { padding: 10px; line-height: 1.8; color: ${c.noteText}; }
    footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 38px; font-size: 12px; color: ${c.noteText}; }
    .sign p { margin: 0 0 34px; font-weight: 800; }
    .line { border-top: 1px solid ${c.signatureLine}; padding-top: 8px; }
    @media print { body { background: ${c.pageBackground}; } .page { margin: 0; box-shadow: none; } }
  `;
}
