package dev.checklist.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.JavascriptInterface;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The Android implementation of the same three methods every other adapter
 * implements: list, read, write. Everything above this class is the shared
 * TypeScript core, unchanged — src/adapters/android-folder.ts is the other side.
 *
 * These methods are called from JavaScript and run on WebView's binder thread,
 * never the UI thread, so blocking file I/O here is correct rather than merely
 * tolerated.
 */
public class FolderBridge {

    /**
     * Only the app's own files are ever touched, whatever else is in the folder.
     * This is the same name `src/core/op-log.ts` spells, and the id is always 8
     * hex characters because a device is never identified by a name its owner
     * typed — two devices called "phone" would then share one path.
     */
    private static final String NAME_PATTERN = "checklist\\.[0-9a-f]{8}\\.ops\\.jsonl";

    /**
     * No registered type maps to .jsonl, and a provider is entitled to append an
     * extension matching whatever type it is given. Octet-stream is the one that
     * leaves the name alone; the write path checks anyway.
     */
    private static final String MIME = "application/octet-stream";

    private final Context context;
    private final FolderStore store;
    private final Runnable pickFolder;

    FolderBridge(Context context, FolderStore store, Runnable pickFolder) {
        this.context = context.getApplicationContext();
        this.store = store;
        this.pickFolder = pickFolder;
    }

    private DocumentFile dir() {
        Uri uri = store.getFolderUri();
        if (uri == null) return null;
        DocumentFile dir = DocumentFile.fromTreeUri(context, uri);
        return dir != null && dir.canRead() ? dir : null;
    }

    @JavascriptInterface
    public boolean hasFolder() {
        return dir() != null;
    }

    /** The folder's own name — code-standard.md §1 forbids showing a built path. */
    @JavascriptInterface
    public String folderName() {
        DocumentFile dir = dir();
        return dir == null ? "" : String.valueOf(dir.getName());
    }

    @JavascriptInterface
    public void pickFolder() {
        pickFolder.run();
    }

    @JavascriptInterface
    public String list() {
        JSONArray out = new JSONArray();
        DocumentFile dir = dir();
        if (dir != null) {
            for (DocumentFile f : dir.listFiles()) {
                String name = f.getName();
                if (name != null && name.matches(NAME_PATTERN)) out.put(name);
            }
        }
        return out.toString();
    }

    /** @return the file's contents, or null when it does not exist yet. */
    @JavascriptInterface
    public String read(String name) {
        if (!name.matches(NAME_PATTERN)) return null;
        DocumentFile dir = dir();
        if (dir == null) return null;
        DocumentFile file = dir.findFile(name);
        if (file == null || !file.isFile()) return null;

        try (InputStream in = context.getContentResolver().openInputStream(file.getUri())) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            return buf.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            // A file mid-download from the provider's client reads as an error.
            // Skipping it costs one cycle and the next poll takes it whole — S-7.
            return null;
        }
    }

    /** @return an empty string on success, or a message the page can show. */
    @JavascriptInterface
    public String write(String name, String content) {
        if (!name.matches(NAME_PATTERN)) return "refused: " + name;
        DocumentFile dir = dir();
        if (dir == null) return "no folder granted";

        try {
            DocumentFile file = dir.findFile(name);
            if (file == null) {
                file = dir.createFile(MIME, name);
                if (file == null) return "could not create " + name;
                // Providers differ on what they do to a display name, so correct
                // it rather than trusting it: a file under the wrong name is a
                // device writing a path that is not its own, which breaks S-3.
                if (!name.equals(file.getName())) {
                    file.renameTo(name);
                    file = dir.findFile(name);
                    if (file == null) return "could not name " + name;
                }
            }
            // "wt" truncates. Without the t, a shorter write leaves the tail of
            // the previous one behind — which S-14's compaction now makes a
            // routine case rather than a rare one, since a compacted file is
            // deliberately smaller than the one it replaces.
            try (OutputStream out = context.getContentResolver().openOutputStream(file.getUri(), "wt")) {
                if (out == null) return "could not open " + name;
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            return "";
        } catch (Exception e) {
            return String.valueOf(e.getMessage());
        }
    }
}
