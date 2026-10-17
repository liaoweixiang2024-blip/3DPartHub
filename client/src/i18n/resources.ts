import type { Resource } from 'i18next';
import { zhCN } from './locales/zh-CN';
import { convertTranslationText, mergeTranslation, type TranslationMap } from './merge';

// 翻译资源的按需加载：默认语言 zh-CN 同步内联（零额外网络往返，覆盖绝大多数
// 访客），en-US 与繁中/日/韩/德覆盖片段动态 import——此前六种语言全部静态打进
// 入口闭包（约 -90KB gzip 的首屏负担），且没有任何页面能在渲染前绕过它。
// 每个语言一个异步 chunk，en-US 作为日/韩/德的合并基底被 Rollup 自动去重共享。

/** 当前已构建进 bundle 的语言资源（addResourceBundle 注入用） */
export type LocaleResourceEntry = { locale: string; resource: Resource };

function mergedTranslation(
  base: TranslationMap,
  fragments: {
    base: TranslationMap;
    frontOffice: TranslationMap;
    workflow: TranslationMap;
    majorForms: TranslationMap;
    media: TranslationMap;
    communication: TranslationMap;
    access: TranslationMap;
  },
): TranslationMap {
  return mergeTranslation(
    mergeTranslation(
      mergeTranslation(mergeTranslation(base, fragments.base), fragments.frontOffice),
      fragments.workflow,
    ),
    mergeTranslation(
      mergeTranslation(mergeTranslation(fragments.majorForms, fragments.media), fragments.communication),
      fragments.access,
    ),
  );
}

function importOverrideFragments(locale: 'ja-JP' | 'ko-KR' | 'de-DE') {
  switch (locale) {
    case 'ja-JP':
      return import('./locales/overrides/ja-JP');
    case 'ko-KR':
      return import('./locales/overrides/ko-KR');
    case 'de-DE':
      return import('./locales/overrides/de-DE');
  }
}

/**
 * 构建指定语言的资源包。zh-CN 永远在场（fallbackLng）；返回值只包含
 * 本次新加载的语言（调用方据此 addResourceBundle），zh 不重复注入。
 */
export async function loadLocaleResource(locale: string): Promise<Resource | null> {
  if (locale === 'zh-CN') return null;

  if (locale === 'en-US') {
    const { enUS } = await import('./locales/en-US');
    return { 'en-US': enUS };
  }

  if (locale === 'zh-TW') {
    const [{ zhTWTranslation }] = await Promise.all([import('./locales/overrides/zh-TW')]);
    return {
      'zh-TW': {
        translation: mergeTranslation(convertTranslationText(zhCN.translation as TranslationMap), zhTWTranslation),
      },
    };
  }

  if (locale === 'ja-JP' || locale === 'ko-KR' || locale === 'de-DE') {
    const [{ enUS }, { fragments }] = await Promise.all([import('./locales/en-US'), importOverrideFragments(locale)]);
    return {
      [locale]: {
        translation: mergedTranslation(enUS.translation as TranslationMap, fragments),
      },
    };
  }

  return null;
}

/** 首次 init 用的同步资源：默认语言 + fallback，保证渲染前翻译齐备 */
export function initialResources(): Resource {
  return { 'zh-CN': zhCN };
}

// ── 后台管理文案的按需加载 ──────────────────────────────────────────────────
// 15 个 admin-only 命名空间（~2100 条，语言包增量的 3/4）拆在 *-admin.ts 里，
// 仅进入 /admin/* 路由时注入（见 AdminTranslationsGate），前台访客首屏不下载。
// 全部动态 import：任何静态引用都会把 admin 包拉回公共 chunk。

/**
 * 构建指定语言的后台文案包。与 loadLocaleResource 同构：返回值只包含
 * 本次新加载的内容（调用方 addResourceBundle deep merge 进现有 translation）。
 */
export async function loadAdminLocaleResource(locale: string): Promise<Resource | null> {
  if (locale === 'zh-CN') {
    const { zhCNAdmin } = await import('./locales/zh-CN-admin');
    return { 'zh-CN': { translation: zhCNAdmin } };
  }

  if (locale === 'zh-TW') {
    const { zhCNAdmin } = await import('./locales/zh-CN-admin');
    // 繁中后台文案走简繁自动转换（与主包同路径），无独立 admin 覆盖片段
    return { 'zh-TW': { translation: convertTranslationText(zhCNAdmin) } };
  }

  if (locale === 'en-US') {
    const { enUSAdmin } = await import('./locales/en-US-admin');
    return { 'en-US': { translation: enUSAdmin } };
  }

  if (locale === 'ja-JP' || locale === 'ko-KR' || locale === 'de-DE') {
    const [{ enUSAdmin }, adminFragment] = await Promise.all([
      import('./locales/en-US-admin'),
      importAdminOverride(locale),
    ]);
    return { [locale]: { translation: mergeTranslation(enUSAdmin, adminFragment) } };
  }

  return null;
}

async function importAdminOverride(locale: 'ja-JP' | 'ko-KR' | 'de-DE'): Promise<TranslationMap> {
  switch (locale) {
    case 'ja-JP': {
      const m = await import('./locales/overrides/ja-JP-admin');
      return m.jaJPAdminTranslation;
    }
    case 'ko-KR': {
      const m = await import('./locales/overrides/ko-KR-admin');
      return m.koKRAdminTranslation;
    }
    default: {
      const m = await import('./locales/overrides/de-DE-admin');
      return m.deDEAdminTranslation;
    }
  }
}
