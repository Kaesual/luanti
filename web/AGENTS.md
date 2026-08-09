# Luanti web build agent guide

## Scope

These instructions apply only to the browser build under `web/`. Keep
browser-specific changes in this directory whenever possible and avoid
unrelated edits elsewhere in the engine tree. If a change outside `web/` is
unavoidable, keep it minimal, portable and separately explained.

## Entry points

- `README.md` provides background on the browser build.
- `01-build-luanti.sh` compiles the engine with Emscripten.
- `02-build-www.sh` assembles the browser bundle after compilation.
- `03-build-docker.sh` builds the nginx image that serves the bundle with the
  required browser headers; run that image on port 8080 for a browser test.
- `emscripten-toolchain.cmake` owns the WebAssembly compiler and linker flags.
- `shell.html`, `pre.js`, `luanti-init.js` and `socket-proxy-shared.js` form the
  browser runtime integration.

Run the build scripts from the repository root:

```bash
./web/01-build-luanti.sh          # Release build
./web/01-build-luanti.sh Debug    # Debug build
./web/02-build-www.sh
./web/03-build-docker.sh
docker run --rm -p 8080:8080 luanti-web-server:latest
```

`build-web/` is generated and ignored by Git. Do not commit its contents. A
change limited to HTML or JavaScript assembly may only need
`02-build-www.sh`, provided compiled output already exists; changes to C++, the
toolchain or compile flags require `01-build-luanti.sh` first.

## Browser-build invariants

- Threaded WebAssembly and `SharedArrayBuffer` require cross-origin isolation.
  Preserve the COOP/COEP headers in the serving configuration.
- Keep Emscripten compile flags, link flags and runtime assumptions aligned.
  Changes to memory, threading, filesystem, graphics or Asyncify settings need
  a full build and browser smoke test.
- Keep the filenames and paths emitted by the build scripts aligned with the
  assets loaded by the shell and initialization JavaScript.
- Treat the shared socket proxy as a protocol boundary. Check both connection
  setup and datagram flow when changing it.
- Avoid broad formatting or mechanical changes in upstream-derived files.

## Validation

Validate in proportion to the change:

- Run `bash -n web/*.sh` after editing shell scripts.
- For assembly-only changes, run `./web/02-build-www.sh`, build and run the
  serving image, and inspect the browser console.
- For toolchain or compiled-code changes, run `./web/01-build-luanti.sh` with an
  appropriate build type, then assemble and serve the result.
- Exercise the affected browser flow, including resize, input, persistence or
  networking when relevant.

The full Emscripten build is expensive. If it cannot reasonably be run, say
exactly which narrower checks passed and what remains unverified.
