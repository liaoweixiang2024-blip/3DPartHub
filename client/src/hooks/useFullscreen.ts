import { useCallback, useEffect, useState } from 'react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getNativeFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

async function callFullscreenAction(action?: () => Promise<void> | void): Promise<boolean> {
  if (!action) return false;
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

export function useFullscreen(extraActive = false) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isNativeFullscreenActive = useCallback(() => Boolean(getNativeFullscreenElement()), []);

  const exitFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument;
    return callFullscreenAction((document.exitFullscreen || doc.webkitExitFullscreen)?.bind(document));
  }, []);

  const requestFullscreen = useCallback(async (element: HTMLElement) => {
    const target = element as FullscreenElement;
    return callFullscreenAction((element.requestFullscreen || target.webkitRequestFullscreen)?.bind(element));
  }, []);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(getNativeFullscreenElement()) || extraActive);
    };

    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
    };
  }, [extraActive]);

  return {
    exitFullscreen,
    isFullscreen,
    isNativeFullscreenActive,
    requestFullscreen,
  };
}
