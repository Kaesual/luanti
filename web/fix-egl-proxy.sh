#!/bin/bash
# Post-build patches for the OffscreenCanvas-based web build.
#
# Patch 1 (EGL proxy):
#   Workaround for Emscripten bug:
#   https://github.com/emscripten-core/emscripten/issues/24792
#   EGL calls are hardcoded to proxy to main thread, which breaks
#   OFFSCREENCANVAS_SUPPORT (canvas lives in the worker, not main thread).
#
# Patch 2 (preserveDrawingBuffer):
#   Luanti's screenshot path calls glReadPixels on the default framebuffer
#   on the next frame's input-processing tick. Without preserveDrawingBuffer
#   the WebGL drawing buffer is cleared after compositing, so in-game F12
#   screenshots come back black. Emscripten's EGL bridge doesn't expose this
#   WebGL-only attribute, so we inject it into the EGL.contextAttributes
#   literal it uses to call getContext().

set -e

# Allow overriding the path to luanti.js
LUANTI_JS="${1:-build-web/output/luanti.js}"

# If it doesn't exist at the provided path, try output/luanti.js (relative to build-web)
if [ ! -f "$LUANTI_JS" ] && [ -f "output/luanti.js" ]; then
    LUANTI_JS="output/luanti.js"
fi

if [ ! -f "$LUANTI_JS" ]; then
    echo "Error: $LUANTI_JS not found" >&2
    exit 1
fi

echo "Applying post-build patches to $LUANTI_JS..."

# Backup original file (once, before any patches)
cp "$LUANTI_JS" "$LUANTI_JS.backup"

# ---------------------------------------------------------------------------
# Patch 1: EGL proxy workaround
# ---------------------------------------------------------------------------
echo "  [1/2] EGL proxy workaround..."

# Count matches of the proxy guard at the top of each _egl* function.
EGL_PATCH_COUNT=$(perl -0777 -ne 'my $c = () = /(function\s+_egl[a-zA-Z0-9_]+\([^)]*\)\s*\{\s*if\s*\(ENVIRONMENT_IS_PTHREAD\)[^;]+;)/gs; print $c;' "$LUANTI_JS")
[ -z "$EGL_PATCH_COUNT" ] && EGL_PATCH_COUNT=0

if [ "$EGL_PATCH_COUNT" -eq 0 ]; then
    echo "  Error: No EGL proxy calls found to patch. Either:" >&2
    echo "    1. Emscripten fixed the bug (https://github.com/emscripten-core/emscripten/issues/24792)" >&2
    echo "       and this patch is no longer needed, or" >&2
    echo "    2. The generated code structure has changed." >&2
    echo "  Check $LUANTI_JS manually." >&2
    exit 1
fi

# Comment out the if (ENVIRONMENT_IS_PTHREAD) block in all _egl functions.
perl -i -0777 -pe 's/(function\s+_egl[a-zA-Z0-9_]+\([^)]*\)\s*\{\s*)(if\s*\(ENVIRONMENT_IS_PTHREAD\)[^;]+;)/$1\/*$2*\//gs' "$LUANTI_JS"

echo "  Patched $EGL_PATCH_COUNT EGL function(s)"

# ---------------------------------------------------------------------------
# Patch 2: preserveDrawingBuffer injection
# ---------------------------------------------------------------------------
echo "  [2/2] preserveDrawingBuffer injection..."

PRESERVE_TARGET='contextAttributes:{alpha:false,depth:false,stencil:false,antialias:false}'
PRESERVE_REPLACEMENT='contextAttributes:{alpha:false,depth:false,stencil:false,antialias:false,preserveDrawingBuffer:true}'

# Expect exactly one EGL.contextAttributes initializer. If the literal is
# absent or duplicated, the underlying code shape changed and we should not
# silently push out a build with black in-game screenshots.
PRESERVE_COUNT=$(grep -Fo "$PRESERVE_TARGET" "$LUANTI_JS" | wc -l)
if [ "$PRESERVE_COUNT" -ne 1 ]; then
    echo "  Error: Expected exactly 1 occurrence of the EGL.contextAttributes" >&2
    echo "  initializer, found $PRESERVE_COUNT. The pattern in Emscripten's" >&2
    echo "  library_egl.js may have changed. Searched for:" >&2
    echo "    $PRESERVE_TARGET" >&2
    exit 1
fi

# Use | as sed delimiter to avoid escaping the curly braces / colons.
sed -i "s|$PRESERVE_TARGET|$PRESERVE_REPLACEMENT|" "$LUANTI_JS"

# Verify the patch actually landed (defensive — should never fail given the
# count check above passed).
if ! grep -Fq "preserveDrawingBuffer:true" "$LUANTI_JS"; then
    echo "  Error: preserveDrawingBuffer:true not present after sed; patch failed." >&2
    exit 1
fi

echo "  Patched EGL.contextAttributes to include preserveDrawingBuffer:true"

echo "Post-build patches applied successfully!"
echo "Backup saved to $LUANTI_JS.backup"
