// The only route from the logic layer to storage — architecture.md §4.
//
// Three methods, and a fourth is never added: a method that solves one adapter's
// problem breaks the other five. `read` of an absent name answers null rather
// than throwing, because an absent file is the normal state of a folder a peer
// has not written to yet.

export interface FolderAdapter {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
}
