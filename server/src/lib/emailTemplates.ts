export interface EmailTemplate {
  label: string;
  description: string;
  subject: string;
  html: string;
  tokens: string[];
}

export type EmailTemplateMap = Record<string, EmailTemplate>;

const emailShellStart = `
<div style="max-width:560px;margin:0 auto;background:#ffffff;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="padding:24px 28px 18px;border-bottom:1px solid #f3f4f6;">
    <a href="{{actionUrl}}" style="display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:#111827;">
      <img src="{{siteLogo}}" alt="{{siteTitle}}" style="height:36px;max-width:160px;object-fit:contain;border:0;vertical-align:middle;" />
      <strong style="font-size:18px;line-height:1.2;">{{siteTitle}}</strong>
    </a>
  </div>
  <div style="padding:28px;">
`.trim();

const emailShellEnd = `
  </div>
  <div style="padding:18px 28px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.7;">
    <div style="margin:0 0 12px;"><a href="{{actionUrl}}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#f97316;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">{{actionLabel}}</a></div>
    <div>入口：<a href="{{actionUrl}}" style="color:#f97316;text-decoration:none;">{{actionUrl}}</a></div>
    <div>如需帮助，请联系 {{contactEmail}}</div>
    <div>&copy; {{currentYear}} {{siteTitle}}</div>
  </div>
</div>
`.trim();

const commonTokens = [
  'siteTitle',
  'siteLogo',
  'siteUrl',
  'actionUrl',
  'actionLabel',
  'contactEmail',
  'currentYear',
  'email',
];

