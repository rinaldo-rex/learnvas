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
    node server/index.mjs &
    BRIDGE_PID=$!
    cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; }
    trap cleanup EXIT INT TERM
    pnpm exec vite --open
