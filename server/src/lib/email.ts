import nodemailer from 'nodemailer';
import { config } from './config.js';
import { parseEmailTemplates } from './emailTemplates.js';
import { getAllSettings } from './settings.js';

export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTemplate(source: string, vars: TemplateVars): string {
  return source.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => escapeHtml(vars[key]));
}

function normalizeSiteUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function getSiteUrl(override?: unknown): string {
  const overrideUrl = normalizeSiteUrl(override);
  if (overrideUrl) return overrideUrl;

  const explicit = process.env.SITE_URL || process.env.PUBLIC_SITE_URL || process.env.APP_URL || '';
  if (explicit) return explicit.replace(/\/$/, '');
  const firstOrigin = config.allowedOrigins
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
  return (firstOrigin || 'http://localhost:5173').replace(/\/$/, '');
}

function absoluteUrl(value: unknown, baseUrl: string): string {
  const text = String(value || '');
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return `${baseUrl}${text.startsWith('/') ? '' : '/'}${text}`;
}

function getActionUrl(vars: TemplateVars, siteUrl: string): string {
  return absoluteUrl(vars.actionUrl || vars.actionPath || siteUrl, siteUrl) || siteUrl;
}

async function getSmtpSettings(): Promise<SmtpSettings> {
  const settings = await getAllSettings();
  const host = String(settings.smtp_host || process.env.SMTP_HOST || '');
  const user = String(settings.smtp_user || process.env.SMTP_USER || '');
  const pass = String(settings.smtp_pass || process.env.SMTP_PASS || '');
  const from = String(settings.smtp_from || process.env.SMTP_FROM || user);
  const rawPort = Number(settings.smtp_port || process.env.SMTP_PORT || 465);
  const secure =
    typeof settings.smtp_secure === 'boolean'
      ? settings.smtp_secure
      : String(process.env.SMTP_SECURE ?? 'true') !== 'false';

  return {
    host,
    port: Number.isFinite(rawPort) ? rawPort : 465,
    secure,
    user,
    pass,
    from,
  };
}

async function createTransporter(): Promise<nodemailer.Transporter> {
  const smtp = await getSmtpSettings();
  if (!smtp.host || !smtp.user || !smtp.pass) {
    throw new Error('SMTP 未配置完整，请先填写服务器、用户名和密码/授权码');
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

function formatFrom(from: string, siteTitle: string): string {
  const safeTitle = (siteTitle || '3DPartHub').replace(/["\\\r\n]/g, '');
  return `"${safeTitle}" <${from}>`;
}

function sampleActionForTemplate(templateKey: string): Pick<TemplateVars, 'actionPath' | 'actionLabel'> {
  if (templateKey.includes('ticket_admin')) return { actionPath: '/admin/tickets/demo', actionLabel: '打开工单' };
  if (templateKey.includes('inquiry_admin')) return { actionPath: '/admin/inquiries/demo', actionLabel: '打开询价' };
  if (templateKey.includes('ticket')) return { actionPath: '/my-tickets/demo', actionLabel: '打开工单' };
  if (templateKey.includes('inquiry')) return { actionPath: '/my-inquiries/demo', actionLabel: '打开询价' };
  if (templateKey.includes('model') || templateKey.includes('download') || templateKey.includes('favorite')) {
    return { actionPath: '/model/demo', actionLabel: '打开模型' };
  }
  if (templateKey.includes('backup')) return { actionPath: '/admin/settings', actionLabel: '打开备份设置' };
  return { actionPath: '/', actionLabel: '打开网站' };
}

export async function sendTemplateEmail(templateKey: string, toEmail: string, vars: TemplateVars = {}): Promise<void> {
  const settings = await getAllSettings();
  const templates = parseEmailTemplates(settings.email_templates);
  const template = templates[templateKey];
  if (!template) {
    throw new Error(`邮件模板不存在: ${templateKey}`);
  }

  const smtp = await getSmtpSettings();
  const siteTitle = String(settings.site_title || '3DPartHub');
  const siteUrl = getSiteUrl(vars.siteUrl);
  const actionUrl = getActionUrl(vars, siteUrl);
  const allVars = {
    siteTitle,
    contactEmail: String(settings.contact_email || smtp.from || smtp.user || ''),
    currentYear: new Date().getFullYear(),
    email: toEmail,
    ...vars,
    siteLogo: absoluteUrl(settings.site_logo || '/favicon.svg', siteUrl),
    siteUrl,
    actionUrl,
    actionLabel: vars.actionLabel || '打开入口',
  };

  const transport = await createTransporter();
  await transport.sendMail({
    from: formatFrom(smtp.from || smtp.user, siteTitle),
    to: toEmail,
    subject: renderTemplate(template.subject, allVars),
    html: renderTemplate(template.html, allVars),
  });
}

export async function sendVerifyCode(toEmail: string, code: string, siteUrl?: string): Promise<void> {
  await sendTemplateEmail('register_verify', toEmail, {
    siteUrl,
    actionPath: '/',
    actionLabel: '打开网站',
    code,
    expireMinutes: 10,
  });
}

export async function sendTestEmail(toEmail: string, siteUrl?: string, templateKey = 'smtp_test'): Promise<void> {
  await sendTemplateEmail(templateKey || 'smtp_test', toEmail, {
    siteUrl,
    ...sampleActionForTemplate(templateKey || 'smtp_test'),
    code: '826419',
    expireMinutes: 10,
    testTime: new Date().toLocaleString('zh-CN', { hour12: false }),
    username: '客户',
    inquiryNo: 'INQ-20260427-001',
    itemCount: 3,
    statusLabel: '处理中',
    ticketTitle: '模型下载问题',
    replyPreview: '我们已收到您的问题，正在进一步确认。',
    assigneeName: '销售工程师',
    modelName: '不锈钢接头 STEP 模型',
    errorMessage: '示例错误信息',
    riskLevel: '中风险',
    summary: '备份目录空间不足，请及时检查。',
    downloadFormat: 'STEP',
  });
}
