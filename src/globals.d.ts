// The two host objects the DOM library does not describe.
//
// Both are real capabilities of a real target — the File System Access
// permission model on Chromium, and the Java bridge the Android shell injects —
// and neither is optional to the design, so they are declared rather than cast
// away at the call site.

import type { AndroidBridge } from './adapters/android-folder';

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<'granted' | 'denied' | 'prompt'>;
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<'granted' | 'denied' | 'prompt'>;
  }

  /** The async iterators the DOM library still omits from the directory handle. */
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  interface DirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string | FileSystemHandle;
  }

  function showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;

  /** Injected by `MainActivity` — architecture.md §7.2. Absent everywhere else. */
  var AndroidFolder: AndroidBridge | undefined;
}

export {};
