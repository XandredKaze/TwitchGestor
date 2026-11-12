package it.xandred.musicante;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Musica a schermo spento: tiene viva l'app mentre suona, con la notifica e i comandi sulla schermata
 * di blocco (indietro, play/pausa, avanti). I comandi li esegue il lettore nella pagina (MainActivity.control).
 */
public class PlayerService extends Service {
    private static final String CHANNEL = "musica";
    private static PlayerService instance;
    private static String title = "", artist = "";
    private static boolean playing;

    private MediaSession session;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    /** Il lettore ha cambiato brano o è andato in pausa/play. */
    static void update(Context ctx, String t, String a, boolean p) {
        title = t;
        artist = a;
        playing = p;
        if (instance != null) { instance.refresh(); return; }
        if (!p) return; // parte alla prima canzone (l'app è aperta: Android lo permette)
        Intent i = new Intent(ctx, PlayerService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, PlayerService.class));
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Musica in riproduzione", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "Musicante");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play"); }
            @Override public void onPause() { send("pause"); }
            @Override public void onSkipToNext() { send("next"); }
            @Override public void onSkipToPrevious() { send("prev"); }
        });
        session.setActive(true);
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musicante:play");
        wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "musicante:play");
    }

    private static void send(String cmd) {
        if (MainActivity.current != null) MainActivity.current.control(cmd);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String cmd = intent != null ? intent.getStringExtra("cmd") : null;
        if (cmd != null) send(cmd);
        refresh();
        return START_NOT_STICKY;
    }

    private PendingIntent action(String cmd, int code) {
        Intent i = new Intent(this, PlayerService.class).putExtra("cmd", cmd);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action button(int icon, String label, String cmd, int code) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, action(cmd, code)).build();
    }

    @SuppressWarnings("deprecation")
    private void refresh() {
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "Musicante Player" : title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title.isEmpty() ? "Musicante Player" : title)
            .setContentText(artist)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(button(android.R.drawable.ic_media_previous, "Indietro", "prev", 1))
            .addAction(playing ? button(android.R.drawable.ic_media_pause, "Pausa", "pause", 2) : button(android.R.drawable.ic_media_play, "Suona", "play", 2))
            .addAction(button(android.R.drawable.ic_media_next, "Avanti", "next", 3))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(1, n);
        // mentre suona il telefono non si addormenta (e il Wi-Fi resta acceso: la musica arriva dal Raspberry)
        if (playing) { if (!wake.isHeld()) wake.acquire(); if (!wifi.isHeld()) wifi.acquire(); }
        else { if (wake.isHeld()) wake.release(); if (wifi.isHeld()) wifi.release(); }
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (wake.isHeld()) wake.release();
        if (wifi.isHeld()) wifi.release();
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
