type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
};

let notificationPanelPromise: Promise<typeof import('./NotificationPanel')> | null = null;
let notificationPanelPreloadScheduled = false;

export function loadNotificationPanel() {
  if (!notificationPanelPromise) {
    notificationPanelPromise = import('./NotificationPanel').catch((error) => {
      notificationPanelPromise = null;
      throw error;
    });
  }

  return notificationPanelPromise;
}

export function scheduleNotificationPanelPreload() {
  if (notificationPanelPromise || notificationPanelPreloadScheduled || typeof window === 'undefined') return;
  notificationPanelPreloadScheduled = true;

  const preload = () => {
    notificationPanelPreloadScheduled = false;
    void loadNotificationPanel();
  };

  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(preload, { timeout: 2200 });
    return;
  }

  window.setTimeout(preload, 850);
}
