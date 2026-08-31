package io.altgrid.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import java.util.List;

public class MainActivity extends GameActivity {
    private static final String AUTH_SCHEME = "altgrid";
    private static final String AUTH_HOST = "app";
    private static final String AUTH_QUERY_KEY = "auth";
    private static final String RECOVERY_QUERY_VALUE = "recovery";
    private static final String OAUTH_QUERY_VALUE = "oauth";
    private static final int MAX_AUTH_URI_LENGTH = 16_384;

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AltGridMobilePlugin.class);
        registerPlugin(AltGridMobileUpdaterPlugin.class);
        super.onCreate(state);
        handleAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAuthIntent(intent);
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        Uri authUri = intent.getData();
        if (!isTrustedAuthUri(authUri) || bridge == null) {
            setIntent(intent);
            return;
        }

        String encodedQuery = authUri.getEncodedQuery();
        String encodedFragment = authUri.getEncodedFragment();
        Uri destination = Uri.parse(bridge.getLocalUrl()).buildUpon()
            .path("/")
            .encodedQuery(encodedQuery)
            .encodedFragment(encodedFragment)
            .build();

        WebView shell = bridge.getWebView();
        shell.post(() -> shell.loadUrl(destination.toString()));

        // Do not keep OAuth/recovery credentials in the Activity Intent, where
        // Android could replay them during a later configuration restoration.
        Intent sanitizedIntent = new Intent(intent);
        sanitizedIntent.setData(null);
        setIntent(sanitizedIntent);
    }

    private static boolean isTrustedAuthUri(Uri uri) {
        if (uri == null || uri.toString().length() > MAX_AUTH_URI_LENGTH) {
            return false;
        }
        if (!AUTH_SCHEME.equalsIgnoreCase(uri.getScheme())
            || !AUTH_HOST.equalsIgnoreCase(uri.getHost())
            || uri.getPort() != -1
            || uri.getUserInfo() != null) {
            return false;
        }

        String path = uri.getPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            return false;
        }

        List<String> authValues = uri.getQueryParameters(AUTH_QUERY_KEY);
        if (authValues.size() != 1) {
            return false;
        }

        String authType = authValues.get(0);
        if (RECOVERY_QUERY_VALUE.equals(authType)) {
            return true;
        }
        if (!OAUTH_QUERY_VALUE.equals(authType)) {
            return false;
        }

        boolean hasCode = uri.getQueryParameter("code") != null;
        for (String queryKey : uri.getQueryParameterNames()) {
            if (!AUTH_QUERY_KEY.equals(queryKey) && !(hasCode && "code".equals(queryKey))) {
                return false;
            }
        }

        String fragment = uri.getEncodedFragment();
        Uri fragmentParameters = fragment == null
            ? null
            : Uri.parse("https://altgrid.invalid/?" + fragment);
        boolean hasImplicitSession = fragmentParameters != null
            && fragmentParameters.getQueryParameter("access_token") != null
            && fragmentParameters.getQueryParameter("refresh_token") != null;
        return hasCode || hasImplicitSession;
    }
}
