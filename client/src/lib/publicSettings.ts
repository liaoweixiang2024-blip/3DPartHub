import { getPublicSettings, type SystemSettings } from "../api/settings";

let cache: Partial<SystemSettings> | null = null;
let fetchedAt = 0;
const STORAGE_KEY = "site_config_cache";
const TTL = 5 * 60 * 1000; // 5 minutes

function loadFromStorage(): { data: Partial<SystemSettings>; ts: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveToStorage(data: Partial<SystemSettings>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

// Sync listeners for site title/logo changes
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSiteConfigChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearCache() {
  cache = null;
  fetchedAt = 0;
  // Notify all listeners so React components re-render
  listeners.forEach(fn => fn());
}

// Refresh config: clear, re-fetch, apply meta/favicon, then notify listeners
export async function refreshSiteConfig() {
  cache = null;
  fetchedAt = 0;
  try {
    cache = await getPublicSettings();
    fetchedAt = Date.now();
    saveToStorage(cache);
    applyMetaTags();
    applyFavicon();
  } catch {}
  // Notify all listeners with fresh cache populated
  listeners.forEach(fn => fn());
}

export async function getCachedPublicSettings(): Promise<Partial<SystemSettings>> {
  const now = Date.now();
  if (cache && now - fetchedAt < TTL) return cache;

  // Try localStorage first for instant hydration
  if (!cache) {
    const stored = loadFromStorage();
    if (stored && now - stored.ts < TTL) {
      cache = stored.data;
      fetchedAt = stored.ts;
      // Notify listeners so components can render with cached values immediately
      listeners.forEach(fn => fn());
    }
  }

  try {
    cache = await getPublicSettings();
    fetchedAt = now;
    saveToStorage(cache);
    applyMetaTags();
    applyFavicon();
    // Notify listeners with fresh API data
    listeners.forEach(fn => fn());
    return cache;
  } catch {
    return cache || { show_watermark: false, watermark_image: "", site_title: "", site_logo: "" };
  }
}

// Synchronous getter for already-fetched settings
export function getPublicSettingsSnapshot(): Partial<SystemSettings> {
  return cache || { show_watermark: false, watermark_image: "", site_title: "", site_logo: "" };
}

// Get site title (sync, with fallback) — used in nav bar, login page
export function getSiteTitle(): string {
  return (cache?.site_title as string) || "3DPartHub";
}

// Get browser title (sync) — used in document.title / browser tab
// Falls back to site_title if not set
export function getBrowserTitle(): string {
  const bt = cache?.site_browser_title as string;
  return bt || getSiteTitle();
}

// Get site logo URL (sync, empty string = no custom logo)
export function getSiteLogo(): string {
  return (cache?.site_logo as string) || "";
}

// Get site icon URL (sync, square icon for logo+title mode)
export function getSiteIcon(): string {
  return (cache?.site_icon as string) || "";
}

// Get logo display mode: 'logo_and_title' | 'logo_only' | 'title_only'
export function getLogoDisplayMode(): string {
  return (cache?.site_logo_display as string) || "logo_and_title";
}

// Get site favicon URL (sync, empty string = no custom favicon)
export function getSiteFavicon(): string {
  return (cache?.site_favicon as string) || "";
}

// Get announcement config (sync)
export function getAnnouncement(): { enabled: boolean; text: string; type: string; color: string } {
  return {
    enabled: (cache?.announcement_enabled as boolean) || false,
    text: (cache?.announcement_text as string) || "",
    type: (cache?.announcement_type as string) || "info",
    color: (cache?.announcement_color as string) || "",
  };
}

// Get contact email (sync)
export function getContactEmail(): string {
  return (cache?.contact_email as string) || "";
}

// Get footer links (sync) — JSON string or empty
export function getFooterLinks(): { label: string; url: string }[] {
  try {
    const raw = (cache?.footer_links as string) || "";
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

// Get footer copyright text (sync)
export function getFooterCopyright(): string {
  return (cache?.footer_copyright as string) || "";
}

// Apply dynamic meta tags (description, keywords, og:title, og:description)
function applyMetaTags() {
  if (!cache) return;
  const desc = (cache.site_description as string) || "";
  const keywords = (cache.site_keywords as string) || "";
  const title = getSiteTitle();

  // Update <meta name="description">
  let metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", desc);
  // Update <meta name="keywords">
  if (keywords) {
    let metaKeywords = document.querySelector('meta[name="keywords"]');
    if (!metaKeywords) {
      metaKeywords = document.createElement("meta");
      metaKeywords.setAttribute("name", "keywords");
      document.head.appendChild(metaKeywords);
    }
    metaKeywords.setAttribute("content", keywords);
  }
  // Update og:title
  let ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", title);
  // Update og:description
  let ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", desc);
}

// Apply dynamic favicon
function applyFavicon() {
  if (!cache) return;
  const favicon = getSiteFavicon();
  if (!favicon) return;

  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  // Determine type from extension
  if (favicon.endsWith(".svg")) link.type = "image/svg+xml";
  else if (favicon.endsWith(".ico")) link.type = "image/x-icon";
  else if (favicon.endsWith(".png")) link.type = "image/png";
  else if (favicon.endsWith(".jpg") || favicon.endsWith(".jpeg")) link.type = "image/jpeg";
  link.href = favicon + (favicon.includes('?') ? '&' : '?') + '_t=' + Date.now();
}
