# Models and configuration

[← Learnvas](../README.md)

## Provider and model selection

The toolbar separates **provider** selection from **model** selection. **pi default** delegates model selection to Pi. Available models depend on your credentials, configuration, and extension-registered providers; appearing in the list does not guarantee that a provider account has quota or permission to use every model.

Pi manages provider credentials and model configuration. Learnvas does not currently provide an in-app credentials editor or a separate OpenAI-compatible endpoint settings screen. See [Getting started](getting-started.md) for authentication.

## Startup extensions versus tutor extensions

At bridge startup, Learnvas loads Pi extensions once to register their providers and virtual models in a shared model runtime, then disposes that startup session. Tutor requests do **not** load that full extension set again.

With web access enabled, tutor sessions explicitly load only `npm:pi-web-access` and allow these tools:

- `web_search`
- `source_check`
- `fetch_content`
- `get_search_content`

With `LEARNVAS_WEB_ACCESS=0`, tutor sessions have no tools. This does not disable startup extension loading.

### Read-only extension inventory

The **Extensions** accordion below the toolbar shows:

- Startup-loaded extensions, their sources and paths, registered capabilities, and load diagnostics.
- Whether `pi-web-access` is configured for tutor requests.
- The last actual tutor-session extension load, once a web-enabled response has started.

Use **Refresh inventory** to update the snapshot. It does not install, enable, disable, or reload extensions. The inventory is not a complete list of every installed Pi package. Restart the bridge after changing Pi extension configuration.

Extensions execute local code. Review the [tutor isolation and security precautions](privacy.md#tutor-isolation) before enabling unfamiliar extensions in Pi.

## Environment variables

Set bridge environment variables before starting Learnvas:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LEARNVAS_WEB_ACCESS` | Enabled | Set to `0` to disable web extension loading and tools in tutor requests. This does not disable the startup extension warmup. |
| `BRIDGE_PORT` | `5178` | Changes the bridge's listening port. Also update the `/api` proxy target in [vite.config.ts](../vite.config.ts); the `just learn` cleanup still targets 5178 unless you change it. |
| `LEARNVAS_LIBRARY_DIR` | `~/.learnvas/` | Trusted startup-only override for the [file-library API](thread-library.md); never accepted from browser request paths. |
| `LEARNVAS_TRUSTED_ORIGINS` | Bridge port and `5173` on HTTP loopback hosts | Add comma-separated exact HTTP(S) loopback origins for other local frontend ports. Remote origins and paths are rejected. |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Uses another Pi agent directory for configuration, credentials, and resources. |

For example:

```bash
LEARNVAS_WEB_ACCESS=0 just learn
```

Or, when running the bridge separately:

```bash
LEARNVAS_WEB_ACCESS=0 pnpm bridge
```

Both servers default to loopback-only binds. Vite uses a strict port 5173 rather than silently selecting an untrusted alternate port. If you intentionally change the frontend port, add its exact loopback origin to `LEARNVAS_TRUSTED_ORIGINS`. Do not expose either server to a network or change the proxy to rewrite browser Host/Origin headers.

Related: [Troubleshooting](troubleshooting.md) · [Development](development.md).
