// Web links (wiki pages, tarkov.dev, map authors) open in the player's own
// browser. Inside the app window a plain <a target="_blank"> does nothing, so
// one document-level click handler hands every external link to the Rust side
// (src-tauri/src/weblinks.rs).
import { invoke } from '@tauri-apps/api/core';

const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function isWebLink(href: string | null | undefined): href is string {
  return !!href && /^https?:\/\//i.test(href);
}

/** Open a web link in the default browser (a new tab outside the app). */
export async function openExternal(url: string): Promise<void> {
  if (!isWebLink(url)) return;
  if (inTauri()) {
    await invoke('open_external', { url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Route clicks on external links to the browser, app-wide. Returns the uninstaller. */
export function installExternalLinks(doc: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href');
    if (!a || !isWebLink(href)) return;
    // Same-origin links (the dev server) stay in the app.
    if (href.startsWith(window.location.origin)) return;
    e.preventDefault();
    void openExternal(href).catch((err) => console.warn('[links] could not open', href, err));
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
