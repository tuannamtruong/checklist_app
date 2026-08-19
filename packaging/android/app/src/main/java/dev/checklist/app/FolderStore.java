package dev.checklist.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.content.UriPermission;

/**
 * Remembers which folder the user granted, across restarts.
 *
 * A plain SAF grant dies with the process. Taking it *persistably* is what
 * makes "start the app" mean start the app rather than pick the folder again
 * every single time — architecture.md §7.2.
 */
class FolderStore {

    private static final String PREFS = "checklist";
    private static final String KEY_URI = "folderUri";

    private final Context context;

    FolderStore(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    Uri getFolderUri() {
        String saved = prefs().getString(KEY_URI, null);
        if (saved == null) return null;
        Uri uri = Uri.parse(saved);
        // The grant can be revoked from system settings, or lost when the
        // folder goes. Trust the permission list, not our own record of it.
        for (UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isReadPermission() && p.isWritePermission()) return uri;
        }
        return null;
    }

    void remember(Uri uri) {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        context.getContentResolver().takePersistableUriPermission(uri, flags);
        prefs().edit().putString(KEY_URI, uri.toString()).apply();
    }
}
