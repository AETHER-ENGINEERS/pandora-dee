package app.netrunner.jade;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.OutputStream;
import java.util.Locale;

/**
 * Pi Netrunner (Jade Cat edition) — a thin native shell around the single-page app in assets/index.html.
 * The page is loaded from file:// with universal file access, so it can call Ollama / Ollaya on the LAN
 * without CORS setup. Native extras exposed to JS as window.NetrunnerAndroid:
 *   speak(uid, text, pitch, rate) / stop()  -> Android TextToSpeech, events back via window.__jadeTTS(ev, uid)
 *   notify(title, body) / requestNotifications()
 */
public class MainActivity extends Activity implements ApiServer.Host {
    static final int REQ_FILE = 7, REQ_NOTIFY = 9, REQ_SAVE = 11;
    static final String CHANNEL = "netrunner";
    static final int BG = 0xff040807;

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    TextToSpeech tts;
    boolean ttsReady;
    int notifyId = 100;
    String pendingSaveText, pendingSaveName;
    ApiServer api;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(BG);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(0); // MIXED_CONTENT_ALWAYS_ALLOW
        s.setTextZoom(100);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        // keep the page's JS at full priority when the app is not visible, so the agent loop keeps going
        if (Build.VERSION.SDK_INT >= 26) { try { web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false); } catch (Exception ignored) { } }
        api = new ApiServer(this);
        web.addJavascriptInterface(new Bridge(this), "NetrunnerAndroid");

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS) { ttsReady = false; return; }
                int r = tts.setLanguage(Locale.UK);
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.getDefault());
                tts.setOnUtteranceProgressListener(new Progress());
                ttsReady = true;
            }
        });

        if (state != null) web.restoreState(state);
        if (state == null || web.getUrl() == null) web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        try { stopService(new Intent(this, KeepAliveService.class)); } catch (Exception ignored) { }
        if (api != null) api.stop();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return window.__androidBack?window.__androidBack():false}catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String handled) {
                        if (!"true".equals(handled)) finish();
                    }
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SAVE) {
            String name = pendingSaveName, text = pendingSaveText;
            pendingSaveName = null; pendingSaveText = null;
            if (resultCode != -1 /* RESULT_OK */ || data == null || data.getData() == null || text == null) { js("window.__jadeSaved&&window.__jadeSaved(false,'cancelled')"); return; }
            try {
                OutputStream out = getContentResolver().openOutputStream(data.getData());
                out.write(text.getBytes("UTF-8"));
                out.close();
                js("window.__jadeSaved&&window.__jadeSaved(true," + quote(name == null ? "file" : name) + ")");
            } catch (Exception e) {
                js("window.__jadeSaved&&window.__jadeSaved(false," + quote(String.valueOf(e.getMessage())) + ")");
            }
            return;
        }
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(pickedFiles(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** The files a picker returned. With EXTRA_ALLOW_MULTIPLE, galleries (Google Photos, Samsung Gallery) put even a
     *  single pick in ClipData and leave getData() empty, which parseResult alone reads as "nothing picked". */
    static Uri[] pickedFiles(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            Uri[] out = new Uri[clip.getItemCount()];
            for (int i = 0; i < out.length; i++) out[i] = clip.getItemAt(i).getUri();
            return out;
        }
        return WebChromeClient.FileChooserParams.parseResult(resultCode, data);
    }

    @Override
    public void js(final String code) {
        web.post(new Runnable() {
            @Override
            public void run() { web.evaluateJavascript(code, null); }
        });
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '\\') b.append('\\').append(c);
            else if (c < 32) b.append(' ');
            else b.append(c);
        }
        return b.append('\'').toString();
    }

    class Progress extends UtteranceProgressListener {
        @Override public void onStart(String id) { js("window.__jadeTTS&&window.__jadeTTS('start'," + quote(id) + ")"); }
        @Override public void onDone(String id) { js("window.__jadeTTS&&window.__jadeTTS('done'," + quote(id) + ")"); }
        @Override public void onError(String id) { js("window.__jadeTTS&&window.__jadeTTS('error'," + quote(id) + ")"); }
    }

    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u == null ? null : u.getScheme();
            if (!req.isForMainFrame() || scheme == null || "file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)) return false;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, u);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) { }
            return true;
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent i = params.createIntent();
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(i, REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    /** Exposed to JS as window.NetrunnerAndroid. Public + static so WebView's reflection can always call it. */
    public static class Bridge {
        private final MainActivity a;
        public Bridge(MainActivity a) { this.a = a; }

        @JavascriptInterface
        public boolean speak(String uid, String text, double pitch, double rate) { return a.nativeSpeak(uid, text, pitch, rate); }

        @JavascriptInterface
        public void stop() { if (a.tts != null) a.tts.stop(); }

        @JavascriptInterface
        public boolean ttsAvailable() { return a.ttsReady; }

        @JavascriptInterface
        public void openTtsSettings() { a.openTtsSettings(); }

        @JavascriptInterface
        public void requestNotifications() { a.requestNotifications(); }

        @JavascriptInterface
        public void notify(String title, String body) { a.showNotification(title, body); }

        /** Ask the user where to save a file (system "Save as" dialog), then write text to it. Result via window.__jadeSaved(ok, msg). */
        @JavascriptInterface
        public void saveFile(String name, String mime, String text) { a.saveFile(name, mime, text); }

        /** Start/update (on=true) or stop the foreground service that keeps Jade running in the background. */
        @JavascriptInterface
        public boolean keepAlive(boolean on, String text) { return a.keepAlive(on, text); }

        @JavascriptInterface
        public boolean batteryOptimized() { return a.batteryOptimized(); }

        @JavascriptInterface
        public void openBatterySettings() { a.openBatterySettings(); }

        /** Start/restart/stop Jade's HTTP API to match the settings. Returns its status as JSON text. */
        @JavascriptInterface
        public String apiConfigure(boolean enabled, int port, boolean lan, String token) { return a.api.configure(enabled, port, lan, token); }

        @JavascriptInterface
        public String apiStatus() { return a.api.status(); }

        /** JS hands back the finished answer for an API request (id from window.__jadeApi). */
        @JavascriptInterface
        public void apiResult(String id, int status, String body) { a.api.deliver(id, status, body); }
    }

    void saveFile(final String name, final String mime, final String text) {
        pendingSaveName = name; pendingSaveText = text;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime == null || mime.length() == 0 ? "application/json" : mime);
                    i.putExtra(Intent.EXTRA_TITLE, name == null ? "jade-vault.json" : name);
                    startActivityForResult(i, REQ_SAVE);
                } catch (Exception e) {
                    pendingSaveText = null;
                    js("window.__jadeSaved&&window.__jadeSaved(false," + quote(String.valueOf(e.getMessage())) + ")");
                }
            }
        });
    }

    boolean keepAlive(boolean on, String text) {
        try {
            Intent i = new Intent(this, KeepAliveService.class);
            if (!on) { stopService(i); return true; }
            i.putExtra("text", text == null ? "" : text);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            return true;
        } catch (Exception e) {
            return false;   // e.g. Android 12+ refuses to start it while the app is already in the background
        }
    }

    boolean batteryOptimized() {
        try {
            if (Build.VERSION.SDK_INT < 23) return false;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            return pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) { return false; }
    }

    void openBatterySettings() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", Uri.parse("package:" + getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try { Intent i = new Intent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); } catch (Exception ignored) { }
                }
            }
        });
    }

    boolean nativeSpeak(String uid, String text, double pitch, double rate) {
        if (!ttsReady || tts == null) { js("window.__jadeTTS&&window.__jadeTTS('error'," + quote(uid) + ")"); return false; }
        float p = (float) Math.max(0.5, Math.min(2.0, pitch > 0 ? pitch : 1.0));
        float r = (float) Math.max(0.5, Math.min(2.0, rate > 0 ? rate : 1.0));
        tts.setPitch(p);
        tts.setSpeechRate(r);
        int res = tts.speak(text, TextToSpeech.QUEUE_ADD, null, uid);
        if (res != TextToSpeech.SUCCESS) { js("window.__jadeTTS&&window.__jadeTTS('error'," + quote(uid) + ")"); return false; }
        return true;
    }

    void openTtsSettings() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try { Intent i = new Intent("android.settings.SETTINGS"); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); } catch (Exception ignored) { }
                }
            }
        });
    }

    void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFY); }
            });
        }
    }

    void showNotification(String title, String body) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Scheduled prompts", NotificationManager.IMPORTANCE_DEFAULT));
                b = new Notification.Builder(this, CHANNEL);
            } else {
                b = new Notification.Builder(this);
            }
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.setSmallIcon(getApplicationInfo().icon)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setColor(0xff1fe5a5)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            nm.notify(notifyId++, b.build());
        } catch (Exception ignored) { }
    }
}
