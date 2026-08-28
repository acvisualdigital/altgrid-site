package io.altgrid.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import java.util.List;

public class MainActivity extends GameActivity {
    private static final String RECOVERY_SCHEME = "altgrid";
    private static final String RECOVERY_HOST = "app";
    private static final String RECOVERY_QUERY_KEY = "auth";
    private static final String RECOVERY_QUERY_VALUE = "recovery";
    private static final int MAX_RECOVERY_URI_LENGTH = 16_384;

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AltGridMobilePlugin.class);
        registerPlugin(AltGridMobileUpdaterPlugin.class);
        super.onCreate(state);
        handleRecoveryIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleRecoveryIntent(intent);
    }

    private void handleRecoveryIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        Uri recoveryUri = intent.getData();
        if (!isTrustedRecoveryUri(recoveryUri) || bridge == null) {
            setIntent(intent);
            return;
        }

        String encodedQuery = recoveryUri.getEncodedQuery();
        String encodedFragment = recoveryUri.getEncodedFragment();
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

    private static boolean isTrustedRecoveryUri(Uri uri) {
        if (uri == null || uri.toString().length() > MAX_RECOVERY_URI_LENGTH) {
            return false;
        }
        if (!RECOVERY_SCHEME.equalsIgnoreCase(uri.getScheme())
            || !RECOVERY_HOST.equalsIgnoreCase(uri.getHost())
            || uri.getPort() != -1
            || uri.getUserInfo() != null) {
            return false;
        }

        String path = uri.getPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            return false;
        }

        List<String> recoveryValues = uri.getQueryParameters(RECOVERY_QUERY_KEY);
        return recoveryValues.size() == 1
            && RECOVERY_QUERY_VALUE.equals(recoveryValues.get(0));
    }
}
