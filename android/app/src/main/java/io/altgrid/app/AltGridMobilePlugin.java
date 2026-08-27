package io.altgrid.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AltGridMobile")
public class AltGridMobilePlugin extends Plugin {
    @PluginMethod
    public void clear(PluginCall call) {
        String accountId = call.getString("accountId", "");
        if (accountId.isEmpty()) {
            call.reject("A conta é obrigatória.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (!GameActivity.canUseProfile(getContext(), accountId)) {
                call.reject("Os dados pertencem a outra conta Android ativa.");
                return;
            }
            GameActivity.clearProfileData(getContext(), () -> call.resolve(new JSObject()));
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        String accountId = call.getString("accountId", "");
        if (accountId.isEmpty()) {
            call.reject("A conta é obrigatória.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            GameActivity.close(accountId);
            call.resolve(new JSObject());
        });
    }

    @PluginMethod
    public void reload(PluginCall call) {
        String accountId = call.getString("accountId", "");
        if (accountId.isEmpty()) {
            call.reject("A conta é obrigatória.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (GameActivity.reload(accountId)) {
                call.resolve(new JSObject());
            } else {
                call.reject("A sessão não está aberta.");
            }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String accountId = call.getString("accountId", "");
        String title = call.getString("title", "AltGrid");
        String url = call.getString("url", "");

        if (accountId.isEmpty() || url.isEmpty()) {
            call.reject("A conta e o endereço do jogo são obrigatórios.");
            return;
        }
        if (!GameActivity.canOpen(accountId)) {
            call.reject("A versão Android permite uma sessão por vez.");
            return;
        }
        Runnable launch = () -> {
            Intent intent = new Intent(getContext(), GameActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(GameActivity.EXTRA_ACCOUNT_ID, accountId);
            intent.putExtra(GameActivity.EXTRA_TITLE, title);
            intent.putExtra(GameActivity.EXTRA_URL, url);
            getActivity().startActivity(intent);
            call.resolve(new JSObject());
        };
        getActivity().runOnUiThread(() -> {
            if (GameActivity.canUseProfile(getContext(), accountId)) {
                launch.run();
            } else {
                // WebView has a single process profile. Switching accounts
                // clears that profile instead of leaking the previous login.
                GameActivity.clearProfileData(getContext(), launch);
            }
        });
    }
}
