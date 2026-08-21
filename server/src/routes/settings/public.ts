import { Router, Response } from 'express';
import { cacheGetOrSet, TTL } from '../../lib/cache.js';
import { getMaintenanceStatus } from '../../lib/maintenance.js';
import {
  buildFooterCopyright,
  buildModelDetailCopyright,
  DEFAULT_FOOTER_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_DISCLAIMER,
  getAllSettings,
  normalizeFooterLinksSetting,
} from '../../lib/settings.js';
import { getLocalVersion } from '../../lib/update.js';

function readTtlSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(86400, Math.max(0, parsed));
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** favicon 等站点 URL 只允许站内相对路径或 http(s) 绝对地址，防注入 */
function encodeSiteHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\s"'<>]/.test(trimmed)) return '/favicon.svg';
  if (trimmed.startsWith('/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '/favicon.svg';
}

function iconTypeFor(href: string): string {
  if (href.endsWith('.ico')) return 'image/x-icon';
  if (href.endsWith('.svg')) return 'image/svg+xml';
  if (href.endsWith('.jpg') || href.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

/** 后端不可用时的兜底 head 片段（与 client/public/head-fragment-default.html 保持一致） */
const DEFAULT_HEAD_FRAGMENT =
  '<title>3DPartHub</title>\n' +
  '    <meta property="og:title" content="3DPartHub" />\n' +
  '    <meta name="description" content="" />\n' +
  '    <meta property="og:description" content="" />\n' +
  '    <meta name="apple-mobile-web-app-title" content="3DPartHub" />\n' +
  '    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=site" />\n' +
  '    <link rel="icon" type="image/svg+xml" sizes="32x32" href="/favicon.svg?v=site" />\n' +
  '    <link rel="icon" type="image/svg+xml" sizes="16x16" href="/favicon.svg?v=site" />\n' +
  '    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=site" />';

export function createSettingsPublicRouter() {
  const router = Router();

  // Public: get current version (no auth required, no network requests)
  router.get('/api/settings/version', async (_req, res: Response) => {
    try {
      const current = getLocalVersion();
      res.json({ current });
    } catch {
      res.json({ current: 'unknown' });
    }
  });

  // Public: get non-sensitive settings
  router.get('/api/settings/public', async (_req, res: Response) => {
    // Prevent browser/CDN caching of config - always revalidate
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    try {
      const settingsSnapshot = await getAllSettings();
      const ttlSeconds = readTtlSeconds(settingsSnapshot.cache_public_settings_ttl_seconds, TTL.SETTINGS_PUBLIC);
      const { value: result, hit } = await cacheGetOrSet<Record<string, unknown>>(
        'cache:settings:public',
        ttlSeconds,
        async () => {
          const all = await getAllSettings({ forceRefresh: true });
          const siteTitle = all.site_title ?? '3DPartHub';
          const footerCopyrightFollowsSiteTitle = all.footer_copyright_follow_site_title !== false;
          const modelDetailCopyrightFollowsSiteTitle = all.model_detail_copyright_follow_site_title !== false;
          return {
            allow_register: all.allow_register ?? true,
            security_username_min_length: all.security_username_min_length ?? 2,
            security_username_max_length: all.security_username_max_length ?? 32,
            require_login_download: all.require_login_download ?? false,
            require_login_browse: all.require_login_browse ?? false,
            auth_modal_enabled: all.auth_modal_enabled ?? true,
            login_dialog_enabled: all.login_dialog_enabled ?? true,
            login_dialog_favorites: all.login_dialog_favorites ?? true,
            login_dialog_downloads: all.login_dialog_downloads ?? true,
            login_dialog_my_shares: all.login_dialog_my_shares ?? true,
            login_dialog_profile: all.login_dialog_profile ?? true,
            login_dialog_support: all.login_dialog_support ?? true,
            login_dialog_my_tickets: all.login_dialog_my_tickets ?? true,
            login_dialog_my_inquiries: all.login_dialog_my_inquiries ?? true,
            login_dialog_projects: all.login_dialog_projects ?? true,
            show_watermark: all.show_watermark ?? false,
            watermark_text: all.watermark_text ?? '3DPartHub',
            watermark_image: all.watermark_image ?? '',
            site_title: all.site_title ?? '3DPartHub',
            site_browser_title: all.site_browser_title ?? '',
            site_app_name: all.site_app_name ?? '',
            site_app_icon: all.site_app_icon ?? '',
            site_app_desc: all.site_app_desc ?? '',
            site_logo: all.site_logo ?? '',
            site_icon: all.site_icon ?? '',
            site_favicon: all.site_favicon ?? '/favicon.svg',
            site_logo_display: all.site_logo_display ?? 'logo_and_title',
            site_description: all.site_description ?? '',
            site_keywords: all.site_keywords ?? '',
            contact_email: all.contact_email ?? '',
            contact_phone: all.contact_phone ?? '',
            contact_address: all.contact_address ?? '',
            footer_links: normalizeFooterLinksSetting(all.footer_links ?? ''),
            footer_copyright_follow_site_title: footerCopyrightFollowsSiteTitle,
            footer_copyright: footerCopyrightFollowsSiteTitle
              ? buildFooterCopyright(siteTitle)
              : all.footer_copyright || DEFAULT_FOOTER_COPYRIGHT,
            footer_icp_number: all.footer_icp_number ?? '',
            footer_police_number: all.footer_police_number ?? '',
            model_detail_disclaimer: all.model_detail_disclaimer ?? DEFAULT_MODEL_DETAIL_DISCLAIMER,
            model_detail_copyright_follow_site_title: modelDetailCopyrightFollowsSiteTitle,
            model_detail_copyright: modelDetailCopyrightFollowsSiteTitle
              ? buildModelDetailCopyright(siteTitle)
              : all.model_detail_copyright || DEFAULT_MODEL_DETAIL_COPYRIGHT,
            legal_privacy_updated_at: all.legal_privacy_updated_at ?? '2026 年 4 月',
            legal_terms_updated_at: all.legal_terms_updated_at ?? '2026 年 4 月',
            legal_privacy_sections: all.legal_privacy_sections ?? '',
            legal_terms_sections: all.legal_terms_sections ?? '',
            interface_theme: all.interface_theme ?? 'workbench',
            mobile_interface_theme: all.mobile_interface_theme ?? 'classic',
            user_interface_theme_enabled: all.user_interface_theme_enabled ?? true,
            home_desktop_list_loading_mode: all.home_desktop_list_loading_mode ?? 'pagination',
            home_mobile_list_loading_mode: all.home_mobile_list_loading_mode ?? 'infinite',
            ui_default_locale: all.ui_default_locale ?? 'zh-CN',
            ui_enabled_locales: all.ui_enabled_locales ?? 'zh-CN,zh-TW,en-US,ja-JP,ko-KR,de-DE',
            ui_follow_browser_locale: all.ui_follow_browser_locale ?? false,
            announcement_enabled: all.announcement_enabled ?? false,
            announcement_text: all.announcement_text ?? '',
            announcement_type: all.announcement_type ?? 'info',
            announcement_color: all.announcement_color ?? '',
            maintenance_enabled: all.maintenance_enabled ?? false,
            maintenance_auto_enabled: all.maintenance_auto_enabled ?? true,
            maintenance_auto_queue_threshold: all.maintenance_auto_queue_threshold ?? 50,
            maintenance_title: all.maintenance_title ?? '系统维护中',
            maintenance_message:
              all.maintenance_message ?? '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。',
            color_scheme: all.color_scheme ?? 'orange',
            color_custom_dark: all.color_custom_dark ?? '{}',
            color_custom_light: all.color_custom_light ?? '{}',
            default_theme: all.default_theme ?? 'light',
            auto_theme_enabled: all.auto_theme_enabled ?? false,
            auto_theme_dark_hour: all.auto_theme_dark_hour ?? 20,
            auto_theme_light_hour: all.auto_theme_light_hour ?? 8,
            // 3D Material - default
            mat_default_color: all.mat_default_color ?? '#c8cad0',
            mat_default_metalness: all.mat_default_metalness ?? 0.5,
            mat_default_roughness: all.mat_default_roughness ?? 0.25,
            mat_default_envMapIntensity: all.mat_default_envMapIntensity ?? 1.5,
            // 3D Material - original (empty = no override)
            mat_original_color: all.mat_original_color ?? '',
            mat_original_metalness: all.mat_original_metalness ?? '',
            mat_original_roughness: all.mat_original_roughness ?? '',
            mat_original_envMapIntensity: all.mat_original_envMapIntensity ?? '',
            // 3D Material - metal
            mat_metal_color: all.mat_metal_color ?? '#f0f0f4',
            mat_metal_metalness: all.mat_metal_metalness ?? 1.0,
            mat_metal_roughness: all.mat_metal_roughness ?? 0.05,
            mat_metal_envMapIntensity: all.mat_metal_envMapIntensity ?? 2.0,
            // 3D Material - plastic
            mat_plastic_color: all.mat_plastic_color ?? '#4499ff',
            mat_plastic_metalness: all.mat_plastic_metalness ?? 0.0,
            mat_plastic_roughness: all.mat_plastic_roughness ?? 0.35,
            mat_plastic_envMapIntensity: all.mat_plastic_envMapIntensity ?? 0.6,
            // 3D Material - glass
            mat_glass_color: all.mat_glass_color ?? '#ffffff',
            mat_glass_metalness: all.mat_glass_metalness ?? 0.0,
            mat_glass_roughness: all.mat_glass_roughness ?? 0.0,
            mat_glass_envMapIntensity: all.mat_glass_envMapIntensity ?? 1.0,
            mat_glass_transmission: all.mat_glass_transmission ?? 0.95,
            mat_glass_ior: all.mat_glass_ior ?? 1.5,
            mat_glass_thickness: all.mat_glass_thickness ?? 0.5,
            // 3D Viewer lighting
            viewer_exposure: all.viewer_exposure ?? 1.4,
            viewer_ambient_intensity: all.viewer_ambient_intensity ?? 1.0,
            viewer_main_light_intensity: all.viewer_main_light_intensity ?? 2.0,
            viewer_fill_light_intensity: all.viewer_fill_light_intensity ?? 0.8,
            viewer_hemisphere_intensity: all.viewer_hemisphere_intensity ?? 0.5,
            viewer_bg_color: all.viewer_bg_color ?? '#ffffff',
            viewer_default_preset: all.viewer_default_preset ?? 'default',
            viewer_visible_presets: all.viewer_visible_presets ?? 'original,default,metal,plastic,glass',
            viewer_edge_enabled: all.viewer_edge_enabled ?? true,
            viewer_edge_threshold_angle: all.viewer_edge_threshold_angle ?? 28,
            viewer_edge_vertex_limit: all.viewer_edge_vertex_limit ?? 700000,
            viewer_edge_color: all.viewer_edge_color ?? '#000000',
            viewer_edge_opacity: all.viewer_edge_opacity ?? 1.0,
            viewer_edge_width: all.viewer_edge_width ?? 1,
            viewer_measure_default_unit: all.viewer_measure_default_unit ?? 'auto',
            viewer_measure_record_limit: all.viewer_measure_record_limit ?? 12,
            // Share policy
            share_default_expire_days: all.share_default_expire_days ?? 0,
            share_max_expire_days: all.share_max_expire_days ?? 0,
            share_default_download_limit: all.share_default_download_limit ?? 0,
            share_max_download_limit: all.share_max_download_limit ?? 0,
            share_allow_password: all.share_allow_password ?? true,
            share_allow_custom_expiry: all.share_allow_custom_expiry ?? true,
            share_allow_preview: all.share_allow_preview ?? true,
            // Feature toggles
            feature_selection_enabled: all.feature_selection_enabled ?? true,
            feature_inquiry_enabled: all.feature_inquiry_enabled ?? true,
            feature_product_wall_enabled: all.feature_product_wall_enabled ?? true,
            feature_tickets_enabled: all.feature_tickets_enabled ?? true,
            feature_favorites_enabled: all.feature_favorites_enabled ?? true,
            feature_shares_enabled: all.feature_shares_enabled ?? true,
            feature_downloads_enabled: all.feature_downloads_enabled ?? true,
            feature_password_reset_enabled: all.feature_password_reset_enabled ?? true,
            feature_temp_viewer_enabled: all.feature_temp_viewer_enabled ?? true,
            require_invite_code: all.require_invite_code ?? false,
            invite_max_active_per_user: all.invite_max_active_per_user ?? 10,
            // Selection wizard
            selection_page_title: all.selection_page_title ?? '产品选型',
            selection_page_desc: all.selection_page_desc ?? '先选产品大类，再按参数逐步缩小范围',
            selection_enable_match: all.selection_enable_match ?? true,
            inquiry_statuses: all.inquiry_statuses ?? '',
            ticket_statuses: all.ticket_statuses ?? '',
            ticket_classifications: all.ticket_classifications ?? '',
            support_process_steps: all.support_process_steps ?? '',
            nav_user_items: all.nav_user_items ?? '',
            nav_admin_items: all.nav_admin_items ?? '',
            nav_items: all.nav_items ?? '',
            nav_mobile_items: all.nav_mobile_items ?? '',
            upload_policy: all.upload_policy ?? '',
            selection_thread_priority: all.selection_thread_priority ?? '',
            page_size_policy: all.page_size_policy ?? '',
            // Product wall limits
            product_wall_max_image_mb: all.product_wall_max_image_mb ?? 50,
            product_wall_max_batch_count: all.product_wall_max_batch_count ?? 50,
            product_wall_max_zip_extract: all.product_wall_max_zip_extract ?? 100,
            // Download token TTL
            download_token_ttl_minutes: all.download_token_ttl_minutes ?? 5,
            // Ticket attachment limits
            ticket_attachment_max_mb: all.ticket_attachment_max_mb ?? 100,
            ticket_attachment_types:
              all.ticket_attachment_types ??
              'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,binary',
            // API rate limiting
            api_rate_limit: all.api_rate_limit ?? 5000,
          };
        },
      );
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(result);
    } catch {
      res.json({
        allow_register: true,
        security_username_min_length: 2,
        security_username_max_length: 32,
        require_login_download: false,
        require_login_browse: false,
        auth_modal_enabled: true,
        login_dialog_enabled: true,
        user_interface_theme_enabled: true,
        home_desktop_list_loading_mode: 'pagination',
        home_mobile_list_loading_mode: 'infinite',
        ui_default_locale: 'zh-CN',
        ui_enabled_locales: 'zh-CN,zh-TW,en-US,ja-JP,ko-KR,de-DE',
        ui_follow_browser_locale: false,
        show_watermark: false,
        watermark_image: '',
        maintenance_enabled: false,
        maintenance_auto_enabled: true,
        maintenance_auto_queue_threshold: 50,
        maintenance_title: '系统维护中',
        maintenance_message: '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。',
      });
    }
  });

  // Public: <head> fragment for nginx SSI injection into index.html.
  // Returns <title> + og:title + description + favicon links so first paint (before
  // any JS runs) shows the admin-configured brand instead of build-time defaults.
  // NOTE: index.html deliberately has NO static icon links — this fragment is the
  // single source of truth for them (static fallback file mirrors it), so the
  // admin-configured favicon can't be beaten by leftover build-time declarations.
  router.get('/api/settings/head-fragment', async (_req, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    // nginx SSI 子请求不会解压响应：压缩中间件若 gzip 本片段，gzip 字节会被原样
    // 拼进 index.html，页面顶部出现乱码（框框/问号）。显式 identity 让中间件跳过压缩。
    res.set('Content-Encoding', 'none');
    try {
      const all = await getAllSettings();
      const title = String(all.site_browser_title || all.site_title || '3DPartHub');
      const desc = String(all.site_description || '');
      const icon = encodeSiteHref(String(all.site_favicon || '/favicon.svg'));
      const iconType = iconTypeFor(icon);
      // iOS 主屏图标名称：Safari 不读 webmanifest 的 name，只读这个 meta
      const appName = String(all.site_app_name || all.site_title || '3DPartHub');
      // iOS 主屏图标：Safari 不读 manifest icons，只读 apple-touch-icon
      const appIcon = encodeSiteHref(String(all.site_app_icon || '/apple-touch-icon.png'));
      const iconQuery = (href: string) => href + (href.includes('?') ? '&' : '?') + 'v=site';
      res
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(
          `<title>${escapeHtmlText(title)}</title>\n` +
            `    <meta property="og:title" content="${escapeHtmlText(title)}" />\n` +
            `    <meta name="description" content="${escapeHtmlText(desc)}" />\n` +
            `    <meta property="og:description" content="${escapeHtmlText(desc)}" />\n` +
            `    <meta name="apple-mobile-web-app-title" content="${escapeHtmlText(appName)}" />\n` +
            `    <link rel="icon" type="${iconType}" href="${iconQuery(icon)}" />\n` +
            `    <link rel="icon" type="${iconType}" sizes="32x32" href="${iconQuery(icon)}" />\n` +
            `    <link rel="icon" type="${iconType}" sizes="16x16" href="${iconQuery(icon)}" />\n` +
            `    <link rel="apple-touch-icon" sizes="180x180" href="${iconQuery(appIcon)}" />`,
        );
    } catch {
      res.set('Content-Type', 'text/html; charset=utf-8').send(DEFAULT_HEAD_FRAGMENT);
    }
  });

  // Public: dynamic PWA manifest. nginx maps /site.webmanifest -> this endpoint so
  // the "Install app" prompt uses the admin-configured app name instead of the
  // build-time default baked into client/public/site.webmanifest.
  router.get('/api/settings/site-manifest', async (req, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const all = await getAllSettings();
      const appName = String(all.site_app_name || all.site_title || '3DPartHub').trim() || '3DPartHub';
      // 应用描述：后台「应用描述」→ 站点描述 → 内置默认（Chrome 安装后的应用备注）
      const description = String(
        all.site_app_desc || all.site_description || 'Enterprise 3D Part Model Management Platform',
      ).trim();
      // Chrome/Edge 安装图标：后台设置的应用图标（推荐 ≥192px PNG），未设置用内置默认
      const appIcon = encodeSiteHref(String(all.site_app_icon || '/android-chrome-192.png'));
      const manifest = {
        name: appName,
        short_name: appName.slice(0, 12),
        description,
        start_url: '/',
        display: 'standalone',
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        icons: [
          { src: appIcon, sizes: '192x192', type: iconTypeFor(appIcon) },
          ...(appIcon === '/android-chrome-192.png'
            ? [{ src: '/favicon-512.png', sizes: '512x512', type: 'image/png' }]
            : []),
        ],
      };
      // res.json 会被全局 responseHandler 包成 {success,data} 信封，浏览器 PWA
      // 安装需要裸 manifest JSON —— 用 res.send 序列化绕过信封包装
      res.set('Content-Type', 'application/manifest+json; charset=utf-8').send(JSON.stringify(manifest));
    } catch {
      res.set('Content-Type', 'application/manifest+json; charset=utf-8').send(
        JSON.stringify({
          name: '3DPartHub',
          short_name: '3DPartHub',
          start_url: '/',
          display: 'standalone',
          icons: [
            { src: '/android-chrome-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        }),
      );
    }
  });

  // Public: maintenance status for front-end route guard.
  router.get('/api/settings/maintenance-status', async (_req, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json(await getMaintenanceStatus());
  });

  return router;
}
