default:
    @just --list

# Install dependencies
setup:
    pnpm install

# Type-check + production build
build:
    pnpm build

# Run Learnvas: pi bridge server + Vite dev server, opens the browser
learn:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d node_modules ]; then pnpm install; fi
    # Clear any stale bridge still holding the port — otherwise the fresh
    # bridge dies with EADDRINUSE and vite silently proxies to old code.
    fuser -k 5178/tcp 2>/dev/null || true
    sleep 0.3
    node server/index.mjs &
    BRIDGE_PID=$!
    cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; }
    trap cleanup EXIT INT TERM
    pnpm exec vite --open
