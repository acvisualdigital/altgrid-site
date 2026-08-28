package io.altgrid.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.RequiresApi;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Capacitor Activity base that hosts all open mobile game sessions inline. Each
 * account owns a persistent AndroidX WebKit profile and a retained WebView.
 * Applying a new shell layout only changes bounds/visibility: it never reloads
 * or recreates a game.
 */
public class GameActivity extends BridgeActivity {
    private static final String TAG = "AltGridGame";
    private static final String PROFILE_PREFIX = "altgrid_account_";
    private static final int MAX_URL_LENGTH = 8_192;

    static final int OPEN_REJECTED = 0;
    static final int OPEN_EXISTING = 1;
    static final int OPEN_NEW = 2;
    static final int OPEN_PENDING = 3;

    interface Completion {
        void complete(String error);
    }

    private static final Object SESSION_LOCK = new Object();
    private static WeakReference<GameActivity> activeActivity = new WeakReference<>(null);
    private static final Map<String, List<Completion>> pendingOpenCallbacks =
        new LinkedHashMap<>();
    private static Boolean isolatedProfileSupported;

    private final Map<String, GameSession> sessions = new LinkedHashMap<>();
    private final Map<String, SessionLayout> latestLayout = new LinkedHashMap<>();
    private FrameLayout sessionStage;
    private boolean fullscreenSession = false;

    static final class SessionLayout {
        final String accountId;
        final boolean visible;
        final double x;
        final double y;
        final double width;
        final double height;

        SessionLayout(
            String accountId,
            boolean visible,
            double x,
            double y,
            double width,
            double height
        ) {
            this.accountId = accountId;
            this.visible = visible;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }
    }

    private static final class GameSession {
        final String accountId;
        final String title;
        final FrameLayout container;
        final WebView webView;
        final List<WebView> popupViews = new ArrayList<>();
        boolean documentStartViewportInstalled;
        boolean terminalStatusEmitted;
        boolean visible;
        int lastHeight = -1;
        int lastLeft = Integer.MIN_VALUE;
        int lastRendererPriority = -1;
        int lastTop = Integer.MIN_VALUE;
        int lastWidth = -1;

        GameSession(
            String accountId,
            String title,
            FrameLayout container,
            WebView webView
        ) {
            this.accountId = accountId;
            this.title = title;
            this.container = container;
            this.webView = webView;
        }
    }

    static int reserveOpen(String requestedAccountId, Completion callback) {
        synchronized (SESSION_LOCK) {
            GameActivity activity = trackedActivityLocked();
            if (activity != null && activity.hasSession(requestedAccountId)) {
                return OPEN_EXISTING;
            }

            List<Completion> callbacks = pendingOpenCallbacks.get(requestedAccountId);
            if (callbacks != null) {
                callbacks.add(callback);
                return OPEN_PENDING;
            }

            callbacks = new ArrayList<>();
            callbacks.add(callback);
            pendingOpenCallbacks.put(requestedAccountId, callbacks);
            return OPEN_NEW;
        }
    }

    static void cancelOpen(String requestedAccountId, String error) {
        List<Completion> callbacks;
        synchronized (SESSION_LOCK) {
            callbacks = pendingOpenCallbacks.remove(requestedAccountId);
        }
        completeCallbacks(callbacks, error);
    }

