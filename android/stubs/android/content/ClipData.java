package android.content;
public class ClipData {
  public static class Item { public android.net.Uri getUri() { throw new RuntimeException(); } }
  public int getItemCount() { throw new RuntimeException(); }
  public Item getItemAt(int index) { throw new RuntimeException(); }
}
