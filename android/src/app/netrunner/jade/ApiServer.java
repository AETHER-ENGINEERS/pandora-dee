package app.netrunner.jade;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Jade's HTTP API: a tiny GET-only server, JSON in (query string) and JSON out.
 *
 *   GET /v1/health                       public: {"ok":true,"app":"jade-vault","api":1}
 *   GET /v1/status | /v1/chat | /v1/history | /v1/chats | /v1/rituals | /v1/ritual   need the token
 *       (/v1/flows and /v1/flow, Jade Vault's names for the last two, still work)
 *
 * Java only parses the request line, headers and query string. The work happens in the page's JavaScript
 * (window.__jadeApi) so a message sent here goes through the same send() as one typed in the app and shows
 * up in the chat. JS hands the JSON answer back through Bridge.apiResult(id, status, body).
 * Auth: "Authorization: Bearer TOKEN" or "?token=TOKEN". Binds to 127.0.0.1 unless LAN access is on.
 */
public class ApiServer {
    static final int API = 1;
    static final int MAX_HEAD = 16 * 1024;
    static final int DEFAULT_WAIT_S = 300, MAX_WAIT_S = 1800;

    static class Pending {
        final CountDownLatch done = new CountDownLatch(1);
        volatile int status = 500;
        volatile String body = "{\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\"no answer\"}}";
    }

    /** What the server needs from the app: a way to run JavaScript in the page. */
    public interface Host { void js(String code); }

    private final Host host;
    private final ConcurrentHashMap<String, Pending> pending = new ConcurrentHashMap<String, Pending>();
    private final AtomicInteger seq = new AtomicInteger();
    private ExecutorService pool;
    private ServerSocket server;
    private boolean enabled, lan;
    private int port;
    private String token = "", error = "";

    public ApiServer(Host host) { this.host = host; }

    /** Start, restart or stop to match the settings. Returns the status as a JSON string. */
    public synchronized String configure(boolean on, int p, boolean allowLan, String tok) {
        if (p < 1024 || p > 65535) p = 8787;
        tok = tok == null ? "" : tok.trim();
        boolean same = server != null && !server.isClosed() && on == enabled && p == port && allowLan == lan;
        enabled = on; port = p; lan = allowLan; token = tok;   // a changed token applies at once, no restart needed
        if (same) return status();
        stopServer();
        error = "";
        if (!on) return status();
        if (tok.length() < 12) { error = "token too short (use at least 12 characters)"; return status(); }
        try {
            ServerSocket s = new ServerSocket();
            s.setReuseAddress(true);
            s.bind(new InetSocketAddress(allowLan ? InetAddress.getByName("0.0.0.0") : InetAddress.getByName("127.0.0.1"), p));
            server = s;
            pool = Executors.newCachedThreadPool();
            final ServerSocket fs = s;
            final ExecutorService fp = pool;
            Thread t = new Thread(new Runnable() {
                @Override
                public void run() { acceptLoop(fs, fp); }
            }, "jade-api");
            t.setDaemon(true);
            t.start();
        } catch (Exception e) {
            server = null;
            error = "cannot listen on port " + p + ": " + e.getMessage();
        }
        return status();
    }

    public synchronized void stop() { stopServer(); }

    private void stopServer() {
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        server = null;
        if (pool != null) { pool.shutdownNow(); pool = null; }
        for (Pending p : pending.values()) p.done.countDown();
        pending.clear();
    }

    public synchronized String status() {
        boolean up = server != null && !server.isClosed();
        StringBuilder b = new StringBuilder("{\"enabled\":").append(enabled).append(",\"listening\":").append(up)
                .append(",\"port\":").append(port).append(",\"lan\":").append(lan).append(",\"addresses\":[");
        if (up) {
            ArrayList<String> ips = new ArrayList<String>();
            ips.add("127.0.0.1");
            if (lan) ips.addAll(lanAddresses());
            for (int i = 0; i < ips.size(); i++) { if (i > 0) b.append(','); b.append(jsonStr("http://" + ips.get(i) + ":" + port)); }
        }
        return b.append("],\"error\":").append(jsonStr(error)).append('}').toString();
    }

    static ArrayList<String> lanAddresses() {
        ArrayList<String> out = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** Called by JS (Bridge.apiResult) with the finished answer for a request. */
    public void deliver(String id, int status, String body) {
        Pending p = pending.get(id);
        if (p == null) return;
        p.status = status;
        p.body = body == null ? "{}" : body;
        p.done.countDown();
    }

    // ---------------------------------------------------------------- server loop

    private void acceptLoop(ServerSocket s, ExecutorService p) {
        while (!s.isClosed()) {
            try {
                final Socket c = s.accept();
                p.execute(new Runnable() {
                    @Override
                    public void run() { handle(c); }
                });
            } catch (Exception e) {
                if (s.isClosed()) return;
            }
        }
    }

    private void handle(Socket c) {
        try {
            c.setSoTimeout(10000);
            c.setTcpNoDelay(true);
            Req r = readRequest(c.getInputStream());
            Res res = r == null ? Res.err(400, "bad_request", "could not read the request") : route(r);
            OutputStream out = c.getOutputStream();
            out.write(res.bytes(r != null && "OPTIONS".equals(r.method)));
            out.flush();
        } catch (Exception ignored) {
        } finally {
            try { c.close(); } catch (Exception ignored) { }
        }
    }

    static class Req {
        String method = "", path = "", rawQuery = "";
        Map<String, String> query = new LinkedHashMap<String, String>();
        Map<String, String> headers = new LinkedHashMap<String, String>();
    }

    static Req readRequest(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int state = 0, b;   // looking for \r\n\r\n
        while (state < 4 && (b = in.read()) >= 0) {
            buf.write(b);
            if (buf.size() > MAX_HEAD) return null;
            if ((b == '\r' && (state == 0 || state == 2)) || (b == '\n' && (state == 1 || state == 3))) state++;
            else state = b == '\r' ? 1 : 0;
        }
        if (state < 4) return null;
        String[] lines = new String(buf.toByteArray(), "ISO-8859-1").split("\r\n");
        String[] rl = lines[0].split(" ");
        if (rl.length < 2) return null;
        Req r = new Req();
        r.method = rl[0].toUpperCase();
        String target = rl[1];
        int q = target.indexOf('?');
        r.path = q < 0 ? target : target.substring(0, q);
        r.rawQuery = q < 0 ? "" : target.substring(q + 1);
        for (int i = 1; i < lines.length; i++) {
            int k = lines[i].indexOf(':');
            if (k > 0) r.headers.put(lines[i].substring(0, k).trim().toLowerCase(), lines[i].substring(k + 1).trim());
        }
        if (r.rawQuery.length() > 0) {
            for (String pair : r.rawQuery.split("&")) {
                if (pair.length() == 0) continue;
                int e = pair.indexOf('=');
                try {
                    String key = URLDecoder.decode(e < 0 ? pair : pair.substring(0, e), "UTF-8");
                    String val = e < 0 ? "" : URLDecoder.decode(pair.substring(e + 1), "UTF-8");
                    if (!r.query.containsKey(key)) r.query.put(key, val);
                } catch (Exception ignored) { }
            }
        }
        return r;
    }

    static class Res {
        final int status;
        final String body;
        Res(int status, String body) { this.status = status; this.body = body; }
        static Res err(int status, String code, String msg) {
            return new Res(status, "{\"ok\":false,\"api\":" + API + ",\"error\":{\"code\":" + jsonStr(code) + ",\"message\":" + jsonStr(msg) + "}}");
        }
        byte[] bytes(boolean headOnly) {
            String reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized"
                    : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large"
                    : status == 504 ? "Gateway Timeout" : status == 503 ? "Service Unavailable" : "Error";
            try {
                byte[] payload = status == 204 ? new byte[0] : body.getBytes("UTF-8");
                String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                        + "Content-Type: application/json; charset=utf-8\r\n"
                        + "Content-Length: " + payload.length + "\r\n"
                        + "Cache-Control: no-store\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Access-Control-Allow-Headers: Authorization, Content-Type\r\n"
                        + "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
                        + (status == 405 ? "Allow: GET, OPTIONS\r\n" : "")
                        + "Connection: close\r\n\r\n";
                byte[] h = head.getBytes("ISO-8859-1");
                byte[] all = new byte[h.length + payload.length];
                System.arraycopy(h, 0, all, 0, h.length);
                System.arraycopy(payload, 0, all, h.length, payload.length);
                return all;
            } catch (Exception e) {
                return ("HTTP/1.1 500 Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes();
            }
        }
    }

    private Res route(Req r) {
        if ("OPTIONS".equals(r.method)) return new Res(204, "");
        if (!"GET".equals(r.method)) return Res.err(405, "method_not_allowed", "Jade's API only accepts GET requests");
        String p = r.path.length() > 1 && r.path.endsWith("/") ? r.path.substring(0, r.path.length() - 1) : r.path;
        if (p.equals("/v1/health") || p.equals("/") || p.equals("/v1"))
            return new Res(200, "{\"ok\":true,\"app\":\"jade-vault\",\"api\":" + API + ",\"auth\":\"Authorization: Bearer <token> or ?token=<token>\","
                    + "\"endpoints\":[\"/v1/health\",\"/v1/status\",\"/v1/chat?message=...\",\"/v1/history\",\"/v1/chats\",\"/v1/rituals\",\"/v1/ritual?name=...\",\"/v1/flows\",\"/v1/flow?name=...\"]}");
        if (!(p.equals("/v1/status") || p.equals("/v1/chat") || p.equals("/v1/history") || p.equals("/v1/chats") || p.equals("/v1/rituals") || p.equals("/v1/ritual") || p.equals("/v1/flows") || p.equals("/v1/flow")))
            return Res.err(404, "not_found", "unknown endpoint " + p + ". Try /v1/health");
        if (!authorized(r)) return Res.err(401, "unauthorized", "missing or wrong token. Send Authorization: Bearer <token> or ?token=<token>");
        int wait = DEFAULT_WAIT_S;
        try { if (r.query.containsKey("timeout")) wait = Math.max(1, Math.min(MAX_WAIT_S, Integer.parseInt(r.query.get("timeout").trim()))); } catch (Exception ignored) { }
        String route = p.substring(4);
        String id = "r" + seq.incrementAndGet() + "-" + Long.toString(System.nanoTime(), 36);
        Pending pend = new Pending();
        pending.put(id, pend);
        try {
            StringBuilder o = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<String, String> e : r.query.entrySet()) {
                if (e.getKey().equals("token")) continue;
                if (!first) o.append(',');
                first = false;
                o.append(jsStr(e.getKey())).append(':').append(jsStr(e.getValue()));
            }
            o.append('}');
            final String code = "(function(){var id=" + jsStr(id) + ";if(window.__jadeApi){window.__jadeApi(id," + jsStr(route) + "," + o + ");}"
                    + "else{NetrunnerAndroid.apiResult(id,503,'{\"ok\":false,\"error\":{\"code\":\"not_ready\",\"message\":\"the app page is still loading\"}}');}})()";
            host.js(code);
            if (!pend.done.await(wait, TimeUnit.SECONDS))
                return Res.err(504, "timeout", "Jade was still working after " + wait + " s. She keeps going in the app; read the result later with /v1/history");
            return new Res(pend.status, pend.body);
        } catch (InterruptedException e) {
            return Res.err(503, "stopped", "the API server was stopped");
        } finally {
            pending.remove(id);
        }
    }

    private boolean authorized(Req r) {
        String tok;
        synchronized (this) { tok = token; }
        if (tok.length() < 12) return false;
        String given = r.query.get("token");
        String a = r.headers.get("authorization");
        if (a != null && a.regionMatches(true, 0, "Bearer ", 0, 7)) given = a.substring(7).trim();
        if (given == null) return false;
        try { return MessageDigest.isEqual(given.getBytes("UTF-8"), tok.getBytes("UTF-8")); } catch (Exception e) { return false; }
    }

    // ---------------------------------------------------------------- escaping

    /** A JSON string literal. */
    static String jsonStr(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 32 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    /** A JavaScript string literal that is safe for any content: everything but [A-Za-z0-9 _.-] becomes \\uXXXX. */
    static String jsStr(String s) {
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ' || c == '_' || c == '.' || c == '-') b.append(c);
            else b.append(String.format("\\u%04x", (int) c));
        }
        return b.append('\'').toString();
    }
}
