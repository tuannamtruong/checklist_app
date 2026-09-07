// X-25. The chosen sidebar type size, applied to the document root and
// remembered on this device — requirements.md §10.4. It is `localStorage` for
// X-14's reason exactly: the phone is read in bed and the laptop in an office,
// and a size that converged across them would be one the user has to fight on
// whichever device they are not holding.
//
// The catalog and the fallback live in `src/core/sidebar-size.ts`; this file is
// the half that is allowed to touch `window`.

import { DEFAULT_SIDEBAR_SIZE, sidebarSizeOr, type SidebarSizeId } from '../core/sidebar-size';

/** Read by the boot line in `index.html` too, which is why it is spelled twice. */
const SIDEBAR_SIZE_KEY = 'checklist.sidebarsize';

export class SidebarSize {
  current = $state<SidebarSizeId>(DEFAULT_SIDEBAR_SIZE);
  private storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.current = sidebarSizeOr(this.read());
    // The boot line has already set the attribute; this is what makes the two
    // agree when storage was unreadable or held an id this build has dropped.
    apply(this.current);
  }

  set(id: SidebarSizeId): void {
    this.current = id;
    apply(id);
    try {
      this.storage.setItem(SIDEBAR_SIZE_KEY, id);
    } catch (error) {
      // A full or blocked quota costs the choice on the next launch and nothing
      // in this session, so it is reported rather than raised at the user.
      console.warn(`sidebar size: ${id} could not be stored`, error);
    }
  }

  private read(): string | null {
    try {
      return this.storage.getItem(SIDEBAR_SIZE_KEY);
    } catch (error) {
      console.warn('sidebar size: storage unreadable, using the default', error);
      return null;
    }
  }
}

/** Sets the attribute the `[data-sidebar-size]` blocks in `app.css` key on. */
function apply(id: SidebarSizeId): void {
  document.documentElement.dataset.sidebarSize = id;
}
