package android.app;
import android.content.Context;
public class Notification {
  public abstract static class Style { }
  public static class BigTextStyle extends Style { public BigTextStyle() { throw new RuntimeException(); } public BigTextStyle bigText(CharSequence c) { throw new RuntimeException(); } }
  public static class Builder {
    public Builder(Context c, String channel) { throw new RuntimeException(); }
    public Builder(Context c) { throw new RuntimeException(); }
    public Builder setSmallIcon(int icon) { throw new RuntimeException(); }
    public Builder setContentTitle(CharSequence t) { throw new RuntimeException(); }
    public Builder setContentText(CharSequence t) { throw new RuntimeException(); }
    public Builder setStyle(Style s) { throw new RuntimeException(); }
    public Builder setColor(int c) { throw new RuntimeException(); }
    public Builder setAutoCancel(boolean b) { throw new RuntimeException(); }
    public Builder setContentIntent(PendingIntent p) { throw new RuntimeException(); }
    public Builder setOngoing(boolean b) { throw new RuntimeException(); }
    public Builder setOnlyAlertOnce(boolean b) { throw new RuntimeException(); }
    public Builder setShowWhen(boolean b) { throw new RuntimeException(); }
    public Notification build() { throw new RuntimeException(); }
  }
}
