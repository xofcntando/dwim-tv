package tv.dwim.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * DWIM TV for Android TV, phones and tablets.
 * A full-screen WebView that opens https://dwim-tv.onrender.com in TV mode (?tv=1).
 * Remote D-pad keys go straight to the web app (arrows, OK, Back).
 * DWIM TV is designed and built in Zimbabwe by Ntandomods.
 */
public class MainActivity extends Activity {
    private static final String HOST = "dwim-tv.onrender.com";
    private static final String START_URL = "https://" + HOST + "/?tv=1";

    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#070B18"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#070B18"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // live TV must start by itself
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " DWIMTV-Android/1.0 SmartTV");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { /* no browser on this TV */ }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    v.loadDataWithBaseURL(null,
                        "<body style='background:#070b18;color:#f5f5f7;font-family:sans-serif;text-align:center;padding-top:18vh'>"
                        + "<h1 style='color:#f0d478'>DWIM TV</h1><p style='font-size:28px'>No internet connection.</p>"
                        + "<p style='font-size:22px;color:#9aa3c0'>Check your network, then press OK to try again.</p>"
                        + "<button autofocus onclick=\"location.href='" + START_URL + "'\" style='font-size:26px;padding:14px 40px;border-radius:30px;border:0;background:#d4af37'>Try again</button>"
                        + "<p style='margin-top:60px;color:#5f6890'>Built by Ntandomods, Zimbabwe</p></body>",
                        "text/html", "utf-8", null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = view; customCallback = cb;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                if (customCallback != null) customCallback.onCustomViewHidden();
                web.setVisibility(View.VISIBLE);
            }
        });

        Uri data = getIntent() != null ? getIntent().getData() : null;
        web.loadUrl(data != null && HOST.equals(data.getHost()) ? data.toString() : START_URL);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (customView != null) { web.getWebChromeClient().onHideCustomView(); return true; }
            // let the web app handle Back (closes the player, goes up a page)
            if (web.canGoBack()) { web.goBack(); return true; }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); }
}
