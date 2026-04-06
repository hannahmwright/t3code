# HTTPS PWA Deployment

This is the deployment path for a real installable T3 Code PWA with background web push.

## Recommended shape

- Run the built T3 server locally on this Mac.
- Keep it bound to `127.0.0.1:3773`.
- Put `t3.thewrighthome.app` in front of it with Cloudflare.
- Keep Cloudflare Access in front of the hostname if you still want Google login protection.

That gives the app:

- one HTTPS origin for the web app, manifest, and service worker
- stable browser installability
- secure-context browser notification support
- the existing T3 WebSocket + SQLite server model

## Current hostname state

As of 2026-04-06:

- `t3.thewrighthome.app` is currently behind Cloudflare Access
- the active Cloudflare tunnel appears to be `thewrighthome`
- the active connector for that tunnel is a Windows machine, not this Mac
- this Mac only has credentials/config for the separate `maestro-codex` tunnel

That means the old `t3.thewrighthome.app` routing is not controlled by the current local `~/.cloudflared/config.yml`.

## Local server env

Create a local env file:

```bash
cp .env.remote.example .env.remote.local
```

Fill in:

- `T3CODE_AUTH_TOKEN`
- `T3CODE_VAPID_PUBLIC_KEY`
- `T3CODE_VAPID_PRIVATE_KEY`
- `T3CODE_VAPID_SUBJECT`

Then start the production-style server:

```bash
./scripts/start-remote-t3.sh
```

By default this script:

- builds `apps/web`
- builds `apps/server`
- starts the server on `127.0.0.1:3773`
- serves the built web app from the same origin as the API and WebSocket server

## Cloudflare routing

To reuse `t3.thewrighthome.app`, repoint that hostname so it reaches `http://127.0.0.1:3773` on the machine running T3.

There are two realistic paths:

1. Reuse the existing `thewrighthome` tunnel in the Cloudflare dashboard.
2. Move `t3.thewrighthome.app` onto a tunnel that this Mac actually controls.

Because this Mac does not currently have credentials for the `thewrighthome` tunnel, the dashboard is the cleanest place to change the hostname mapping.

## Notes

- Tailscale can still be used as a direct fallback path.
- PWA installability and background push are only expected to work reliably on the HTTPS hostname.
- The T3 server still needs `T3CODE_AUTH_TOKEN` even when Cloudflare is in front of it.
