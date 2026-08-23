#!/usr/bin/env bash
# Simple script to build Luanti for web using Docker
# This follows the emscripten/emsdk pattern of mounting source directory
#
# Usage: ./01-build-luanti.sh [BUILD_TYPE]
#   BUILD_TYPE: Release (default), Debug, MinSizeRel, or RelWithDebInfo

set -e

BUILDER_IMAGE="luanti-web-builder:emscripten-6.0.8"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse build type parameter (default: Release)
BUILD_TYPE="${1:-Release}"

# Validate build type
case "$BUILD_TYPE" in
    Release|Debug|MinSizeRel|RelWithDebInfo)
        # Valid build type
        ;;
    *)
        echo -e "${RED}Error: Invalid build type '${BUILD_TYPE}'${NC}"
        echo ""
        echo "Valid build types:"
        echo -e "  ${GREEN}Release${NC}        - Maximum performance (default)"
        echo -e "  ${BLUE}MinSizeRel${NC}    - Minimum binary size"
        echo -e "  ${BLUE}RelWithDebInfo${NC} - Optimized with debug symbols"
        echo -e "  ${YELLOW}Debug${NC}          - No optimization, full debug info"
        echo ""
        echo "Usage: $0 [BUILD_TYPE]"
        echo "Example: $0 MinSizeRel"
        exit 1
        ;;
esac

echo -e "${GREEN}=== Luanti Web Build with Docker ===${NC}"
echo ""

# Get script directory (should be /web)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Project root: $PROJECT_ROOT"
echo "Build output: $PROJECT_ROOT/build-web"
echo -e "Build type:   ${GREEN}${BUILD_TYPE}${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker not found!${NC}"
    echo "Please install Docker first."
    exit 1
fi

echo -e "${YELLOW}Building Emscripten 6.0.8 build image...${NC}"
docker build -f "${SCRIPT_DIR}/Dockerfile" -t "$BUILDER_IMAGE" "$PROJECT_ROOT"
echo ""

echo -e "${YELLOW}Building Luanti with Emscripten 6.0.8...${NC}"
echo "This may take a while on first build."
echo ""

# Every invocation is a full compiler build. Remove all host-side output so
# objects and generated files from a different SDK can never be reused.
rm -rf "$PROJECT_ROOT/build-web"

