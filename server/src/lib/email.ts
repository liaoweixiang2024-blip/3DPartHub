import nodemailer from "nodemailer";

const smtpConfig = {
  host: process.env.SMTP_HOST || "smtp.qq.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(smtpConfig);
  }
  return transporter;
}

export async function sendVerifyCode(toEmail: string, code: string): Promise<void> {
  const user = process.env.SMTP_USER;
  if (!user || !process.env.SMTP_PASS) {
    throw new Error("SMTP 未配置，无法发送邮件");
  }

  const transport = getTransporter();
  await transport.sendMail({
    from: `"3DPartHub" <${user}>`,
    to: toEmail,
    subject: "注册验证码 — 3DPartHub",
    html: `
      <div style="max-width:400px;margin:0 auto;padding:24px;font-family:sans-serif;">
        <h2 style="color:#f97316;margin-bottom:16px;">3DPartHub</h2>
        <p style="color:#333;font-size:15px;">您的注册验证码为：</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#f97316;padding:16px 0;text-align:center;">
          ${code}
        </div>
        <p style="color:#999;font-size:13px;">验证码 10 分钟内有效，请勿泄露给他人。</p>
      </div>
    `,
  });
}
