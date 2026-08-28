package io.altgrid.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "AltGridMobileUpdater")
public class AltGridMobileUpdaterPlugin extends Plugin {
    private static final String EVENT_DOWNLOAD_PROGRESS = "downloadProgress";
    private static final String GITHUB_HOST = "github.com";
    private static final String GITHUB_ASSET_HOST = "release-assets.githubusercontent.com";
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String UPDATE_DIRECTORY = "updates";
    private static final String UPDATE_FILE_NAME = "AltGrid-update.apk";
    private static final String PARTIAL_FILE_NAME = "AltGrid-update.part.apk";
    private static final String PREFERENCES_NAME = "altgrid_mobile_updater";
    private static final String PREFERENCE_VERSION = "version";
    private static final String PREFERENCE_SIZE = "size";
    private static final String PREFERENCE_SHA256 = "sha256";
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_REDIRECTS = 5;
    private static final long MAX_APK_SIZE = 500L * 1024L * 1024L;
    private static final Pattern VERSION_PATTERN = Pattern.compile(
        "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$"
    );
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-fA-F0-9]{64}$");

    private final AtomicBoolean downloadInProgress = new AtomicBoolean(false);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        deleteQuietly(partialFile());
        super.handleOnDestroy();
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String version = normalizedValue(call.getString("version"));
        String url = normalizedValue(call.getString("url"));
        Long expectedSize = call.getLong("expectedSize");
        String expectedSha256 = normalizedValue(call.getString("expectedSha256"));

        if (!isValidVersion(version)
            || !isTrustedReleaseUrl(url, version)
            || expectedSize == null
            || expectedSize <= 0
            || expectedSize > MAX_APK_SIZE
            || (!expectedSha256.isEmpty() && !SHA256_PATTERN.matcher(expectedSha256).matches())) {
            call.reject("Os dados da atualização Android são inválidos.");
            return;
        }
        if (!downloadInProgress.compareAndSet(false, true)) {
            call.reject("Uma atualização já está sendo baixada.");
            return;
        }

        final String safeSha256 = expectedSha256.toLowerCase(Locale.ROOT);
        executor.execute(() -> {
            File target = updateFile();
            File partial = partialFile();
            try {
                clearStoredUpdate();
                ensureUpdateDirectory();
                download(url, expectedSize, safeSha256, partial);
                validateApk(partial, version, expectedSize, safeSha256, true);

                if (target.exists() && !target.delete()) {
                    throw new IOException("Não foi possível substituir a atualização anterior.");
                }
                if (!partial.renameTo(target)) {
                    throw new IOException("Não foi possível finalizar o arquivo da atualização.");
                }

                getContext().getSharedPreferences(PREFERENCES_NAME, 0)
                    .edit()
                    .putString(PREFERENCE_VERSION, version)
                    .putLong(PREFERENCE_SIZE, expectedSize)
                    .putString(PREFERENCE_SHA256, safeSha256)
                    .apply();
                emitProgress(100);
                resolveOnMainThread(call, new JSObject());
            } catch (Exception error) {
                deleteQuietly(partial);
                deleteQuietly(target);
                clearStoredMetadata();
                rejectOnMainThread(call, safeMessage(error), error);
            } finally {
                downloadInProgress.set(false);
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (downloadInProgress.get()) {
            call.reject("A atualização ainda está sendo baixada.");
            return;
        }

        executor.execute(() -> {
            try {
                String version = getContext().getSharedPreferences(PREFERENCES_NAME, 0)
                    .getString(PREFERENCE_VERSION, "");
                long expectedSize = getContext().getSharedPreferences(PREFERENCES_NAME, 0)
                    .getLong(PREFERENCE_SIZE, 0);
                String expectedSha256 = getContext().getSharedPreferences(PREFERENCES_NAME, 0)
                    .getString(PREFERENCE_SHA256, "");
                File apk = updateFile();

                if (!isValidVersion(version) || expectedSize <= 0 || !apk.isFile()) {
                    throw new IOException("Baixe a atualização novamente antes de instalar.");
                }
                validateApk(apk, version, expectedSize, expectedSha256, true);

                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk
                );
                Intent installer = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(apkUri, APK_MIME_TYPE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                if (installer.resolveActivity(getContext().getPackageManager()) == null) {
                    throw new IOException("O instalador de pacotes do Android não está disponível.");
                }

                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(installer);
                        JSObject result = new JSObject();
                        result.put("started", true);
                        call.resolve(result);
                    } catch (RuntimeException error) {
                        call.reject("Não foi possível abrir o instalador do Android.", error);
                    }
                });
            } catch (Exception error) {
                clearStoredUpdate();
                rejectOnMainThread(call, safeMessage(error), error);
            }
        });
    }

    private void download(
        String requestedUrl,
        long expectedSize,
        String expectedSha256,
        File destination
    ) throws Exception {
        URL current = new URL(requestedUrl);
        HttpsURLConnection connection = null;
        try {
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
                connection = (HttpsURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("User-Agent", "AltGrid-Android-Updater");

                int status = connection.getResponseCode();
                if (isRedirect(status)) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (location == null || location.trim().isEmpty()) {
                        throw new IOException("O servidor retornou um redirecionamento inválido.");
                    }
                    URL redirected = new URL(current, location);
                    if (!isTrustedRedirectUrl(redirected)) {
                        throw new IOException("O download foi redirecionado para um endereço não autorizado.");
                    }
                    current = redirected;
                    continue;
                }
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IOException("O servidor respondeu com HTTP " + status + ".");
                }
                if (!isTrustedFinalUrl(current)) {
                    throw new IOException("O endereço final do download não é autorizado.");
                }

                long contentLength = connection.getContentLengthLong();
                if (contentLength > 0 && contentLength != expectedSize) {
                    throw new IOException("O tamanho publicado da atualização não confere.");
                }
                streamDownload(connection, expectedSize, expectedSha256, destination);
                return;
            }
            throw new IOException("A atualização excedeu o limite de redirecionamentos.");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void streamDownload(
        HttpsURLConnection connection,
        long expectedSize,
        String expectedSha256,
        File destination
    ) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long downloaded = 0;
        int lastPercent = -1;
        byte[] buffer = new byte[BUFFER_SIZE];

        try (
            BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
            BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(destination))
        ) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) {
                    throw new IOException("O download foi cancelado.");
                }
                downloaded += read;
                if (downloaded > expectedSize || downloaded > MAX_APK_SIZE) {
                    throw new IOException("A atualização excedeu o tamanho esperado.");
                }
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);

                int percent = (int) Math.min(99, downloaded * 100 / expectedSize);
                if (percent != lastPercent) {
                    lastPercent = percent;
                    emitProgress(percent);
                }
            }
            output.flush();
        }

        if (downloaded != expectedSize) {
            throw new IOException("O arquivo baixado está incompleto.");
        }
        if (!expectedSha256.isEmpty()
            && !expectedSha256.equalsIgnoreCase(toHex(digest.digest()))) {
            throw new IOException("A assinatura SHA-256 da atualização não confere.");
        }
    }

    private void validateApk(
        File apk,
        String expectedVersion,
        long expectedSize,
        String expectedSha256,
        boolean requireNewerVersion
    ) throws Exception {
        if (!apk.isFile() || apk.length() != expectedSize) {
            throw new IOException("O arquivo da atualização está incompleto.");
        }
        if (!expectedSha256.isEmpty()
            && !expectedSha256.equalsIgnoreCase(calculateSha256(apk))) {
            throw new IOException("A assinatura SHA-256 da atualização não confere.");
        }

        PackageManager packageManager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = packageManager.getPackageInfo(getContext().getPackageName(), flags);
        if (candidate == null
            || candidate.packageName == null
            || !getContext().getPackageName().equals(candidate.packageName)) {
            throw new IOException("O pacote baixado não pertence ao AltGrid.");
        }
        if (!expectedVersion.equals(candidate.versionName)) {
            throw new IOException("A versão do pacote baixado não confere.");
        }
        if (requireNewerVersion && longVersionCode(candidate) <= longVersionCode(installed)) {
            throw new IOException("A atualização não possui um código de versão mais novo.");
        }
        if (!signaturesMatch(installed, candidate)) {
            throw new IOException(
                "Esta instalação usa a assinatura beta antiga. Instale a nova versão "
                    + "manualmente uma vez; depois, as atualizações serão automáticas."
            );
        }
    }

    private static boolean signaturesMatch(PackageInfo installed, PackageInfo candidate)
        throws NoSuchAlgorithmException {
        Set<String> installedDigests = certificateDigests(installed);
        Set<String> candidateDigests = certificateDigests(candidate);
        if (installedDigests.isEmpty() || candidateDigests.isEmpty()) {
            return false;
        }
        for (String digest : candidateDigests) {
            if (installedDigests.contains(digest)) {
                return true;
            }
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] packageSignatures(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            return info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        }
        return info.signatures;
    }

    private static Set<String> certificateDigests(PackageInfo info)
        throws NoSuchAlgorithmException {
        Set<String> digests = new HashSet<>();
        Signature[] signatures = packageSignatures(info);
        if (signatures == null) {
            return digests;
        }
        for (Signature signature : signatures) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digests.add(toHex(digest.digest(signature.toByteArray())));
        }
        return digests;
    }

    @SuppressWarnings("deprecation")
    private static long longVersionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? info.getLongVersionCode()
            : info.versionCode;
    }

    private void emitProgress(int percent) {
        JSObject payload = new JSObject();
        payload.put("percent", Math.max(0, Math.min(100, percent)));
        try {
            getActivity().runOnUiThread(() -> notifyListeners(
                EVENT_DOWNLOAD_PROGRESS,
                payload,
                false
            ));
        } catch (RuntimeException ignored) {
            // The bridge is being destroyed and no JavaScript listener remains.
        }
    }

    private void resolveOnMainThread(PluginCall call, JSObject value) {
        try {
            getActivity().runOnUiThread(() -> call.resolve(value));
        } catch (RuntimeException error) {
            call.reject("A tela Android não está disponível.", error);
        }
    }

    private void rejectOnMainThread(PluginCall call, String message, Exception cause) {
        try {
            getActivity().runOnUiThread(() -> call.reject(message, cause));
        } catch (RuntimeException error) {
            call.reject(message, cause);
        }
    }

    private File updateDirectory() {
        return new File(getContext().getCacheDir(), UPDATE_DIRECTORY);
    }

    private File updateFile() {
        return new File(updateDirectory(), UPDATE_FILE_NAME);
    }

    private File partialFile() {
        return new File(updateDirectory(), PARTIAL_FILE_NAME);
    }

    private void ensureUpdateDirectory() throws IOException {
        File directory = updateDirectory();
        if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory()) {
            throw new IOException("Não foi possível preparar o armazenamento da atualização.");
        }
    }

    private void clearStoredUpdate() {
        deleteQuietly(updateFile());
        deleteQuietly(partialFile());
        clearStoredMetadata();
    }

    private void clearStoredMetadata() {
        getContext().getSharedPreferences(PREFERENCES_NAME, 0).edit().clear().apply();
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            // Best-effort cleanup. A later download always truncates its own temp file.
            file.delete();
        }
    }

    private static String calculateSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[BUFFER_SIZE];
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file))) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte entry : value) {
            result.append(String.format(Locale.ROOT, "%02x", entry));
        }
        return result.toString();
    }

    private static boolean isTrustedReleaseUrl(String value, String version) {
        if (value.isEmpty() || !isValidVersion(version)) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String expectedPath = "/acvisualdigital/altgrid-releases/releases/download/v"
                + version
                + "/AltGrid-Android-"
                + version
                + ".apk";
            return "https".equalsIgnoreCase(uri.getScheme())
                && GITHUB_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getPort() == -1
                && uri.getRawUserInfo() == null
                && uri.getRawQuery() == null
                && uri.getRawFragment() == null
                && expectedPath.equals(uri.getPath());
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static boolean isTrustedRedirectUrl(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol())
            || (url.getPort() != -1 && url.getPort() != 443)
            || url.getUserInfo() != null
            || url.getRef() != null) {
            return false;
        }
        String host = url.getHost();
        return GITHUB_HOST.equalsIgnoreCase(host)
            || GITHUB_ASSET_HOST.equalsIgnoreCase(host);
    }

    private static boolean isTrustedFinalUrl(URL url) {
        return isTrustedRedirectUrl(url)
            && (GITHUB_HOST.equalsIgnoreCase(url.getHost())
                || GITHUB_ASSET_HOST.equalsIgnoreCase(url.getHost()));
    }

    private static boolean isRedirect(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM
            || status == HttpURLConnection.HTTP_MOVED_TEMP
            || status == HttpURLConnection.HTTP_SEE_OTHER
            || status == 307
            || status == 308;
    }

    private static boolean isValidVersion(String value) {
        return !value.isEmpty()
            && value.length() <= 80
            && VERSION_PATTERN.matcher(value).matches();
    }

    private static String normalizedValue(String value) {
        return value == null ? "" : value.trim();
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? "Não foi possível preparar a atualização Android."
            : message;
    }
}
