package android.webkit;
public class WebChromeClient {
  public abstract static class FileChooserParams {
    public abstract android.content.Intent createIntent();
    public static android.net.Uri[] parseResult(int resultCode, android.content.Intent data) { throw new RuntimeException(); }
  }
  public boolean onShowFileChooser(WebView v, ValueCallback<android.net.Uri[]> cb, FileChooserParams p) { throw new RuntimeException(); }
}
