package io.altgrid.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.json.JSONObject;

@CapacitorPlugin(name = "AltGridMobile")
public class AltGridMobilePlugin extends Plugin {
    private static final String EVENT_SESSION_STATUS = "sessionStatus";
    private static final int MAX_ACCOUNT_ID_LENGTH = 256;
    private static final int MAX_TITLE_LENGTH = 120;
    private static final int MAX_URL_LENGTH = 8_192;
    private static final int MAX_LAYOUT_SESSIONS = 64;
    private static final double MAX_LAYOUT_COORDINATE = 100_000;

    private static WeakReference<AltGridMobilePlugin> activePlugin = new WeakReference<>(null);

    @Override
    public void load() {
        activePlugin = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (activePlugin.get() == this) {
            activePlugin.clear();
        }
        super.handleOnDestroy();
    }

    /** Inline game WebViews live above the Capacitor shell in the same Activity. */
    static void emitSessionStatus(String accountId, String status, String reason) {
        AltGridMobilePlugin plugin = activePlugin.get();
        if (plugin == null || accountId == null || accountId.isEmpty()) {
            return;
        }

        JSObject payload = new JSObject();
        payload.put("accountId", accountId);
        payload.put("status", status);
        if (reason != null && !reason.isEmpty()) {
            payload.put("reason", reason);
        }

        try {
            plugin.getActivity().runOnUiThread(
                // Opening is always initiated after the TypeScript listener is
                // registered. Do not retain terminal events: a later listener
                // must never consume a stale close from an older native session.
                () -> plugin.notifyListeners(EVENT_SESSION_STATUS, payload, false)
            );
        } catch (RuntimeException ignored) {
            // The Capacitor bridge is already being destroyed. There is no JS
            // consumer left to notify in this process.
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        String accountId = requiredValue(call, "accountId", MAX_ACCOUNT_ID_LENGTH);
        if (accountId == null) {
            return;
        }

        runOnUiThread(call, () -> {
            if (!GameActivity.supportsIsolatedProfile()) {
                call.reject(GameActivity.isolatedProfileError());
                return;
            }
            GameActivity.clearProfileData(getContext(), accountId, error -> {
                if (error == null) {
                    call.resolve(new JSObject());
                } else {
                    call.reject(error);
                }
            });
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        String accountId = requiredValue(call, "accountId", MAX_ACCOUNT_ID_LENGTH);
        if (accountId == null) {
            return;
        }

        runOnUiThread(call, () -> {
            if (!GameActivity.close(accountId, () -> call.resolve(new JSObject()))) {
                call.reject("Não foi possível fechar a sessão Android.");
            }
        });
    }

    @PluginMethod
    public void reload(PluginCall call) {
        String accountId = requiredValue(call, "accountId", MAX_ACCOUNT_ID_LENGTH);
        if (accountId == null) {
            return;
        }

        runOnUiThread(call, () -> {
            if (GameActivity.reload(accountId)) {
                call.resolve(new JSObject());
            } else {
                call.reject("A sessão não está aberta.");
            }
        });
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        runOnUiThread(call, () -> {
            if (GameActivity.setFullscreen(enabled)) {
                call.resolve(new JSObject());
            } else {
                call.reject("A tela Android não está disponível.");
            }
        });
    }

    @PluginMethod
    public void applyLayout(PluginCall call) {
        JSArray requestedSessions = call.getArray("sessions");
        if (requestedSessions == null) {
            call.reject("O layout das sessões é obrigatório.");
            return;
        }
        if (requestedSessions.length() > MAX_LAYOUT_SESSIONS) {
            call.reject("O layout contém sessões demais.");
            return;
        }

        List<GameActivity.SessionLayout> layout = new ArrayList<>();
        Set<String> accountIds = new HashSet<>();
        for (int index = 0; index < requestedSessions.length(); index += 1) {
            JSONObject requested = requestedSessions.optJSONObject(index);
            if (requested == null) {
                call.reject("O layout das sessões é inválido.");
                return;
            }

            String rawAccountId = requested.optString("accountId", "");
            String accountId = rawAccountId == null ? "" : rawAccountId.trim();
            if (accountId.isEmpty() || accountId.length() > MAX_ACCOUNT_ID_LENGTH) {
                call.reject("O layout contém uma conta inválida.");
                return;
            }
            if (!accountIds.add(accountId)) {
                call.reject("O layout contém uma conta duplicada.");
                return;
            }

            boolean visible = requested.optBoolean("visible", false);
            double x = requested.optDouble("x", 0);
            double y = requested.optDouble("y", 0);
            double width = requested.optDouble("width", 0);
            double height = requested.optDouble("height", 0);
            if (!isValidLayoutNumber(x)
                || !isValidLayoutNumber(y)
                || !isValidLayoutNumber(width)
                || !isValidLayoutNumber(height)
                || width < 0
                || height < 0) {
                call.reject("O layout contém coordenadas inválidas.");
                return;
            }

            layout.add(new GameActivity.SessionLayout(
                accountId,
                visible,
                x,
                y,
                width,
                height
            ));
        }

        runOnUiThread(call, () -> {
            if (GameActivity.applyLayout(layout)) {
                call.resolve(new JSObject());
            } else {
                call.reject("A tela Android não está disponível.");
            }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String accountId = requiredValue(call, "accountId", MAX_ACCOUNT_ID_LENGTH);
        if (accountId == null) {
            return;
        }
        String url = requiredValue(call, "url", MAX_URL_LENGTH);
        if (url == null) {
            return;
        }
        if (!GameActivity.isAllowedUrl(url)) {
            call.reject("O endereço precisa usar HTTPS (HTTP é aceito apenas no dispositivo local).");
            return;
        }

        String requestedTitle = call.getString("title", "AltGrid");
        String title = requestedTitle == null ? "AltGrid" : requestedTitle.trim();
        if (title.isEmpty()) {
            title = "AltGrid";
        } else if (title.length() > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH);
        }
        final String safeTitle = title;

        runOnUiThread(call, () -> {
            if (!GameActivity.supportsIsolatedProfile()) {
                call.reject(GameActivity.isolatedProfileError());
                return;
            }
            int reservation = GameActivity.reserveOpen(accountId, error -> {
                if (error == null) {
                    call.resolve(new JSObject());
                } else {
                    call.reject(error);
                }
            });
            if (reservation == GameActivity.OPEN_REJECTED) {
                call.reject("Não foi possível reservar a sessão Android.");
                return;
            }

            if (reservation == GameActivity.OPEN_PENDING) {
                return;
            }
            try {
                if (!GameActivity.open(accountId, safeTitle, url)) {
                    if (reservation == GameActivity.OPEN_EXISTING) {
                        call.reject("Não foi possível abrir a sessão Android.");
                    } else {
                        GameActivity.cancelOpen(
                            accountId,
                            "Não foi possível abrir a sessão Android."
                        );
                    }
                    return;
                }
                if (reservation == GameActivity.OPEN_EXISTING) {
                    call.resolve(new JSObject());
                }
            } catch (RuntimeException error) {
                if (reservation == GameActivity.OPEN_EXISTING) {
                    call.reject("Não foi possível abrir a sessão Android.", error);
                } else {
                    GameActivity.cancelOpen(
                        accountId,
                        "Não foi possível abrir a sessão Android."
                    );
                }
            }
        });
    }

    private static boolean isValidLayoutNumber(double value) {
        return !Double.isNaN(value)
            && !Double.isInfinite(value)
            && Math.abs(value) <= MAX_LAYOUT_COORDINATE;
    }

    private String requiredValue(PluginCall call, String key, int maxLength) {
        String value = call.getString(key, "");
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            call.reject(
                "accountId".equals(key)
                    ? "A conta é obrigatória."
                    : "O endereço do jogo é obrigatório."
            );
            return null;
        }
        if (normalized.length() > maxLength) {
            call.reject("O valor de " + key + " é muito longo.");
            return null;
        }
        return normalized;
    }

    private void runOnUiThread(PluginCall call, Runnable action) {
        try {
            getActivity().runOnUiThread(action);
        } catch (RuntimeException error) {
            call.reject("A tela Android não está disponível.", error);
        }
    }
}
