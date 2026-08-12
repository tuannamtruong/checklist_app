package dev.checklist.proto;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * A WebView, a folder picker, and a bridge between them. That is the whole app.
 *
 * The page it loads is the same public/ + core/ that runs on the laptop, copied
 * into assets at build time. Only the adapter underneath differs.
 */
public class MainActivity extends Activity {

    private static final int PICK_FOLDER = 1;
    /** Reserved by androidx for exactly this: a real origin for local assets. */
    private static final String ORIGIN = "https://appassets.androidplatform.net";

    private WebView web;
    private FolderStore store;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new FolderStore(this);

        // Serving assets at "/" rather than "/assets/" keeps every path in the
        // page identical to the desktop build — /public/app.js, ../core/*.
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/", new MimeCorrectAssetHandler(this))
                .build();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // localStorage holds the device name
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        web.addJavascriptInterface(
                new FolderBridge(this, store, this::launchPicker), "AndroidFolder");

        setContentView(web);
        if (savedInstanceState == null) {
            web.loadUrl(ORIGIN + "/public/index.html");
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    private void launchPicker() {
        // Called from the bridge thread; Intents must go out from the UI thread.
        runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent, PICK_FOLDER);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FOLDER || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        store.remember(uri);
        // Simplest way to re-run the startup path now that a folder exists.
        web.loadUrl(ORIGIN + "/public/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
