package io.altgrid.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * Android WebView has one storage profile per process. Until Android supports
 * true per-account profiles here, keep exactly one game Activity alive so two
 * AltGrid accounts can never share or overwrite each other's live session.
 */
public class GameActivity extends Activity {
    public static final String EXTRA_ACCOUNT_ID = "accountId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_URL = "url";
    private static final String PREFERENCES_NAME = "altgrid_mobile_profile";
    private static final String PROFILE_OWNER = "account_id";
    private static final String PROFILE_ORIGIN = "game_origin";

    private static WeakReference<GameActivity> activeActivity = new WeakReference<>(null);

    private WebView webView;
    private String gameUrl;
    private String accountId;

    public static boolean canOpen(String requestedAccountId) {
        GameActivity activity = activeActivity.get();
        return activity == null
            || activity.isFinishing()
            || activity.isDestroyed()
            || requestedAccountId.equals(activity.accountId);
    }

    public static boolean canUseProfile(Context context, String requestedAccountId) {
        String owner = context.getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
            .getString(PROFILE_OWNER, null);
        return owner == null || requestedAccountId.equals(owner);
    }

    public static void close(String requestedAccountId) {
        GameActivity activity = activeActivity.get();
        if (activity != null && requestedAccountId.equals(activity.accountId)) {
            activity.finish();
        }
    }

    public static boolean reload(String requestedAccountId) {
        GameActivity activity = activeActivity.get();
        if (activity == null
            || activity.webView == null
            || !requestedAccountId.equals(activity.accountId)) {
            return false;
        }
        activity.webView.reload();
        return true;
    }

    public static void clearProfileData(Context context, Runnable completed) {
        GameActivity activity = activeActivity.get();
        if (activity != null && activity.webView != null) {
            activity.webView.stopLoading();
            activity.webView.clearHistory();
            activity.webView.clearFormData();
            activity.webView.clearCache(true);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(ignored -> {
            cookies.flush();
            String origin = context.getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
                .getString(PROFILE_ORIGIN, null);
            if (origin != null) {
                // Do not erase the Capacitor shell's local storage/auth state.
                WebStorage.getInstance().deleteOrigin(origin);
            }
            context.getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE).edit()
                .remove(PROFILE_OWNER)
                .remove(PROFILE_ORIGIN)
                .apply();
            if (activity != null && !activity.isFinishing()) {
                activity.finish();
            }
            completed.run();
        });
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        gameUrl = getIntent().getStringExtra(EXTRA_URL);
        accountId = getIntent().getStringExtra(EXTRA_ACCOUNT_ID);
        if (!isAllowedUrl(gameUrl)
            || accountId == null
            || accountId.isEmpty()
            || !canOpen(accountId)
            || !canUseProfile(this, accountId)) {
            finish();
            return;
        }
        getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE).edit()
            .putString(PROFILE_OWNER, accountId)
            .putString(PROFILE_ORIGIN, originFor(gameUrl))
            .apply();
        activeActivity = new WeakReference<>(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(8, 12, 17));

        LinearLayout hud = new LinearLayout(this);
        hud.setGravity(android.view.Gravity.CENTER_VERTICAL);
        hud.setPadding(20, 12, 12, 12);
        hud.setBackgroundColor(Color.rgb(16, 22, 30));

        TextView title = new TextView(this);
        title.setText(getIntent().getStringExtra(EXTRA_TITLE));
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        hud.addView(title, new LinearLayout.LayoutParams(0, 56, 1));

        Button reload = new Button(this);
        reload.setText("Recarregar");
        reload.setOnClickListener(view -> webView.reload());
        hud.addView(reload, new LinearLayout.LayoutParams(-2, 56));

        Button close = new Button(this);
        close.setText("Voltar");
        close.setOnClickListener(view -> finish());
        hud.addView(close, new LinearLayout.LayoutParams(-2, 56));
        root.addView(hud, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAllowedUrl(request.getUrl().toString());
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        webView.loadUrl(gameUrl);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String requestedAccountId = intent.getStringExtra(EXTRA_ACCOUNT_ID);
        if (requestedAccountId == null || !requestedAccountId.equals(accountId)) {
            finish();
        }
        // Focusing an existing account must not reload it or reset game UI.
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (activeActivity.get() == this) {
            activeActivity.clear();
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private static boolean isAllowedUrl(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return false;
        return "https".equalsIgnoreCase(scheme)
            || "http".equalsIgnoreCase(scheme) && isLoopback(host);
    }

    private static String originFor(String value) {
        Uri uri = Uri.parse(value);
        return uri.getScheme() + "://" + uri.getEncodedAuthority();
    }

    private static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host)
            || "127.0.0.1".equals(host)
            || "::1".equals(host);
    }
}
