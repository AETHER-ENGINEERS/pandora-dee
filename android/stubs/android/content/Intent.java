package android.content;
public class Intent {
  public static final String ACTION_VIEW = "android.intent.action.VIEW";
  public static final String ACTION_CREATE_DOCUMENT = "android.intent.action.CREATE_DOCUMENT";
  public static final String CATEGORY_OPENABLE = "android.intent.category.OPENABLE";
  public static final String EXTRA_TITLE = "android.intent.extra.TITLE";
  public static final String EXTRA_ALLOW_MULTIPLE = "android.intent.extra.ALLOW_MULTIPLE";
  public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
  public static final int FLAG_ACTIVITY_SINGLE_TOP = 0x20000000;
  public static final int FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
  public Intent(String action) { throw new RuntimeException(); }
  public Intent(String action, android.net.Uri uri) { throw new RuntimeException(); }
  public Intent(Context c, Class<?> cls) { throw new RuntimeException(); }
  public Intent addFlags(int f) { throw new RuntimeException(); }
  public Intent addCategory(String c) { throw new RuntimeException(); }
  public Intent setType(String t) { throw new RuntimeException(); }
  public Intent putExtra(String name, boolean value) { throw new RuntimeException(); }
  public Intent putExtra(String name, String value) { throw new RuntimeException(); }
  public String getStringExtra(String name) { throw new RuntimeException(); }
  public android.net.Uri getData() { throw new RuntimeException(); }
}
