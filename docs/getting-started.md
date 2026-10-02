# Getting started

[← Learnvas](../README.md)

## Requirements

- **Node.js 22.19 or newer**; Node.js 24+ is recommended.
- **pnpm**.
- Access to at least one model through Pi: a stored login, an API key, or a configured provider extension.
- Optional: [just](https://github.com/casey/just) for the one-command launcher.

## Install

```bash
git clone https://github.com/rinaldo-rex/learnvas.git
cd learnvas
pnpm install
```

## Configure model access

Learnvas reuses your Pi configuration and credentials, normally in `~/.pi/agent`. If you already use Pi, you generally do not need to authenticate again.

Otherwise, launch the Pi CLI included with the project dependency:

```bash
pnpm exec pi
```

Inside Pi, run `/login` and follow the provider's authentication steps. Exit Pi when finished. Environment-based API keys are also supported; see Pi's [provider authentication guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md).

For web-enabled tutoring, install the web extension if it is not already available:

```bash
pnpm exec pi install npm:pi-web-access
```

This changes your Pi package configuration. If you prefer tool-free tutoring, skip this installation and start Learnvas with `LEARNVAS_WEB_ACCESS=0` instead.

## Run with just

```bash
just learn
```

The launcher starts the loopback-only bridge on port **5178** and the Vite app on loopback port **5173**. Open the URL printed by Vite (localhost or 127.0.0.1). If port 5173 is occupied, Vite exits instead of silently choosing a different trusted origin; free the port or explicitly configure another [trusted local origin](configuration.md#environment-variables). Stop the launcher with **Ctrl+C**.

> **Port cleanup:** `just learn` uses Bash and attempts to terminate any process listening on port 5178 with `fuser` before starting the bridge. Use the two-terminal approach below if you do not want automatic port cleanup.

## Run without just

Run these in separate terminals from the project directory:

```bash
# Terminal 1: Pi bridge
pnpm bridge
```

```bash
# Terminal 2: browser app
pnpm dev
```

Stop each process with **Ctrl+C** when finished. Starting Vite alone does not start the bridge.

## Tool-free tutoring

With the combined launcher:

```bash
LEARNVAS_WEB_ACCESS=0 just learn
```

Or, when using two terminals, replace `pnpm bridge` with:

```bash
LEARNVAS_WEB_ACCESS=0 pnpm bridge
```

This disables tools in tutor requests, not the startup extension warmup. See [Models and configuration](configuration.md) for that distinction.

Next: [Using the canvas](usage.md). Having trouble? See [Troubleshooting](troubleshooting.md).
