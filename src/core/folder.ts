// The only route from the logic layer to storage — architecture.md §4.
//
// Four methods, and a fifth is never added: a method that solves one adapter's
// problem breaks the other five. `read` of an absent name answers null rather
// than throwing, because an absent file is the normal state of a folder a peer
// has not written to yet.
//
// A name under `pictures/` is a picture (P-1 to P-8): its content is a `Blob`
// both ways, and it is the only kind of name `remove` accepts. Every other
// name is a log, and a log is a string that is rewritten and never removed.

export interface FolderAdapter {
  /** Every file the app may use, a picture spelled `pictures/<name>`. */
  list(): Promise<string[]>;
  read(name: string): Promise<string | Blob | null>;
  write(name: string, content: string | Blob): Promise<void>;
  /** A picture only — see `refuseUnlessPicture`. Removing an absent one is not an error. */
  remove(name: string): Promise<void>;
}

export const PICTURES = 'pictures/';

export function isPictureName(name: string): boolean {
  return name.startsWith(PICTURES);
}

/**
 * P-8. Called by every adapter's `remove` before it touches anything: a remove
 * that could reach a log would undo one writer per file (S-3) outright, so the
 * refusal is the adapter's and not only its one caller's.
 */
export function refuseUnlessPicture(name: string): void {
  if (!isPictureName(name)) throw new Error(`folder: refused to remove ${name}: not a picture`);
}

/** A log's text. A log is always a string, so anything else is a file that is not one. */
export async function readLog(folder: FolderAdapter, name: string): Promise<string | null> {
  const content = await folder.read(name);
  return typeof content === 'string' ? content : null;
}
