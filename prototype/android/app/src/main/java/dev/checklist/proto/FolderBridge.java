package dev.checklist.proto;

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
 * JavaScript core, unchanged.
 *
 * These methods are called from JavaScript and run on WebView's binder thread,
 * never the UI thread, so blocking file I/O here is correct rather than merely
 * tolerated.
 */
public class FolderBridge {

    /** Only the app's own files are ever touched, whatever else is in the folder. */
    private static final String NAME_PATTERN = "checklist\\.[A-Za-z0-9_-]{1,64}\\.json";

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
            // A file mid-download from the sync app reads as an error. Skipping
            // it costs one cycle; the next poll picks it up whole.
            return null;
        }
    }

    /** @return null on success, or a message the page can show. */
    @JavascriptInterface
    public String write(String name, String content) {
        if (!name.matches(NAME_PATTERN)) return "refused: " + name;
        DocumentFile dir = dir();
        if (dir == null) return "no folder granted";

        try {
            DocumentFile file = dir.findFile(name);
            if (file == null) {
                // Providers differ on whether they append the extension, so
                // create without it and correct the name if we have to.
                String base = name.endsWith(".json") ? name.substring(0, name.length() - 5) : name;
                file = dir.createFile("application/json", base);
                if (file == null) return "could not create " + name;
                if (!name.equals(file.getName())) {
                    file.renameTo(name);
                    file = dir.findFile(name);
                    if (file == null) return "could not name " + name;
                }
            }
            // "wt" truncates. Without the t, a shorter write leaves the tail of
            // the previous one behind and the JSON no longer parses.
            try (OutputStream out = context.getContentResolver().openOutputStream(file.getUri(), "wt")) {
                if (out == null) return "could not open " + name;
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            return null;
        } catch (Exception e) {
            return String.valueOf(e.getMessage());
        }
    }
}
