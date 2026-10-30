type FsDoc = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/**
 * The fullscreen key: a plain F (no Ctrl / Cmd / Alt, not held down). The caller only listens for it where nothing
 * is being typed (not on the Match screen, where F is a letter).
 */
export const isFullscreenKey = (e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>) =>
  (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;

/**
 * Fullscreen API on the whole page: hides the browser's URL bar, tabs and toolbars (Esc exits).
 * Must be called from a user gesture. Resolves to an error message if the browser refuses.
 */
export async function toggleFullscreen(): Promise<string | null> {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  try {
    if (isFullscreen()) {
      await (document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.());
      return null;
    }
    if (!(document.fullscreenEnabled || d.webkitFullscreenEnabled)) {
      return 'Fullscreen blocked here (embedded browser / iframe?). Open the URL directly in Chrome or Safari.';
    }
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return 'Fullscreen API not available in this browser.';
    return null;
  } catch (err) {
    return `Fullscreen refused: ${(err as Error)?.message ?? err}`;
  }
}

export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}
