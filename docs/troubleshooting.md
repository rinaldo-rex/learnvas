# Troubleshooting

[← Learnvas](../README.md)

| Symptom | Check |
| --- | --- |
| Empty model list or authentication error | Authenticate through Pi, check provider environment variables, and inspect the bridge terminal. Return focus to the app to refresh the model list. |
| Provider or quota error | Confirm that the chosen model is supported by your account and that quota/credits are available. Listing a model does not validate a request against that provider. |
| Web-enabled responses fail | Check `pi-web-access` installation and configuration, inspect the Extensions accordion, or restart with `LEARNVAS_WEB_ACCESS=0` to isolate the problem. |
| Extension changes do not appear | Restart the bridge. Refreshing the inventory reads the last load snapshot; it does not reload extension code. |
| `/api` errors or stale backend behavior | Check that the bridge is running on the port used by `vite.config.ts`. `pnpm dev` alone does not start it. |
| Canvas looks empty after restarting | Verify the browser profile and Vite URL: browser storage is separate for different hostnames and ports. |
| App is still light | System mode follows your OS. Choose **Theme: Dark** to override it. |

See [Getting started](getting-started.md) for authentication and launch instructions, [Models and configuration](configuration.md) for bridge settings, and [Data and privacy](privacy.md) for persistence limitations.

## Reporting a problem

Before opening an [issue](https://github.com/rinaldo-rex/learnvas/issues), include:

- Steps to reproduce and what you expected to happen.
- Node.js and pnpm versions.
- Browser and operating-system details.
- Relevant frontend or bridge errors.

Redact API keys, tokens, private prompts, and other sensitive information.

For code contributions, run `pnpm test` and `pnpm build`; see [Development](development.md).
