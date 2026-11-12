package it.xandred.musicante;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Musicante Player per Android: apre il lettore servito da TwitchGestor sul Raspberry
 * (http://<raspberry>:3000/player), come il programma per Windows. Il lettore si aggiorna con TwitchGestor;
 * qui ci sono solo la finestra, la ricerca del Raspberry e la musica a schermo spento (PlayerService).
 */
public class MainActivity extends Activity {
    static MainActivity current;
    private static final String[] DEFAULTS = { "http://twitchgestor.local:3000", "http://twitchgestor:3000" };

    private WebView web;
    private SharedPreferences prefs;
    private Offline offline;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = this;
        prefs = getSharedPreferences("musicante", MODE_PRIVATE);
        offline = new Offline(this, () -> runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.musicanteOfflineChanged && window.musicanteOfflineChanged()", null);
        }));
        getWindow().setStatusBarColor(Color.parseColor("#111111"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#111111"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // la password della dashboard e le preferenze del lettore restano qui
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "MusicanteAndroid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            // tutte le richieste passano da qui: i brani scaricati e la copia del lettore per quando sei offline
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return offline.intercept(req);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) setup("Il Raspberry non risponde (" + err.getDescription() + "). Controlla che sia acceso, o scrivi l'indirizzo giusto:");
            }
        });
        setContentView(web);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);

        String server = prefs.getString("server", "");
        if (server.isEmpty()) discover();
        else open(server);
    }

    private void open(String server) {
        offline.setServer(server);
        web.loadUrl(server + "/player");
    }

    /** Il Raspberry risponde a questo indirizzo? (è Musicante Player e non un'altra cosa) */
    static boolean answers(String server) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(server + "/player/ping").openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(3000);
            try (InputStream in = c.getInputStream()) {
                byte[] b = new byte[64];
                int n = in.read(b);
                return n > 0 && new String(b, 0, n).startsWith("musicante-player");
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return false;
        }
    }

    /** Prima volta: cerca il Raspberry sulla rete di casa con il suo nome; se non lo trova, chiede l'indirizzo. */
    private void discover() {
        web.loadData("<body style='background:#111;color:#ddd;font:18px sans-serif;padding:30px'>Cerco il Raspberry sulla rete di casa…</body>", "text/html", "utf-8");
        new Thread(() -> {
            for (String d : DEFAULTS) {
                if (answers(d)) {
                    runOnUiThread(() -> { prefs.edit().putString("server", d).apply(); open(d); });
                    return;
                }
            }
            runOnUiThread(() -> setup("Non trovo il Raspberry da solo. Scrivi il suo indirizzo (lo vedi nella dashboard, scheda Musica → Ascolta sul telefono):"));
        }).start();
    }

    /** "1.2.3.4" → "http://1.2.3.4:3000" */
    static String normalize(String in) {
        String s = in.trim().replaceAll("/+$", "");
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        Uri u = Uri.parse(s);
        if (u.getPort() == -1 && s.startsWith("http://")) s = u.getScheme() + "://" + u.getHost() + ":3000";
        else s = u.getScheme() + "://" + u.getAuthority();
        return s;
    }

    private void setup(String message) {
        if (isFinishing()) return;
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("192.168.1.50 oppure twitchgestor.local");
        input.setText(prefs.getString("server", ""));
        new AlertDialog.Builder(this)
            .setTitle("Indirizzo del Raspberry")
            .setMessage(message.isEmpty() ? "Indirizzo del Raspberry (es. 192.168.1.50):" : message)
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("Collega", (d, w) -> {
                String server = normalize(input.getText().toString());
                new Thread(() -> {
                    boolean ok = !server.isEmpty() && answers(server);
                    runOnUiThread(() -> {
                        if (ok) { prefs.edit().putString("server", server).apply(); open(server); }
                        else setup("A \"" + server + "\" non risponde. Controlla l'indirizzo (e di essere sulla rete di casa):");
                    });
                }).start();
            })
            .setNeutralButton("Cerca da solo", (d, w) -> discover())
            .show();
    }

    /** Un comando dalla notifica o dalla schermata di blocco: lo esegue il lettore. */
    void control(String cmd) {
        runOnUiThread(() -> web.evaluateJavascript("window.musicanteControl && window.musicanteControl('" + cmd + "')", null));
    }

    @Override
    public void onBackPressed() {
        // "indietro" non chiude: la musica continua (come le altre app di musica)
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        PlayerService.stop(this);
        web.destroy();
        super.onDestroy();
    }

    /** Ponte con la pagina del lettore (window.MusicanteAndroid). */
    class Bridge {
        @JavascriptInterface
        public void settings() {
            runOnUiThread(() -> setup(""));
        }

        // ---------- playlist sul telefono (Offline) ----------
        @JavascriptInterface
        public String offlineStatus() { return offline.status(); }

        @JavascriptInterface
        public void offlineDownload(String playlist, String tracksJson) { offline.download(playlist, tracksJson); }

        @JavascriptInterface
        public void offlineRemove(String playlist) { offline.remove(playlist); }

        @JavascriptInterface
        public void offlineSync(String byPlaylistJson) { offline.sync(byPlaylistJson); }

        @JavascriptInterface
        public void report(String json) {
            try {
                JSONObject o = new JSONObject(json);
                PlayerService.update(MainActivity.this, o.optString("title"), o.optString("artist"), o.optBoolean("playing"));
            } catch (Exception ignored) {
                // stato non leggibile: niente
            }
        }
    }
}