function withActionLinks(html: string): string {
  const legacyHeader = 'href="{{siteUrl}}" style="display:inline-flex;';
  const actionHeader = 'href="{{actionUrl}}" style="display:inline-flex;';
  const legacyFooter = '<div><a href="{{siteUrl}}" style="color:#f97316;text-decoration:none;">{{siteUrl}}</a></div>';
  const actionFooter =
    '<div style="margin:0 0 12px;"><a href="{{actionUrl}}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#f97316;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">{{actionLabel}}</a></div>\n' +
    '    <div>入口：<a href="{{actionUrl}}" style="color:#f97316;text-decoration:none;">{{actionUrl}}</a></div>';
  return html.split(legacyHeader).join(actionHeader).split(legacyFooter).join(actionFooter);
}

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateMap = {
  register_verify: {
    label: '注册邮箱验证码',
    description: '用户注册账号时发送验证码',
    subject: '{{siteTitle}} 注册验证码',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 18px;color:#111827;">注册验证码</h2>
  <p style="margin:0 0 12px;font-size:15px;">您的注册验证码为：</p>
  <div style="margin:18px 0;padding:18px;border-radius:10px;background:#fff7ed;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#f97316;">{{code}}</div>
  <p style="margin:0;color:#6b7280;font-size:13px;">验证码 {{expireMinutes}} 分钟内有效，请勿泄露给他人。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'code', 'expireMinutes'],
  },
  smtp_test: {
    label: '邮件服务测试',
    description: '管理员在系统设置中测试 SMTP 配置',
    subject: '{{siteTitle}} 邮件测试',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">邮件服务测试成功</h2>
  <p style="margin:0 0 10px;">这是一封来自 {{siteTitle}} 的测试邮件。</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">发送时间：{{testTime}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'testTime'],
  },
  inquiry_submitted: {
    label: '询价提交通知',
    description: '用户提交询价后发送确认或通知',
    subject: '{{siteTitle}} 已收到您的询价 {{inquiryNo}}',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已提交</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，我们已收到您的询价。</p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快处理并与您联系。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'inquiryNo'],
  },
  inquiry_status_changed: {
    label: '询价状态变更',
    description: '询价状态更新时通知用户',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 状态已更新',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">询价状态已更新</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'inquiryNo', 'statusLabel'],
  },
  ticket_created: {
    label: '工单创建通知',
    description: '用户提交技术支持工单后发送确认',
    subject: '{{siteTitle}} 已收到您的工单',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">工单已创建</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，您的工单已进入处理队列。</p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快回复。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'ticketTitle'],
  },
  ticket_replied: {
    label: '工单回复通知',
    description: '管理员回复工单时通知用户',
    subject: '{{siteTitle}} 您的工单有新回复',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新回复</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'ticketTitle', 'replyPreview'],
  },
  ticket_status_changed: {
    label: '工单状态变更',
    description: '工单状态更新时通知用户',
    subject: '{{siteTitle}} 工单状态已更新',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">工单状态已更新</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'ticketTitle', 'statusLabel'],
  },
  ticket_admin_new: {
    label: '新工单提醒',
    description: '用户创建工单时通知管理员',
    subject: '{{siteTitle}} 有新的工单需要处理',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的工单需要处理</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录后台查看并处理。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'ticketTitle'],
  },
  ticket_admin_replied: {
    label: '工单用户回复提醒',
    description: '用户回复工单时通知管理员',
    subject: '{{siteTitle}} 工单有新的用户回复',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'ticketTitle', 'replyPreview'],
  },
  inquiry_replied: {
    label: '询价回复通知',
    description: '管理员回复询价时通知用户',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 有新回复',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新回复</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'inquiryNo', 'replyPreview'],
  },
  inquiry_admin_new: {
    label: '新询价提醒',
    description: '用户提交询价时通知管理员',
    subject: '{{siteTitle}} 有新的询价单 {{inquiryNo}}',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的询价单</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">产品数量：<strong>{{itemCount}}</strong></p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'inquiryNo', 'itemCount'],
  },
  inquiry_admin_replied: {
    label: '询价用户回复提醒',
    description: '用户回复询价时通知管理员',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 有新的用户回复',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'username', 'inquiryNo', 'replyPreview'],
  },
  inquiry_assigned: {
    label: '询价转交通知',
    description: '询价转交销售时通知用户或销售',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 已转交处理',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已转交处理</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">对接人：<strong>{{assigneeName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'inquiryNo', 'assigneeName'],
  },
  favorite_notice: {
    label: '模型收藏提醒',
    description: '模型被收藏时通知上传者',
    subject: '{{siteTitle}} 您的模型被收藏',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被收藏</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看模型详情。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'modelName'],
  },
  model_conversion_completed: {
    label: '模型转换完成',
    description: '模型转换成功后通知上传者',
    subject: '{{siteTitle}} 模型转换完成',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">模型转换完成</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">现在可以预览和下载。</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'modelName'],
  },
  model_conversion_failed: {
    label: '模型转换失败',
    description: '模型转换失败后通知上传者',
    subject: '{{siteTitle}} 模型转换失败',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;color:#dc2626;">模型转换失败</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">失败原因：{{errorMessage}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'modelName', 'errorMessage'],
  },
  backup_policy_alert: {
    label: '备份体检提醒',
    description: '备份体检发现风险时通知管理员',
    subject: '{{siteTitle}} 备份体检需要关注',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">备份体检需要关注</h2>
  <p style="margin:0 0 10px;">风险等级：<strong>{{riskLevel}}</strong></p>
  <p style="margin:0 0 10px;">{{summary}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'riskLevel', 'summary'],
  },
  download_notice: {
    label: '模型下载提醒',
    description: '模型被下载时通知上传者',
    subject: '{{siteTitle}} 您的模型被下载',
    html: `
${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被下载</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">下载格式：{{downloadFormat}}</p>
${emailShellEnd}`.trim(),
    tokens: [...commonTokens, 'modelName', 'downloadFormat'],
  },
};

export function parseEmailTemplates(value: unknown): EmailTemplateMap {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return DEFAULT_EMAIL_TEMPLATES;
  }
  const custom = parsed as Record<string, Partial<EmailTemplate>>;
  const merged: EmailTemplateMap = {};
  for (const [key, fallback] of Object.entries(DEFAULT_EMAIL_TEMPLATES)) {
    const item = custom[key] || {};
    const legacyHtml =
      typeof item.html === 'string' && !item.html.includes('{{siteLogo}}') && !item.html.includes('siteLogo');
    const itemTokens = Array.isArray(item.tokens) ? item.tokens : [];
    merged[key] = {
      ...fallback,
      ...item,
      html: withActionLinks(legacyHtml ? fallback.html : (item.html ?? fallback.html)),
      tokens: Array.from(new Set([...fallback.tokens, ...itemTokens])),
    };
  }
  return merged;
}
