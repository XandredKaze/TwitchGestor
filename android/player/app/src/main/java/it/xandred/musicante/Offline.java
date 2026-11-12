package it.xandred.musicante;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Musica senza Raspberry: le playlist scelte si copiano nel telefono (files/offline/media) e il lettore
 * (pagina, stile, elenco dei brani) resta in una copia (files/offline/site). Tutte le richieste della pagina
 * passano da intercept(): i brani scaricati si leggono dal telefono, il resto va al Raspberry e, se non
 * risponde, si usa la copia; l'elenco dei brani offline contiene solo quelli scaricati.
 */
class Offline {
    interface Listener { void changed(); }

    private final File root, media, site, manifestFile;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONObject manifest; // playlist → [{ id, url }]
    private volatile String server = "";
    private volatile String busy = ""; // "120/395" mentre scarica
    private volatile boolean queued;
    private volatile long downUntil; // il Raspberry non risponde: per un po' non si riprova a ogni richiesta

    Offline(Context ctx, Listener listener) {
        this.listener = listener;
        root = new File(ctx.getFilesDir(), "offline");
        media = new File(root, "media");
        site = new File(root, "site");
        manifestFile = new File(root, "playlists.json");
        media.mkdirs();
        site.mkdirs();
        try { manifest = new JSONObject(read(manifestFile)); } catch (Exception e) { manifest = new JSONObject(); }
    }

    void setServer(String s) { server = s; }

    // ---------- richieste della pagina ----------

    WebResourceResponse intercept(WebResourceRequest req) {
        Uri u = req.getUrl();
        if (server.isEmpty() || !"GET".equals(req.getMethod()) || !u.toString().startsWith(server + "/")) return null;
        String path = u.getPath() == null ? "/" : u.getPath();
        try {
            if (path.startsWith("/media/music/")) {
                File f = fileFor(URLDecoder.decode(path.substring("/media/music/".length()), "UTF-8"));
                return f.isFile() ? serveFile(f, req.getRequestHeaders()) : null; // non scaricato: dal Raspberry
            }
            if (path.equals("/api/music")) return library(req);
            if (path.startsWith("/api/") || path.startsWith("/ws") || path.equals("/player/ping")) return null;
            return asset(req, path);
        } catch (Exception e) {
            return null;
        }
    }

    /** L'elenco dei brani: dal Raspberry (e se ne tiene una copia), altrimenti solo quelli scaricati. */
    private WebResourceResponse library(WebResourceRequest req) throws Exception {
        File copy = new File(root, "library.json");
        byte[] body = fetch(req, 6000);
        if (body != null) {
            write(copy, body);
            return new WebResourceResponse("application/json", "utf-8", new ByteArrayInputStream(body));
        }
        if (!copy.isFile()) return null;
        JSONObject data = new JSONObject(read(copy));
        JSONArray all = data.optJSONArray("tracks");
        JSONArray have = new JSONArray();
        if (all != null) for (int i = 0; i < all.length(); i++) {
            JSONObject t = all.getJSONObject(i);
            if (fileFor(t.optString("id")).isFile()) have.put(t);
        }
        data.put("tracks", have);
        data.put("offline", true);
        return new WebResourceResponse("application/json", "utf-8", new ByteArrayInputStream(data.toString().getBytes(StandardCharsets.UTF_8)));
    }

    /** Pagina, stile, script, caratteri e immagini del lettore: dal Raspberry, con una copia per quando non c'è. */
    private WebResourceResponse asset(WebResourceRequest req, String path) throws Exception {
        String key = path.replaceAll("[^A-Za-z0-9._-]", "_");
        if (key.isEmpty() || key.equals("_")) key = "_root";
        File copy = new File(site, key);
        File type = new File(site, key + ".type");
        HttpURLConnection c = open(req, 4000);
        if (c != null) {
            try {
                if (c.getResponseCode() == 200) {
                    byte[] body = readAll(c.getInputStream());
                    String mime = c.getContentType() == null ? "text/html" : c.getContentType();
                    write(copy, body);
                    write(type, mime.getBytes(StandardCharsets.UTF_8));
                    return response(mime, body);
                }
            } catch (IOException ignored) {
                // a metà: si usa la copia
            } finally {
                c.disconnect();
            }
        }
        if (!copy.isFile()) return null;
        return response(type.isFile() ? read(type) : "text/html", readAll(new FileInputStream(copy)));
    }

