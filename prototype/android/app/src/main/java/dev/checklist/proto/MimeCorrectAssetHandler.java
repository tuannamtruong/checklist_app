package dev.checklist.proto;

import android.content.Context;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

/**
 * Serves bundled assets with a content type the browser will accept.
 *
 * The stock AssetsPathHandler guesses the type from the file extension, and it
 * does not know ".mjs". A module script served as anything but a JavaScript MIME
 * type is refused outright — strict checking, no fallback — so the whole app
 * would fail to boot with nothing but a console message to show for it. The
 * shared core keeps its .mjs extension for Node's benefit, so the fix belongs
 * here.
 */
class MimeCorrectAssetHandler implements WebViewAssetLoader.PathHandler {

    private final WebViewAssetLoader.AssetsPathHandler delegate;

    MimeCorrectAssetHandler(Context context) {
        this.delegate = new WebViewAssetLoader.AssetsPathHandler(context);
    }

    private static String mimeFor(String path) {
        if (path.endsWith(".mjs") || path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return null;
    }

    @Override
    public WebResourceResponse handle(String path) {
        WebResourceResponse response = delegate.handle(path);
        if (response == null) return null;

        String mime = mimeFor(path);
        if (mime == null || response.getData() == null) return response;

        // The three-argument form implies 200 OK, which is what the delegate
        // gives us anyway for an asset it managed to open.
        return new WebResourceResponse(mime, "utf-8", response.getData());
    }
}
