/* Minimal OS layer for SQLite in the browser (SQLITE_OS_OTHER=1).
   Databases are opened in memory and loaded/saved as bytes with sqlite3_deserialize/sqlite3_serialize,
   so the default VFS only has to provide randomness, time and sleep (memdb and :memory: use those). */
#include "sqlite3.h"
#include <string.h>
#include <stdlib.h>
#include <time.h>
static int jvOpen(sqlite3_vfs *v, const char *z, sqlite3_file *f, int flags, int *pOut) { (void)v; (void)z; (void)flags; (void)pOut; f->pMethods = 0; return SQLITE_CANTOPEN; }
static int jvDelete(sqlite3_vfs *v, const char *z, int sync) { (void)v; (void)z; (void)sync; return SQLITE_OK; }
static int jvAccess(sqlite3_vfs *v, const char *z, int flags, int *pRes) { (void)v; (void)z; (void)flags; *pRes = 0; return SQLITE_OK; }
static int jvFullPathname(sqlite3_vfs *v, const char *z, int n, char *out) { (void)v; sqlite3_snprintf(n, out, "%s", z); return SQLITE_OK; }
static int jvRandomness(sqlite3_vfs *v, int n, char *z) { (void)v; arc4random_buf(z, (size_t)n); return n; }
static int jvSleep(sqlite3_vfs *v, int us) { (void)v; return us; }
static int jvCurrentTimeInt64(sqlite3_vfs *v, sqlite3_int64 *t) {
  (void)v; struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts);
  *t = (sqlite3_int64)ts.tv_sec * 1000 + ts.tv_nsec / 1000000 + 210866760000000LL; return SQLITE_OK;
}
static int jvCurrentTime(sqlite3_vfs *v, double *t) { sqlite3_int64 i; jvCurrentTimeInt64(v, &i); *t = i / 86400000.0; return SQLITE_OK; }
static int jvGetLastError(sqlite3_vfs *v, int n, char *z) { (void)v; (void)n; (void)z; return 0; }
static sqlite3_vfs jvVfs = { 2, 0, 1024, 0, "jv", 0, jvOpen, jvDelete, jvAccess, jvFullPathname, 0, 0, 0, 0,
  jvRandomness, jvSleep, jvCurrentTime, jvGetLastError, jvCurrentTimeInt64, 0, 0, 0 };
int sqlite3_os_init(void) { return sqlite3_vfs_register(&jvVfs, 1); }
int sqlite3_os_end(void) { return SQLITE_OK; }
/* tiny helpers so JS doesn't need to know struct layouts */
void *jv_malloc(int n) { return malloc((size_t)n); }
void jv_free(void *p) { free(p); }