    private static WebResourceResponse response(String contentType, byte[] body) {
        String mime = contentType.split(";")[0].trim();
        String enc = contentType.contains("charset=") ? contentType.substring(contentType.indexOf("charset=") + 8).trim() : null;
        return new WebResourceResponse(mime, enc, new ByteArrayInputStream(body));
    }

    private HttpURLConnection open(WebResourceRequest req, int timeout) {
        if (System.currentTimeMillis() < downUntil && !req.getUrl().getPath().equals("/api/music")) return null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(req.getUrl().toString()).openConnection();
            c.setConnectTimeout(timeout);
            c.setReadTimeout(15000);
            for (Map.Entry<String, String> h : req.getRequestHeaders().entrySet()) {
                if (!h.getKey().equalsIgnoreCase("Range")) c.setRequestProperty(h.getKey(), h.getValue());
            }
            c.connect();
            downUntil = 0;
            return c;
        } catch (IOException e) {
            downUntil = System.currentTimeMillis() + 20000;
            return null;
        }
    }

    private byte[] fetch(WebResourceRequest req, int timeout) {
        HttpURLConnection c = open(req, timeout);
        if (c == null) return null;
        try {
            return c.getResponseCode() == 200 ? readAll(c.getInputStream()) : null;
        } catch (IOException e) {
            return null;
        } finally {
            c.disconnect();
        }
    }

    /** Un brano dal telefono, anche a pezzi (per spostarsi dentro il brano). */
    private static WebResourceResponse serveFile(File f, Map<String, String> headers) throws IOException {
        long size = f.length();
        long start = 0, end = size - 1;
        String range = null;
        for (Map.Entry<String, String> h : headers.entrySet()) if (h.getKey().equalsIgnoreCase("Range")) range = h.getValue();
        boolean partial = range != null && range.startsWith("bytes=");
        if (partial) {
            String[] p = range.substring(6).split("-", 2);
            if (!p[0].isEmpty()) start = Long.parseLong(p[0].trim());
            if (p.length > 1 && !p[1].trim().isEmpty()) end = Math.min(size - 1, Long.parseLong(p[1].trim()));
            if (start > end) { start = 0; end = size - 1; partial = false; }
        }
        FileInputStream in = new FileInputStream(f);
        long skip = start;
        while (skip > 0) { long n = in.skip(skip); if (n <= 0) break; skip -= n; }
        final long length = end - start + 1;
        InputStream body = new FilterInputStream(in) {
            long left = length;
            @Override public int read() throws IOException { if (left <= 0) return -1; int b = super.read(); if (b >= 0) left--; return b; }
            @Override public int read(byte[] b, int off, int len) throws IOException {
                if (left <= 0) return -1;
                int n = super.read(b, off, (int) Math.min(len, left));
                if (n > 0) left -= n;
                return n;
            }
        };
        Map<String, String> out = new HashMap<>();
        out.put("Accept-Ranges", "bytes");
        out.put("Content-Length", String.valueOf(length));
        out.put("Access-Control-Allow-Origin", "*");
        if (partial) out.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        return new WebResourceResponse(mime(f.getName()), null, partial ? 206 : 200, partial ? "Partial Content" : "OK", out, body);
    }

    private static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
        if (n.endsWith(".m4a")) return "audio/mp4";
        if (n.endsWith(".flac")) return "audio/flac";
        if (n.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    // ---------- playlist sul telefono ----------

    private File fileFor(String id) {
        String safe = id.replace("\\", "/").replaceAll("(^|/)\\.\\.(?=/|$)", "$1_");
        return new File(media, safe);
    }

    /** Stato per la pagina: playlist scaricate (brani, quanti ci sono già, spazio) e cosa sta scaricando. */
    synchronized String status() {
        try {
            JSONObject pls = new JSONObject();
            for (Iterator<String> it = manifest.keys(); it.hasNext(); ) {
                String pl = it.next();
                JSONArray list = manifest.getJSONArray(pl);
                int have = 0;
                long bytes = 0;
                for (int i = 0; i < list.length(); i++) {
                    File f = fileFor(list.getJSONObject(i).getString("id"));
                    if (f.isFile()) { have++; bytes += f.length(); }
                }
                pls.put(pl, new JSONObject().put("total", list.length()).put("have", have).put("bytes", bytes));
            }
            return new JSONObject().put("playlists", pls).put("busy", busy).put("free", media.getUsableSpace()).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Scarica una playlist (o la aggiorna): tracks = [{ id, url }]. */
    synchronized void download(String playlist, String tracksJson) {
        try {
            manifest.put(playlist, new JSONArray(tracksJson));
            saveManifest();
        } catch (Exception ignored) {
            return;
        }
        prune();
        start();
    }

    synchronized void remove(String playlist) {
        manifest.remove(playlist);
        saveManifest();
        prune();
        listener.changed();
    }

    /** Il Raspberry risponde: le playlist scaricate seguono i brani di adesso (nuovi da scaricare, tolti da cancellare). */
    synchronized void sync(String byPlaylistJson) {
        try {
            JSONObject now = new JSONObject(byPlaylistJson);
            boolean changed = false;
            for (Iterator<String> it = manifest.keys(); it.hasNext(); ) {
                String pl = it.next();
                if (!now.has(pl)) continue; // la playlist non c'è più sul Raspberry: si tiene quella che c'è
                JSONArray fresh = now.getJSONArray(pl);
                if (!fresh.toString().equals(manifest.getJSONArray(pl).toString())) { manifest.put(pl, fresh); changed = true; }
            }
            if (changed) { saveManifest(); prune(); }
        } catch (Exception ignored) {
            return;
        }
        start();
    }

    /** Toglie dal telefono i brani che nessuna playlist scaricata usa più. */
    private void prune() {
        Set<String> keep = new HashSet<>();
        try {
            for (Iterator<String> it = manifest.keys(); it.hasNext(); ) {
                JSONArray list = manifest.getJSONArray(it.next());
                for (int i = 0; i < list.length(); i++) keep.add(fileFor(list.getJSONObject(i).getString("id")).getCanonicalPath());
            }
            clean(media, keep);
        } catch (Exception ignored) {
            // niente
        }
    }

    private static void clean(File dir, Set<String> keep) throws IOException {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) { clean(f, keep); if (f.list() != null && f.list().length == 0) f.delete(); }
            else if (!f.getName().endsWith(".part") && !keep.contains(f.getCanonicalPath())) f.delete();
        }
    }

    private void start() {
        if (queued) return;
        queued = true;
        worker.execute(this::run);
    }

    private void run() {
        queued = false;
        while (true) {
            JSONObject next = null;
            int total = 0, have = 0;
            synchronized (this) {
                try {
                    Set<String> seen = new HashSet<>();
                    for (Iterator<String> it = manifest.keys(); it.hasNext(); ) {
                        JSONArray list = manifest.getJSONArray(it.next());
                        for (int i = 0; i < list.length(); i++) {
                            JSONObject t = list.getJSONObject(i);
                            if (!seen.add(t.getString("id"))) continue;
                            total++;
                            if (fileFor(t.getString("id")).isFile()) have++;
                            else if (next == null) next = t;
                        }
                    }
                } catch (Exception e) {
                    next = null;
                }
            }
            if (next == null || server.isEmpty()) { busy = ""; listener.changed(); return; }
            busy = have + "/" + total;
            listener.changed();
            if (!get(next)) { busy = ""; listener.changed(); return; } // Raspberry non raggiungibile: si riprova dopo
        }
    }

    /** Scarica un brano (prima in un file a parte: un brano a metà non si usa mai). */
    private boolean get(JSONObject t) {
        try {
            String id = t.getString("id");
            String url = t.optString("url");
            if (url.isEmpty()) url = "/media/music/" + Uri.encode(id, "/");
            HttpURLConnection c = (HttpURLConnection) new URL(url.startsWith("http") ? url : server + url).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(30000);
            try {
                if (c.getResponseCode() == 404) return true; // tolto sul Raspberry: si salta (lo toglie il prossimo sync)
                if (c.getResponseCode() != 200) return false;
                File f = fileFor(id);
                f.getParentFile().mkdirs();
                File tmp = new File(f.getPath() + ".part");
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                return tmp.renameTo(f);
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return false;
        }
    }

    private void saveManifest() {
        try { write(manifestFile, manifest.toString().getBytes(StandardCharsets.UTF_8)); } catch (IOException ignored) { /* niente */ }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static String read(File f) throws IOException {
        return new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8);
    }

    private static void write(File f, byte[] data) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) { out.write(data); }
        if (!tmp.renameTo(f)) throw new IOException("non salvato");
    }
}
