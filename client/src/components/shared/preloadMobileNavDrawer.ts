type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
};

let drawerModulePromise: Promise<typeof import('./MobileNavDrawer')> | null = null;
let drawerPreloadScheduled = false;

export function loadMobileNavDrawer() {
  if (!drawerModulePromise) {
    drawerModulePromise = import('./MobileNavDrawer').catch((error) => {
      drawerModulePromise = null;
      throw error;
    });
  }

  return drawerModulePromise;
}

export function scheduleMobileNavDrawerPreload() {
  if (drawerModulePromise || drawerPreloadScheduled || typeof window === 'undefined') return;
  drawerPreloadScheduled = true;

  const preload = () => {
    drawerPreloadScheduled = false;
    void loadMobileNavDrawer();
  };

  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(preload, { timeout: 1800 });
    return;
  }

  window.setTimeout(preload, 650);
}
