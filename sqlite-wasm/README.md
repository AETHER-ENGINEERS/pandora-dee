SQLite 3.53.4 for Jade Vault (embedded in index.html as gzip+base64, id="sqlite-wasm")

Built from the official amalgamation (sqlite3.c) with clang 18 for wasm32-wasip1 against a wasi-libc
sysroot, no Emscripten:
  clang --target=wasm32-wasip1 --sysroot=<wasi-sysroot> -Oz $(cat cflags.txt) -c sqlite3.c jvos.c
  wasm-ld crt1-reactor.o sqlite3.o jvos.o libc.a libm.a --no-entry --strip-all --gc-sections
          $(sed 's/^/--export=/' exports.txt) -o sqlite3.min.wasm
jvos.c is the tiny OS layer (SQLITE_OS_OTHER): no file I/O at all. Databases live in memory and are
loaded/saved as whole vault files with sqlite3_deserialize / sqlite3_serialize, so .db files are normal
SQLite files you can open anywhere. The only imports are WASI clock_time_get and random_get.
