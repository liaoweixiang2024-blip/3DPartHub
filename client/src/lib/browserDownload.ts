function isIosLikeDevice() {
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return Boolean(
    standaloneNavigator.standalone ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches,
  );
}

function shouldIsolateDownloadNavigation() {
  return isIosLikeDevice() && isStandaloneApp();
}

export function triggerBrowserDownload(href: string, fileName = '') {
  if (!href) return;

  if (shouldIsolateDownloadNavigation() && !href.startsWith('blob:')) {
    const iframe = document.createElement('iframe');
    iframe.name = `download-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.inset = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.visibility = 'hidden';
    iframe.src = href;
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 60_000);
    return;
  }

  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
