type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
};

let scheduled = false;

export function scheduleSentryInit() {
  if (scheduled || !import.meta.env.VITE_SENTRY_DSN || typeof window === 'undefined') return;
  scheduled = true;

  const init = () => {
    void import('./sentry')
      .then(({ initSentry }) => initSentry())
      .catch(() => {
        scheduled = false;
      });
  };

  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(init, { timeout: 3000 });
    return;
  }

  window.setTimeout(init, 2500);
}