# Run the build in container
# Only mount project root - build-web will be inside it
docker run \
    --rm \
    -v "${PROJECT_ROOT}:/src" \
    -u $(id -u):$(id -g) \
    -e BUILD_TYPE="${BUILD_TYPE}" \
    "$BUILDER_IMAGE" \
    bash -c "
        set -e
        echo '=== Build Environment ==='
        EMCC_VERSION=\"\$(emcc --version | head -n1)\"
        echo \"\$EMCC_VERSION\"
        if ! printf '%s\\n' \"\$EMCC_VERSION\" | grep -Eq '\\) 6\\.0\\.8( |\\()'; then
            echo \"Error: expected Emscripten 6.0.8, got: \$EMCC_VERSION\" >&2
            exit 1
        fi
        echo \"Ninja: \$(ninja --version)\"
        echo \"Build type: \${BUILD_TYPE}\"
        echo ''
        
        # Build in /src/build-web (which is mounted from host)
        mkdir -p /src/build-web
        cd /src/build-web
        
        echo '=== Configuring CMake ==='
        emcmake cmake /src \
            -DCMAKE_BUILD_TYPE=\${BUILD_TYPE} \
            -DCMAKE_TOOLCHAIN_FILE=/src/web/emscripten-toolchain.cmake \
            -DBUILD_CLIENT=TRUE \
            -DBUILD_SERVER=FALSE \
            -DBUILD_UNITTESTS=FALSE \
            -DBUILD_BENCHMARKS=FALSE \
            -DENABLE_GETTEXT=FALSE \
            -DENABLE_SOUND=TRUE \
            -DENABLE_CURL=FALSE \
            -DRUN_IN_PLACE=TRUE \
            -GNinja
        
        echo ''
        echo '=== Building (this will take a while) ==='
        cmake --build . --parallel \$(nproc)

        echo ''
        echo '=== Generated luanti artifact inventory ==='
        find bin -maxdepth 1 -type f -name 'luanti*' -printf '%f\\n' | sort > /tmp/luanti-inventory
        cat /tmp/luanti-inventory
        printf '%s\\n' luanti.data luanti.html luanti.js luanti.wasm | sort > /tmp/luanti-required
        printf '%s\\n' luanti.data luanti.html luanti.js luanti.wasm luanti.wasm.map | sort > /tmp/luanti-allowed
        if ! comm -23 /tmp/luanti-required /tmp/luanti-inventory | grep -q .; then :; else
            echo 'Error: required generated luanti artifact is missing:' >&2
            comm -23 /tmp/luanti-required /tmp/luanti-inventory >&2
            exit 1
        fi
        if comm -13 /tmp/luanti-allowed /tmp/luanti-inventory | grep -q .; then
            echo 'Error: unclassified generated luanti artifact(s):' >&2
            comm -13 /tmp/luanti-allowed /tmp/luanti-inventory >&2
            exit 1
        fi
        
        echo ''
        echo '=== Preparing output ==='
        mkdir -p /src/build-web/output
        
        # Copy Emscripten-generated files
        if [ -f bin/luanti.html ]; then
            cp bin/luanti.html /src/build-web/output/index.html
            echo 'Copied luanti.html -> index.html'
        fi
        if [ -f bin/luanti.js ]; then
            cp bin/luanti.js /src/build-web/output/
            echo 'Copied luanti.js'
        fi
        if [ -f bin/luanti.wasm ]; then
            cp bin/luanti.wasm /src/build-web/output/
            echo 'Copied luanti.wasm'
        fi
        if [ -f bin/luanti.data ]; then
            cp bin/luanti.data /src/build-web/output/
            echo 'Copied luanti.data (preloaded assets)'
        fi
        if [ -f bin/luanti.wasm.map ]; then
            cp bin/luanti.wasm.map /src/build-web/output/
            echo 'Copied luanti.wasm.map (preloaded assets)'
        fi
        
        echo ''
        echo '=== Build Complete ==='
        ls -lh /src/build-web/output/ | tail -n +2
        
        # Apply EGL proxy workaround
        echo ''
        echo '=== Applying EGL Workaround ==='
        bash /src/web/fix-egl-proxy.sh
        node --check /src/build-web/output/luanti.js
    "

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Build successful! (${BUILD_TYPE})${NC}"
    echo ""
    echo "Output files in: $PROJECT_ROOT/build-web/output"
    echo ""
    
    # Show build type specific info
    case "$BUILD_TYPE" in
        Release)
            echo -e "${GREEN}Build type: Release${NC}"
            echo "  Optimizations: -O3 + LTO"
            echo "  Target: Maximum performance"
            ;;
        MinSizeRel)
            echo -e "${BLUE}Build type: MinSizeRel${NC}"
            echo "  Optimizations: -Oz + LTO"
            echo "  Target: Minimum binary size"
            ;;
        RelWithDebInfo)
            echo -e "${BLUE}Build type: RelWithDebInfo${NC}"
            echo "  Optimizations: -O2 + LTO + debug symbols"
            echo "  Target: Optimized with debugging"
            ;;
        Debug)
            echo -e "${YELLOW}Build type: Debug${NC}"
            echo "  Optimizations: None (-O0)"
            echo "  Target: Full debugging support"
            ;;
    esac
    echo ""
    
    echo "To test locally, run:"
    echo "  cd $PROJECT_ROOT/build-web/output"
    echo "  python3 -m http.server 8080"
    echo ""
    echo "Then open: http://localhost:8080"
else
    echo ""
    echo -e "${RED}✗ Build failed (${BUILD_TYPE})${NC}"
    echo "Check the error messages above."
    exit 1
fi
