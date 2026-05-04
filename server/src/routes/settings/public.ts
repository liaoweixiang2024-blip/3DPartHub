import { Router, Response } from 'express';
import { cacheGetOrSet, TTL } from '../../lib/cache.js';
import { getMaintenanceStatus } from '../../lib/maintenance.js';
import { getAllSettings } from '../../lib/settings.js';
import { getLocalVersion } from '../../lib/update.js';

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
      const { value: result, hit } = await cacheGetOrSet<Record<string, unknown>>(
        'cache:settings:public',
        TTL.SETTINGS_PUBLIC,
        async () => {
          const all = await getAllSettings();
          return {
            allow_register: all.allow_register ?? true,
            require_login_download: all.require_login_download ?? false,
            require_login_browse: all.require_login_browse ?? false,
            show_watermark: all.show_watermark ?? false,
            watermark_text: all.watermark_text ?? '3DPartHub',
            watermark_image: all.watermark_image ?? '',
            site_title: all.site_title ?? '3DPartHub',
            site_browser_title: all.site_browser_title ?? '',
            site_logo: all.site_logo ?? '',
            site_icon: all.site_icon ?? '',
            site_favicon: all.site_favicon ?? '/favicon.svg',
            site_logo_display: all.site_logo_display ?? 'logo_and_title',
            site_description: all.site_description ?? '',
            site_keywords: all.site_keywords ?? '',
            contact_email: all.contact_email ?? '',
            contact_phone: all.contact_phone ?? '',
            contact_address: all.contact_address ?? '',
            footer_links: all.footer_links ?? '',
            footer_copyright: all.footer_copyright ?? '',
            legal_privacy_updated_at: all.legal_privacy_updated_at ?? '2026 年 4 月',
            legal_terms_updated_at: all.legal_terms_updated_at ?? '2026 年 4 月',
            legal_privacy_sections: all.legal_privacy_sections ?? '',
            legal_terms_sections: all.legal_terms_sections ?? '',
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
            share_enabled: all.share_enabled ?? true,
            share_default_expire_days: all.share_default_expire_days ?? 0,
            share_max_expire_days: all.share_max_expire_days ?? 0,
            share_default_download_limit: all.share_default_download_limit ?? 0,
            share_max_download_limit: all.share_max_download_limit ?? 0,
            share_allow_password: all.share_allow_password ?? true,
            share_allow_custom_expiry: all.share_allow_custom_expiry ?? true,
            share_allow_preview: all.share_allow_preview ?? true,
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
              'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,xt,binary',
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
        require_login_download: false,
        require_login_browse: false,
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

  // Public: maintenance status for front-end route guard.
  router.get('/api/settings/maintenance-status', async (_req, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json(await getMaintenanceStatus());
  });

  return router;
}
