import { Request, Response, NextFunction } from "express";
import { getSetting } from "../lib/settings.js";
import { isRefererAllowed } from "../lib/ipMatch.js";

// Cache settings for 60 seconds
let cachedAntiProxyEnabled = false;
let cachedAllowedHosts: string[] = [];
let cachedHotlinkEnabled = false;
let cachedAllowedDomains: string[] = [];
let cachedAt = 0;
const CACHE_TTL = 60_000;

async function refreshCache() {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL) return;

  const [antiProxy, allowedHosts, hotlinkEnabled, allowedDomains] = await Promise.all([
    getSetting<boolean>("anti_proxy_enabled"),
    getSetting<string>("allowed_hosts"),
    getSetting<boolean>("hotlink_protection_enabled"),
    getSetting<string>("allowed_referers"),
  ]);

  cachedAntiProxyEnabled = !!antiProxy;
  cachedAllowedHosts = typeof allowedHosts === "string"
    ? allowedHosts.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  cachedHotlinkEnabled = !!hotlinkEnabled;
  cachedAllowedDomains = typeof allowedDomains === "string"
    ? allowedDomains.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) : [];
  cachedAt = now;
}

/** Match host against allowed list (exact or subdomain) */
function isHostAllowed(host: string | undefined, allowed: string[]): boolean {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase(); // strip port
  return allowed.some(a => h === a || h.endsWith(`.${a}`));
}

const PROXY_WARNING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安全警告</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
  .card{text-align:center;padding:3rem;border-radius:1rem;background:#16213e;border:1px solid rgba(255,100,100,.2);max-width:480px}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{font-size:1.25rem;margin:0 0 .75rem;color:#ff6b6b}
  p{font-size:.875rem;color:#a0a0b0;margin:.5rem 0;line-height:1.6}
  .warn{background:rgba(255,100,100,.1);border:1px solid rgba(255,100,100,.15);border-radius:.5rem;padding:1rem;margin-top:1rem;text-align:left;font-size:.8rem;color:#c0a0a0}
</style>
</head>
<body><div class="card">
  <div class="icon">&#9888;&#65039;</div>
  <h1>检测到未授权访问</h1>
  <p>该站点正通过未授权的域名提供服务。</p>
  <p>这可能意味着有人在进行恶意反向代理。</p>
  <div class="warn">
    <p>如果您是管理员，请在后台「安全防护」设置中添加当前域名到授权列表，或关闭反向代理防护。</p>
    <p>如果您是普通用户，请通过官方域名访问本站。</p>
  </div>
</div></body>
</html>`;

const HOTLINK_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>盗链拦截</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
  .card{text-align:center;padding:3rem;border-radius:1rem;background:#16213e;border:1px solid rgba(255,255,255,.08);max-width:420px}
  h1{font-size:1.5rem;margin:0 0 .5rem}
  p{font-size:.875rem;color:#a0a0b0;margin:.5rem 0}
</style>
</head>
<body><div class="card">
  <h1>资源引用受限</h1>
  <p>检测到未经授权的外部引用（盗链）。</p>
  <p>请直接访问本站获取资源。</p>
</div></body>
</html>`;

export async function ipGuard(req: Request, res: Response, next: NextFunction) {
  try {
    await refreshCache();

    // 1. Anti-reverse-proxy: check Host header against allowed domains
    if (cachedAntiProxyEnabled && cachedAllowedHosts.length > 0) {
      const host = req.headers.host;

      if (!isHostAllowed(host, cachedAllowedHosts)) {
        // Always allow admin settings API so admin can fix config
        const path = req.path;
        if (path.startsWith("/api/settings") || path.startsWith("/api/health")) {
          next();
          return;
        }

        // API requests get JSON
        if (req.path.startsWith("/api/")) {
          res.status(403).json({
            success: false,
            message: "访问被拒绝：检测到未授权的域名访问",
            detail: "UNAUTHORIZED_HOST",
          });
          return;
        }

        // Browser requests get warning page
        res.status(403).send(PROXY_WARNING_HTML);
        return;
      }
    }

    // 2. Hotlink/referer protection (static assets only)
    if (cachedHotlinkEnabled && cachedAllowedDomains.length > 0) {
      const isStaticAsset = req.path.startsWith("/static/");
      if (isStaticAsset) {
        const referer = req.headers.referer;
        if (referer && !isRefererAllowed(referer, cachedAllowedDomains)) {
          const host = req.headers.host;
          try { if (host && new URL(referer).host === host) { next(); return; } } catch {}

          const blockedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".step", ".stp", ".stl", ".obj", ".glb", ".gltf"];
          const path = req.path.toLowerCase();
          if (blockedExts.some(ext => path.endsWith(ext))) {
            if (req.accepts("json") && !req.accepts("html")) {
              res.status(403).json({ success: false, message: "资源引用受限：检测到盗链", detail: "HOTLINK_DENIED" });
            } else {
              res.status(403).send(HOTLINK_HTML);
            }
            return;
          }
        }
      }
    }

    next();
  } catch {
    next();
  }
}
