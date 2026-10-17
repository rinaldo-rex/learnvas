# Learnvas

**Explore ideas as branching conversations on an infinite canvas.**

Questions and answers live as separate cards. Select a passage to ask about it, click **+** to continue a thread, or compare responses from different models without losing your original conversation. Press **S** to select cards, then **M** to merge their conversations—even from unrelated roots—with your own instructions and a choice of context scope.

Learnvas runs in your browser with a local [Pi SDK](https://github.com/earendil-works/pi) bridge. Named learning threads autosave to `~/.learnvas/` through the local [`.learn` file library](docs/thread-library.md). Open **Threads** to create, switch, rename, trash, or restore a complete canvas, or import/export portable `.learn` files. System / Light / Dark themes are supported.

## Quick start

You need **Node.js 22.19+**, **pnpm**, and a model provider configured in Pi. The one-command launcher also uses [just](https://github.com/casey/just).

```bash
git clone https://github.com/rinaldo-rex/learnvas.git
cd learnvas
pnpm install
```

Already use Pi? Learnvas reuses your credentials. Otherwise, run `pnpm exec pi`, use `/login`, then exit Pi.

For web-enabled tutoring, install the web extension if needed, then launch:

```bash
pnpm exec pi install npm:pi-web-access
just learn
```

Prefer no web tools? Skip the extension installation and run `LEARNVAS_WEB_ACCESS=0 just learn` instead.

Open the URL printed by Vite, normally **http://localhost:5173**. Type a question, review its thinking-effort choices, and click **Ask** or press **Ctrl/Cmd+Enter**. Click **?** at the top-right for in-app help.

> `just learn` attempts to terminate any process using port 5178 before starting the bridge. See [Getting started](docs/getting-started.md) for a two-terminal alternative and setup details.

## Documentation

| Guide | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Requirements, Pi authentication, web extension setup, and launch options. |
| [Using the canvas](docs/usage.md) | Branching, shortcuts, model comparison, navigation, card controls, and tutor notes. |
| [Models and configuration](docs/configuration.md) | Provider selection, extension inventory, and environment variables. |
| [Data and privacy](docs/privacy.md) | Local persistence, limitations, tutor isolation, and security precautions. |
| [Portable `.learn` format](docs/learn-format.md) | v5-only document schema, generation settings, per-source merge context, and validation. |
| [Local thread library API](docs/thread-library.md) | Thread controls, import/export, revisions, collision confirmation, trash/restore, and recovery. |
| [Development](docs/development.md) | Commands, architecture, source map, and contribution checks. |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and useful details for bug reports. |

**Run locally on a trusted machine.** The bridge binds to loopback and checks trusted origins, but does not authenticate local programs; do not expose it through remote proxies. See [Data and privacy](docs/privacy.md).
