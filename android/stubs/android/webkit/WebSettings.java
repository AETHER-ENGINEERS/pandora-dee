package android.webkit;
public abstract class WebSettings {
  public abstract void setJavaScriptEnabled(boolean b);
  public abstract void setDomStorageEnabled(boolean b);
  public abstract void setDatabaseEnabled(boolean b);
  public abstract void setAllowFileAccess(boolean b);
  public abstract void setAllowFileAccessFromFileURLs(boolean b);
  public abstract void setAllowUniversalAccessFromFileURLs(boolean b);
  public abstract void setMediaPlaybackRequiresUserGesture(boolean b);
  public abstract void setMixedContentMode(int m);
  public abstract void setTextZoom(int z);
}
