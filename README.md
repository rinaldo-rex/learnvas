# Learnvas

**Explore ideas as branching conversations on an infinite canvas.**

Questions and answers live as separate cards. Select a passage to ask about it, click **+** to continue a thread, or compare responses from different models without losing your original conversation.

Learnvas runs in your browser with a local [Pi SDK](https://github.com/earendil-works/pi) bridge. It saves your canvas in browser-local storage and supports System / Light / Dark themes.

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

Open the URL printed by Vite, normally **http://localhost:5173**. Type a question and click **Ask →** or press **Ctrl/Cmd+Enter**.

> `just learn` attempts to terminate any process using port 5178 before starting the bridge. See [Getting started](docs/getting-started.md) for a two-terminal alternative and setup details.

## Documentation

| Guide | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Requirements, Pi authentication, web extension setup, and launch options. |
| [Using the canvas](docs/usage.md) | Branching, shortcuts, model comparison, navigation, and card controls. |
| [Models and configuration](docs/configuration.md) | Provider selection, extension inventory, and environment variables. |
| [Data and privacy](docs/privacy.md) | Local persistence, limitations, tutor isolation, and security precautions. |
| [Development](docs/development.md) | Commands, architecture, source map, and contribution checks. |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and useful details for bug reports. |

**Run locally on a trusted machine.** The bridge has no authentication; do not expose it to untrusted networks. See [Data and privacy](docs/privacy.md).