    static boolean open(String accountId, String title, String url) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
        }
        if (activity == null || activity.isFinishing() || activity.sessionStage == null) {
            return false;
        }
        activity.openOrFocus(accountId, title, url);
        return true;
    }

    static boolean applyLayout(List<SessionLayout> layout) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
        }
        if (activity == null || activity.isFinishing() || activity.sessionStage == null) {
            return false;
        }
        activity.applySessionLayout(layout);
        return true;
    }

    static boolean setFullscreen(boolean enabled) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
        }
        if (activity == null || activity.isFinishing()) {
            return false;
        }
        activity.fullscreenSession = enabled;
        activity.applyFullscreenInsets();
        return true;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreenSession) {
            applyFullscreenInsets();
        }
    }

    private void applyFullscreenInsets() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        if (fullscreenSession) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    public static boolean close(String requestedAccountId, Runnable completed) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
            if (activity == null) {
                List<Completion> callbacks = pendingOpenCallbacks.remove(requestedAccountId);
                completeCallbacks(callbacks, "A sessão foi fechada antes de abrir.");
                completed.run();
                return true;
            }
        }
        activity.closeSession(requestedAccountId, "command", completed);
        return true;
    }

    public static boolean reload(String requestedAccountId) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
        }
        if (activity == null || activity.isFinishing()) {
            return false;
        }
        GameSession session = activity.sessions.get(requestedAccountId);
        if (session == null) {
            return false;
        }
        session.webView.reload();
        return true;
    }

    public static void clearProfileData(
        Context context,
        String requestedAccountId,
        Completion completed
    ) {
        GameActivity activity;
        synchronized (SESSION_LOCK) {
            activity = trackedActivityLocked();
        }

        Runnable delete = () -> completed.complete(
            deleteGameProfile(context.getApplicationContext(), requestedAccountId)
        );
        if (activity == null) {
            delete.run();
            return;
        }
        activity.closeSession(requestedAccountId, "cleared", delete);
    }

    static boolean supportsIsolatedProfile() {
        synchronized (SESSION_LOCK) {
            if (isolatedProfileSupported != null) {
                return isolatedProfileSupported;
            }
        }

        boolean supported = false;
        try {
            supported = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
        } catch (LinkageError | RuntimeException error) {
            Log.w(TAG, "Android WebView multi-profile support is unavailable.", error);
        }

        synchronized (SESSION_LOCK) {
            isolatedProfileSupported = supported;
        }
        return supported;
    }

    static String isolatedProfileError() {
        return "Atualize o Android System WebView para abrir sessões com isolamento seguro.";
    }

    static boolean isAllowedUrl(String value) {
        if (value == null || value.length() > MAX_URL_LENGTH) {
            return false;
        }

        Uri uri;
        try {
            uri = Uri.parse(value);
        } catch (RuntimeException error) {
            return false;
        }

        if (uri.isOpaque()
            || uri.getUserInfo() != null
            || uri.getHost() == null
            || uri.getHost().isEmpty()) {
            return false;
        }

        String scheme = uri.getScheme();
        return "https".equalsIgnoreCase(scheme)
            || "http".equalsIgnoreCase(scheme) && isLoopback(uri.getHost());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        synchronized (SESSION_LOCK) {
            GameActivity current = trackedActivityLocked();
            if (current != null && current != this) {
                Log.w(TAG, "Replacing a stale inline session host.");
            }
            activeActivity = new WeakReference<>(this);
        }
        attachSessionStage();
    }

    @Override
    public void onDestroy() {
        boolean changingConfiguration = isChangingConfigurations();
        for (GameSession session : new ArrayList<>(sessions.values())) {
            if (!changingConfiguration) {
                emitTerminalStatus(session, "closed", "system");
            }
            destroySessionViews(session, true);
        }
        sessions.clear();
        latestLayout.clear();

        synchronized (SESSION_LOCK) {
            if (activeActivity.get() == this) {
                activeActivity.clear();
            }
        }
        super.onDestroy();
    }

    private void openOrFocus(String accountId, String title, String url) {
        GameSession existing = sessions.get(accountId);
        if (existing != null) {
            applySessionLayout(existing, latestLayout.get(accountId));
            return;
        }

        AltGridMobilePlugin.emitSessionStatus(accountId, "opening", null);
        try {
            FrameLayout container = new FrameLayout(this);
            container.setBackgroundColor(Color.rgb(8, 12, 17));

            WebView webView = new WebView(this);
            assignIsolatedProfile(webView, accountId);
            GameSession session = new GameSession(
                accountId,
                title == null ? "AltGrid" : title,
                container,
                webView
            );
            configureWebView(webView, session, false);
            session.documentStartViewportInstalled = installMobileViewportPolicy(webView);
            container.addView(webView, matchParentLayout());
            container.setVisibility(View.INVISIBLE);
            container.setClickable(false);
            sessionStage.addView(container, matchParentLayout());
            sessions.put(accountId, session);

            applySessionLayout(session, latestLayout.get(accountId));
            webView.loadUrl(url);
            completeOpen(accountId, null);
        } catch (RuntimeException error) {
            Log.e(TAG, "Unable to initialize an isolated game WebView.", error);
            GameSession failed = sessions.remove(accountId);
            if (failed != null) {
                emitTerminalStatus(failed, "crashed", "startup_failed");
                emitClosedAfterCrash(failed, "startup_failed");
                destroySessionViews(failed, true);
            } else {
                AltGridMobilePlugin.emitSessionStatus(accountId, "crashed", "startup_failed");
                AltGridMobilePlugin.emitSessionStatus(accountId, "closed", "startup_failed");
            }
            completeOpen(accountId, "Não foi possível iniciar a sessão Android com segurança.");
        }
    }

    private void closeSession(String accountId, String reason, Runnable completed) {
        GameSession session = sessions.remove(accountId);
        latestLayout.remove(accountId);
        if (session == null) {
            completed.run();
            return;
        }

        emitTerminalStatus(session, "closed", reason);
        destroySessionViews(session, true);
        completed.run();
    }

    private void attachSessionStage() {
        FrameLayout content = findViewById(android.R.id.content);
        if (content == null) {
            throw new IllegalStateException("Capacitor content view is unavailable.");
        }

        sessionStage = new FrameLayout(this);
        sessionStage.setClipChildren(true);
        sessionStage.setClipToPadding(true);
        sessionStage.setClickable(false);
        sessionStage.setFocusable(false);
        sessionStage.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        content.addView(sessionStage, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private void applySessionLayout(List<SessionLayout> layout) {
        latestLayout.clear();
        for (SessionLayout slot : layout) {
            latestLayout.put(slot.accountId, slot);
        }

        // INVISIBLE keeps each renderer, viewport and JavaScript context alive
        // while allowing the Capacitor shell to receive touches in that area.
        // Apply each final state directly: toggling every container off and on
        // for every resize causes avoidable WebView composition stalls.
        for (GameSession session : sessions.values()) {
            applySessionLayout(session, latestLayout.get(session.accountId));
        }
    }

    private void applySessionLayout(GameSession session, SessionLayout slot) {
        if (slot == null
            || !slot.visible
            || slot.width <= 0
            || slot.height <= 0
            || bridge == null
            || bridge.getWebView() == null) {
            setSessionVisible(session, false);
            return;
        }

        WebView shell = bridge.getWebView();
        float scale = shell.getScale();
        if (Float.isNaN(scale) || Float.isInfinite(scale) || scale <= 0) {
            scale = getResources().getDisplayMetrics().density;
        }

        int[] shellLocation = new int[2];
        int[] stageLocation = new int[2];
        shell.getLocationOnScreen(shellLocation);
        sessionStage.getLocationOnScreen(stageLocation);
        int shellLeft = shellLocation[0] - stageLocation[0];
        int shellTop = shellLocation[1] - stageLocation[1];
        int shellRight = shellLeft + shell.getWidth();
        int shellBottom = shellTop + shell.getHeight();

        int left = shellLeft + (int) Math.round(slot.x * scale);
        int top = shellTop + (int) Math.round(slot.y * scale);
        int right = left + (int) Math.round(slot.width * scale);
        int bottom = top + (int) Math.round(slot.height * scale);

        left = Math.max(shellLeft, Math.min(left, shellRight));
        top = Math.max(shellTop, Math.min(top, shellBottom));
        right = Math.max(shellLeft, Math.min(right, shellRight));
        bottom = Math.max(shellTop, Math.min(bottom, shellBottom));
        if (right <= left || bottom <= top) {
            setSessionVisible(session, false);
            return;
        }

        int targetWidth = right - left;
        int targetHeight = bottom - top;
        boolean boundsChanged = session.lastLeft != left
            || session.lastTop != top
            || session.lastWidth != targetWidth
            || session.lastHeight != targetHeight;

        if (boundsChanged) {
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                targetWidth,
                targetHeight
            );
            params.leftMargin = left;
            params.topMargin = top;
            session.container.setLayoutParams(params);
            session.lastLeft = left;
            session.lastTop = top;
            session.lastWidth = targetWidth;
            session.lastHeight = targetHeight;
        }

        boolean becameVisible = !session.visible;
        setSessionVisible(session, true);
        if (becameVisible) {
            session.container.bringToFront();
        }
        if (boundsChanged || becameVisible) {
            session.webView.requestLayout();
            session.webView.invalidate();
        }
    }

    private void setSessionVisible(GameSession session, boolean visible) {
        if (session.visible != visible) {
            session.visible = visible;
            session.container.setVisibility(visible ? View.VISIBLE : View.INVISIBLE);
            session.container.setClickable(visible);
            session.container.setFocusable(visible);
        }
        updateRendererPriority(session, visible);
    }

    private void updateRendererPriority(GameSession session, boolean visible) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        int priority = visible
            ? WebView.RENDERER_PRIORITY_IMPORTANT
            : WebView.RENDERER_PRIORITY_BOUND;
        if (session.lastRendererPriority == priority) {
            return;
        }
        session.lastRendererPriority = priority;
        session.webView.setRendererPriorityPolicy(priority, false);
        for (WebView popup : session.popupViews) {
            popup.setRendererPriorityPolicy(priority, false);
        }
    }

    private boolean installMobileViewportPolicy(WebView view) {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                return false;
            }
            WebViewCompat.addDocumentStartJavaScript(
                view,
                MobileViewportPolicy.documentStartScript(),
                Collections.singleton("*")
            );
            return true;
        } catch (LinkageError | RuntimeException error) {
            Log.w(TAG, "Unable to install the normalized mobile viewport.", error);
            return false;
        }
    }

    private void configureWebView(WebView view, GameSession session, boolean popup) {
        CookieManager cookies = profileCookieManager(view);
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setOffscreenPreRaster(false);
        view.setInitialScale(0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, false);
        }

        view.setBackgroundColor(Color.rgb(8, 12, 17));
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(
                WebView source,
                boolean isDialog,
                boolean isUserGesture,
                Message resultMessage
            ) {
                if (!isUserGesture || session.terminalStatusEmitted) {
                    return false;
                }
                try {
                    WebView child = new WebView(GameActivity.this);
                    assignIsolatedProfile(child, session.accountId);
                    configureWebView(child, session, true);
                    session.popupViews.add(child);
                    session.container.addView(child, matchParentLayout());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && session.visible) {
                        child.setRendererPriorityPolicy(
                            WebView.RENDERER_PRIORITY_IMPORTANT,
                            false
                        );
                    }
                    child.bringToFront();

                    WebView.WebViewTransport transport =
                        (WebView.WebViewTransport) resultMessage.obj;
                    transport.setWebView(child);
                    resultMessage.sendToTarget();
                    return true;
                } catch (RuntimeException error) {
                    Log.w(TAG, "Unable to create an isolated OAuth window.", error);
                    return false;
                }
            }

            @Override
            public void onCloseWindow(WebView window) {
                if (window != session.webView) {
                    closePopup(session, window, true);
                } else if (window.canGoBack()) {
                    window.goBack();
                }
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView current, WebResourceRequest request) {
                Uri destination = request.getUrl();
                if (isAllowedNavigation(destination)) {
                    return false;
                }
                if (request.isForMainFrame()) {
                    openExternalUri(destination, session);
                }
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView current, String destination) {
                Uri uri;
                try {
                    uri = Uri.parse(destination);
                } catch (RuntimeException error) {
                    return true;
                }
                if (isAllowedNavigation(uri)) {
                    return false;
                }
                openExternalUri(uri, session);
                return true;
            }

            @Override
            public void onPageFinished(WebView current, String url) {
                if (!popup
                    && current == session.webView
                    && !session.documentStartViewportInstalled) {
                    current.evaluateJavascript(
                        MobileViewportPolicy.documentStartScript(),
                        null
                    );
                }
                if (!popup
                    && current == session.webView
                    && !session.terminalStatusEmitted
                    && sessions.containsKey(session.accountId)) {
                    AltGridMobilePlugin.emitSessionStatus(session.accountId, "ready", null);
                }
            }

            @Override
            @RequiresApi(Build.VERSION_CODES.O)
            public boolean onRenderProcessGone(WebView current, RenderProcessGoneDetail detail) {
                if (current != session.webView) {
                    closePopup(session, current, false);
                    return true;
                }
                String reason = detail.didCrash() ? "renderer_crash" : "renderer_killed";
                emitTerminalStatus(session, "crashed", reason);
                AltGridMobilePlugin.emitSessionStatus(session.accountId, "closed", reason);
                sessions.remove(session.accountId);
                latestLayout.remove(session.accountId);
                completeOpen(
                    session.accountId,
                    "O processo gráfico da sessão Android foi encerrado."
                );
                destroySessionViews(session, false);
                return true;
            }
        });
    }

    private void closePopup(GameSession session, WebView popup, boolean stopLoading) {
        if (!session.popupViews.remove(popup)) {
            return;
        }
        detachAndDestroy(popup, stopLoading);
        if (!session.popupViews.isEmpty()) {
            session.popupViews.get(session.popupViews.size() - 1).bringToFront();
        } else {
            session.webView.bringToFront();
        }
    }

    private void openExternalUri(Uri uri, GameSession session) {
        String scheme = uri == null ? null : uri.getScheme();
        if (scheme == null
            || "http".equalsIgnoreCase(scheme)
            || "javascript".equalsIgnoreCase(scheme)
            || "file".equalsIgnoreCase(scheme)
            || "content".equalsIgnoreCase(scheme)
            || "data".equalsIgnoreCase(scheme)
            || "blob".equalsIgnoreCase(scheme)
            || "about".equalsIgnoreCase(scheme)) {
            return;
        }

        if ("intent".equalsIgnoreCase(scheme)) {
            openIntentUri(uri, session);
            return;
        }

        try {
            Intent external = new Intent(Intent.ACTION_VIEW, uri);
            external.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(external);
        } catch (ActivityNotFoundException | SecurityException ignored) {
            // Unsupported custom schemes remain blocked inside the WebView.
        }
    }

    private void openIntentUri(Uri uri, GameSession session) {
        String fallback = null;
        try {
            Intent external = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            fallback = external.getStringExtra("browser_fallback_url");
            external.setComponent(null);
            external.setSelector(null);
            external.setFlags(0);
            external.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(external);
            return;
        } catch (ActivityNotFoundException | SecurityException | java.net.URISyntaxException ignored) {
            // A sanitized HTTPS fallback may still complete the OAuth flow.
        }

        if (isAllowedUrl(fallback)) {
            session.webView.loadUrl(fallback);
        }
    }

    private void emitTerminalStatus(GameSession session, String status, String reason) {
        if (session.terminalStatusEmitted) {
            return;
        }
        session.terminalStatusEmitted = true;
        AltGridMobilePlugin.emitSessionStatus(session.accountId, status, reason);
    }

    private void emitClosedAfterCrash(GameSession session, String reason) {
        AltGridMobilePlugin.emitSessionStatus(session.accountId, "closed", reason);
    }

    private void destroySessionViews(GameSession session, boolean stopLoading) {
        for (WebView popup : new ArrayList<>(session.popupViews)) {
            detachAndDestroy(popup, stopLoading);
        }
        session.popupViews.clear();
        detachAndDestroy(session.webView, stopLoading);
        ViewParent parent = session.container.getParent();
        if (parent instanceof ViewGroup) {
            ((ViewGroup) parent).removeView(session.container);
        }
        session.container.removeAllViews();
    }

    private void detachAndDestroy(WebView view, boolean stopLoading) {
        if (view == null) {
            return;
        }
        if (stopLoading) {
            view.stopLoading();
        }
        view.setDownloadListener(null);
        view.setWebChromeClient(null);
        view.setWebViewClient(null);
        ViewParent parent = view.getParent();
        if (parent instanceof ViewGroup) {
            ((ViewGroup) parent).removeView(view);
        }
        view.removeAllViews();
        // A WebView whose renderer is gone must also be destroyed; only
        // stopLoading is skipped in that case because the renderer is unusable.
        view.destroy();
    }

    private boolean hasSession(String accountId) {
        return sessions.containsKey(accountId);
    }

    private FrameLayout.LayoutParams matchParentLayout() {
        return new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private static GameActivity trackedActivityLocked() {
        GameActivity activity = activeActivity.get();
        if (activity != null && activity.isDestroyed()) {
            activeActivity.clear();
            return null;
        }
        return activity;
    }

    private static void completeOpen(String requestedAccountId, String error) {
        List<Completion> callbacks;
        synchronized (SESSION_LOCK) {
            callbacks = pendingOpenCallbacks.remove(requestedAccountId);
        }
        completeCallbacks(callbacks, error);
    }

    private static void completeCallbacks(List<Completion> callbacks, String error) {
        if (callbacks == null) {
            return;
        }
        for (Completion callback : callbacks) {
            callback.complete(error);
        }
    }

    private static void assignIsolatedProfile(WebView target, String accountId) {
        try {
            WebViewCompat.setProfile(target, profileName(accountId));
        } catch (LinkageError | RuntimeException error) {
            throw new IllegalStateException("Unable to assign the isolated WebView profile.", error);
        }
    }

    private static CookieManager profileCookieManager(WebView target) {
        try {
            return WebViewCompat.getProfile(target).getCookieManager();
        } catch (LinkageError | RuntimeException error) {
            throw new IllegalStateException(
                "Unable to configure cookies for the isolated WebView profile.",
                error
            );
        }
    }

    private static String deleteGameProfile(Context context, String accountId) {
        if (!supportsIsolatedProfile()) {
            return isolatedProfileError();
        }
        try {
            ProfileStore.getInstance().deleteProfile(profileName(accountId));
            return null;
        } catch (LinkageError | RuntimeException error) {
            Log.e(TAG, "Unable to delete an isolated game WebView profile.", error);
            return "Não foi possível limpar os dados da sessão Android.";
        }
    }

    private static String profileName(String accountId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] value = digest.digest(accountId.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder(PROFILE_PREFIX);
            for (int index = 0; index < 16; index += 1) {
                name.append(String.format(Locale.ROOT, "%02x", value[index]));
            }
            return name.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable.", impossible);
        }
    }

    private static boolean isAllowedNavigation(Uri uri) {
        if (uri == null) {
            return false;
        }
        return isAllowedUrl(uri.toString()) || "about:blank".equalsIgnoreCase(uri.toString());
    }

    private static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host)
            || "127.0.0.1".equals(host)
            || "::1".equals(host)
            || "0:0:0:0:0:0:0:1".equals(host);
    }
}
