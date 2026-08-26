import type { Request, Response } from 'express';
import { getSetting } from './settings.js';

/**
 * 浏览器直开资源 URL（图纸/附件/批量打包/备份下载）的令牌失败页。
 *
 * 这些端点平时由前端拿 URL 后 window.open / location 直开——浏览器发不出 Authorization 头，
 * 靠 5 分钟 download_token 做凭证。令牌过期/无效时如果返回裸 JSON（{"success":false,...}），
 * 用户在新标签页看到的就是一坨代码，非常难看。
 *
 * 这里做内容协商：浏览器导航（Accept 含 text/html）→ 渲染与站点同风格的友好 HTML 页
 * （品牌标识 + 自动关闭倒计时 + 返回站点按钮，品牌读取与 maintenance.html 一致）；
 * 编程式 API 调用（fetch/XHR，Accept: application/json）→ 仍返回 JSON。
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wantsHtml(req: Request): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
}

async function loadBranding(): Promise<{ title: string; icon: string }> {
  try {
    const [title, icon] = await Promise.all([getSetting<string>('site_title'), getSetting<string>('site_icon')]);
    return {
      title: (typeof title === 'string' && title.trim()) || '3DPartHub',
      icon: (typeof icon === 'string' && icon.trim()) || '/favicon.svg',
    };
  } catch {
    return { title: '3DPartHub', icon: '/favicon.svg' };
  }
}

const ERROR_PAGE_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #faf9f7;
    color: #1c1b1f;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    text-align: center;
    max-width: 420px;
    width: 100%;
    background: #fff;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 16px;
    padding: 48px 32px 40px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  }
  .icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 20px;
    border-radius: 50%;
    background: #fce8e6;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon svg { width: 32px; height: 32px; }
  h1 { font-size: 1.25rem; font-weight: 700; color: #1c1b1f; margin-bottom: 10px; }
  p { font-size: 0.9rem; color: #5f5f66; line-height: 1.7; margin-bottom: 8px; }
  .hint { color: #9a9aa1; font-size: 0.8rem; }
  .actions { margin-top: 28px; display: flex; gap: 12px; justify-content: center; }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 24px;
  }
  .brand-icon { width: 22px; height: 22px; object-fit: contain; }
  .brand-title { font-size: 0.95rem; font-weight: 700; color: #3c3c43; letter-spacing: -0.01em; }
  a.btn, button.btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 24px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    transition: opacity 0.2s;
  }
  a.btn:hover { opacity: 0.85; }
  button.btn { cursor: pointer; font-family: inherit; }
  a.btn-primary, button.btn-primary { background: #e8def8; color: #1d192b; }
  a.btn-ghost, button.btn-ghost { background: transparent; color: #5f5f66; border: 1px solid rgba(0,0,0,0.12); }
`;

function buildErrorPageHtml(
  title: string,
  message: string,
  hint: string | undefined,
  brand: { title: string; icon: string },
): string {
  const hintHtml = hint ? `<p class="hint">${escapeHtml(hint)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>${ERROR_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="${escapeHtml(brand.icon)}" alt="" class="brand-icon" onerror="this.style.display='none'" />
      <span class="brand-title">${escapeHtml(brand.title)}</span>
    </div>
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 7V13M12 17H12.01" stroke="#b3261e" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="12" cy="12" r="9.2" stroke="#b3261e" stroke-width="1.8"/>
      </svg>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${hintHtml}
    <div class="actions">
      <a class="btn btn-primary" href="/">返回首页</a>
      <button type="button" class="btn btn-ghost" id="closeBtn">关闭本页 <span id="countdown">(5)</span></button>
    </div>
  </div>
  <script>
    // window.close 仅对脚本打开的窗口生效：5 秒倒计时先尝试自动关，
    // 关不掉（用户手动开的标签页）就把按钮换成「返回首页」，绝不留死按钮
    var secondsLeft = 5;
    var countdownEl = document.getElementById('countdown');
    var closeBtn = document.getElementById('closeBtn');
    function tryClose() {
      window.close();
      // close() 未生效会继续执行到这里 → 本窗口不是脚本打开的
      if (countdownEl) countdownEl.parentNode.style.display = 'none';
      if (closeBtn) {
        closeBtn.textContent = '返回首页';
        closeBtn.onclick = function () { location.href = '/'; };
      }
    }
    if (closeBtn) closeBtn.onclick = function () { tryClose(); };
    var timer = setInterval(function () {
      secondsLeft -= 1;
      if (countdownEl) countdownEl.textContent = '(' + secondsLeft + ')';
      if (secondsLeft <= 0) {
        clearInterval(timer);
        tryClose();
      }
    }, 1000);
  </script>
</body>
</html>`;
}

/**
 * 统一发送「浏览器直开资源」的错误响应：
 * - 浏览器导航 → 友好 HTML 页（站点品牌标识 + 浅色卡片风格，与 maintenance.html 品牌处理一致）
 * - API 调用 → JSON（保持既有契约，前端 toast 已处理）
 */
export async function sendResourceError(
  req: Request,
  res: Response,
  status: number,
  message: string,
  options: { htmlTitle?: string; hint?: string } = {},
): Promise<void> {
  if (wantsHtml(req)) {
    const brand = await loadBranding();
    res
      .status(status)
      .type('html')
      .send(buildErrorPageHtml(options.htmlTitle ?? '链接已失效', message, options.hint, brand));
    return;
  }
  res.status(status).json({ detail: message });
}
