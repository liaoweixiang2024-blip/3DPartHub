import { useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { localizeNavItems } from '../../../i18n/nav';
import { DEFAULT_MOBILE_NAV, getBusinessConfig } from '../../../lib/businessConfig';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';

export interface BottomNavAppearance {
  rootClassName: string;
  linkClassName: (active: boolean) => string;
  labelClassName: (active: boolean) => string;
  iconSize: number;
}

interface BottomNavRendererProps {
  appearance: BottomNavAppearance;
}

export default function BottomNavRenderer({ appearance }: BottomNavRendererProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { settings } = usePublicSettings();
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings);
  const visibleTabs = localizeNavItems(getBusinessConfig(settings).mobileNav.slice(0, 5), t, 'mobile');
  const fallbackTabs = localizeNavItems(DEFAULT_MOBILE_NAV, t, 'mobile');

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    /* 键盘态页面彻底锁死：键盘弹出期间 WebKit 允许把整个 window 拖离原点
       （html/body overflow:hidden+fixed 也拦不住），事后 scrollTo 只能拉回，
       拖动-弹回仍是可见跳动。这里不做任何区域区分——键盘开着时页面纹丝不动：
       起手点不在输入控件内的 touchmove 一律 preventDefault（包括结果列表，
       键盘开着内容也不滚）；真拖起来（>8px，排除点击抖动）立即让焦点输入框
       退出输入状态，键盘一收页面恢复正常滚动。起手点在输入控件内放行：
       输入框内拖光标/选择文本不受影响（这类触摸本来也不会带动页面） */
    let keyboardPanLock = false;
    let gestureOnInput = false;
    let gestureStartX = 0;
    let gestureStartY = 0;
    let gestureClosedKeyboard = false;
    const onTouchStart = (e: TouchEvent) => {
      gestureOnInput =
        keyboardPanLock &&
        e.target instanceof Element &&
        !!e.target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
      gestureStartX = e.touches[0]?.clientX ?? 0;
      gestureStartY = e.touches[0]?.clientY ?? 0;
      gestureClosedKeyboard = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!keyboardPanLock || gestureOnInput || e.defaultPrevented) return;
      e.preventDefault();
      if (gestureClosedKeyboard) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - gestureStartX;
      const dy = t.clientY - gestureStartY;
      /* 8px 内当点击抖动（点按钮不收键盘），拖过阈值才算真拖动 */
      if (dx * dx + dy * dy < 64) return;
      gestureClosedKeyboard = true;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    };

    const updateOffset = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--visual-viewport-bottom', `${offset}px`);
      document.documentElement.style.setProperty('--bottom-nav-offset', `${-offset}px`);
      /* 键盘弹出期间 iOS 会把 fixed 元素重定位到可视视口——拖动时导航栏会被
         拽到键盘上方飘着。键盘态（offset 超过 URL 栏级别的阈值）直接
         visibility:hidden：WebKit 再怎么重定位也画不出隐藏元素 */
      keyboardPanLock = offset > 80;
      document.documentElement.style.setProperty('--bottom-nav-visibility', keyboardPanLock ? 'hidden' : 'visible');
      if (keyboardPanLock && (window.scrollY !== 0 || window.pageXOffset !== 0)) window.scrollTo(0, 0);
    };

    updateOffset();
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);
    window.addEventListener('orientationchange', updateOffset);
    /* 键盘态 WebKit 允许拖动 window（fixed 根被整体拖起、底部导航飘到键盘上方）。
       html/body 本就 overflow:hidden+fixed、文档没有合法可滚内容——键盘开时把
       window 钉回原点。touchmove 拦截是主防线，这里是兜底 */
    window.addEventListener('scroll', updateOffset);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
      window.removeEventListener('orientationchange', updateOffset);
      window.removeEventListener('scroll', updateOffset);
      document.documentElement.style.removeProperty('--visual-viewport-bottom');
      document.documentElement.style.removeProperty('--bottom-nav-offset');
      document.documentElement.style.removeProperty('--bottom-nav-visibility');
    };
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className={appearance.rootClassName}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        bottom: 'var(--bottom-nav-offset, 0px)',
        visibility: 'var(--bottom-nav-visibility, visible)' as CSSProperties['visibility'],
      }}
    >
      {(visibleTabs.length ? visibleTabs : fallbackTabs).map((tab) => {
        const active = isActive(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            onPointerEnter={() => preloadRouteForPath(tab.path)}
            onPointerDown={() => preloadRouteForPath(tab.path)}
            onFocus={() => preloadRouteForPath(tab.path)}
            onClick={(e) => handleProtectedLinkClick(e, tab.path)}
            className={appearance.linkClassName(active)}
          >
            <Icon name={tab.icon} size={appearance.iconSize} />
            <span className={appearance.labelClassName(active)}>{tab.label}</span>
          </Link>
        );
      })}
      {authNodes}
    </nav>
  );
}
