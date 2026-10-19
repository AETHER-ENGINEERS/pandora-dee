import app.netrunner.jade.ApiServer;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.regex.*;

/** Runs Jade's API server on the plain JDK with a fake page: the "JS" answers like window.__jadeApi would. */
public class ApiServerTest {
    static int fails = 0;
    static void ok(boolean c, String m) { System.out.println((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

    static String[] get(String url, String method, String auth) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        if (auth != null) c.setRequestProperty("Authorization", auth);
        c.setConnectTimeout(3000); c.setReadTimeout(8000);
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = "";
        if (in != null) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); body = o.toString("UTF-8"); }
        return new String[]{String.valueOf(code), body, String.valueOf(c.getHeaderField("Access-Control-Allow-Origin")), String.valueOf(c.getHeaderField("Content-Type"))};
    }

    public static void main(String[] a) throws Exception {
        final ApiServer[] box = new ApiServer[1];
        final List<String> calls = Collections.synchronizedList(new ArrayList<String>());
        ApiServer.Host host = new ApiServer.Host() {
            public void js(final String code) {
                calls.add(code);
                Matcher m = Pattern.compile("var id='([^']*)'").matcher(code);
                if (!m.find()) return;
                final String id = m.group(1);
                final boolean slow = code.contains("slow");
                new Thread(new Runnable() { public void run() {
                    try { if (slow) Thread.sleep(3000); } catch (Exception e) { }
                    box[0].deliver(id, 200, "{\"ok\":true,\"echo\":true}");
                } }).start();
            }
        };
        ApiServer s = new ApiServer(host); box[0] = s;
        int port = 18787;
        String st = s.configure(true, port, false, "short");
        ok(st.contains("\"listening\":false") && st.contains("token too short"), "short token refused: " + st);
        st = s.configure(true, port, false, "jv_test_token_123456");
        ok(st.contains("\"listening\":true") && st.contains("http://127.0.0.1:" + port), "listening on loopback: " + st);
        String base = "http://127.0.0.1:" + port;
        String[] r = get(base + "/v1/health", "GET", null);
        ok(r[0].equals("200") && r[1].contains("\"app\":\"jade-vault\"") && r[3].startsWith("application/json") && r[2].equals("*"), "health is public JSON with CORS: " + r[1].substring(0, 40));
        r = get(base + "/v1/chat?message=hi", "GET", null);
        ok(r[0].equals("401") && r[1].contains("\"code\":\"unauthorized\""), "no token -> 401 JSON");
        r = get(base + "/v1/chat?message=hi&token=nope", "GET", null);
        ok(r[0].equals("401"), "wrong token -> 401");
        calls.clear();
        r = get(base + "/v1/chat?message=h%C3%A9llo%20%22w%22%0A%E2%9C%93%27x&session=new", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("200") && r[1].contains("\"echo\":true"), "bearer header works, JS answer passed through: " + r[1]);
        String code = calls.isEmpty() ? "" : calls.get(0);
        ok(code.contains("window.__jadeApi(") && code.contains("'chat'") && code.contains("'message':'h\\u00e9llo \\u0022w\\u0022\\u000a\\u2713\\u0027x'".replace("'message'", "'message'")) && !code.contains("token"), "query reaches JS as escaped literals, token stripped: " + code);
        r = get(base + "/v1/status?token=jv_test_token_123456", "GET", null);
        ok(r[0].equals("200"), "?token= works");
        calls.clear();
        r = get(base + "/v1/flows", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("200") && calls.size() == 1 && calls.get(0).contains("'flows'"), "/v1/flows reaches the page");
        calls.clear();
        r = get(base + "/v1/flow?name=Daily%20digest&input=%7B%22x%22%3A1%7D", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("200") && calls.get(0).contains("'flow'") && calls.get(0).contains("'name':'Daily digest'") && calls.get(0).contains("'input':'\\u007b\\u0022x\\u0022\\u003a1\\u007d'"), "/v1/flow passes the name and the JSON input: " + (calls.isEmpty() ? "" : calls.get(0)));
        r = get(base + "/v1/health", "GET", null);
        ok(r[1].contains("/v1/flows") && r[1].contains("/v1/flow?name="), "health lists the flow endpoints");
        r = get(base + "/v1/flowz", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("404"), "a near-miss path is still 404");
        r = get(base + "/v1/chat?message=x", "POST", "Bearer jv_test_token_123456");
        ok(r[0].equals("405") && r[1].contains("\"ok\":false"), "POST -> 405 JSON");
        r = get(base + "/v1/nope", "GET", null);
        ok(r[0].equals("404") && r[1].contains("not_found"), "unknown path -> 404 JSON");
        r = get(base + "/v1/chat", "OPTIONS", null);
        ok(r[0].equals("204"), "OPTIONS preflight -> 204");
        long t0 = System.currentTimeMillis();
        r = get(base + "/v1/chat?message=slow&timeout=1", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("504") && r[1].contains("\"code\":\"timeout\"") && System.currentTimeMillis() - t0 < 2500, "slow answer -> 504 timeout JSON after 1 s");
        // concurrent requests are all answered
        final int[] good = {0};
        List<Thread> ts = new ArrayList<Thread>();
        for (int i = 0; i < 6; i++) { Thread t = new Thread(new Runnable() { public void run() { try { String[] x = get(base + "/v1/status", "GET", "Bearer jv_test_token_123456"); if (x[0].equals("200")) synchronized (good) { good[0]++; } } catch (Exception e) { } } }); ts.add(t); t.start(); }
        for (Thread t : ts) t.join();
        ok(good[0] == 6, "6 concurrent requests answered: " + good[0]);
        st = s.configure(true, port, false, "jv_other_token_654321");
        r = get(base + "/v1/status", "GET", "Bearer jv_test_token_123456");
        ok(r[0].equals("401"), "changing the token takes effect without a restart");
        s.configure(false, port, false, "x");
        boolean refused = false; try { get(base + "/v1/health", "GET", null); } catch (Exception e) { refused = true; }
        ok(refused, "stopped server refuses connections");
        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
