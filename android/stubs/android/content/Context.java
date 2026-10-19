package android.content;
public abstract class Context {
  public static final String NOTIFICATION_SERVICE = "notification";
  public static final String POWER_SERVICE = "power";
  public Object getSystemService(String name) { throw new RuntimeException(); }
  public int checkSelfPermission(String p) { throw new RuntimeException(); }
  public android.content.pm.ApplicationInfo getApplicationInfo() { throw new RuntimeException(); }
  public ContentResolver getContentResolver() { throw new RuntimeException(); }
  public String getPackageName() { throw new RuntimeException(); }
  public ComponentName startForegroundService(Intent i) { throw new RuntimeException(); }
  public ComponentName startService(Intent i) { throw new RuntimeException(); }
  public boolean stopService(Intent i) { throw new RuntimeException(); }
}
