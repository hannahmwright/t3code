# HTTPS PWA Deployment

This is the deployment path for a real installable T3 Code PWA with background web push.

## Recommended shape

- Run the built T3 server locally on this Mac.
- Keep it bound to `127.0.0.1:3773`.
- Put `t3.thewrighthome.app` in front of it with Cloudflare.
- Use T3's built-in username/password session flow for app-native auth instead of Cloudflare Access.

That gives the app:

- one HTTPS origin for the web app, manifest, and service worker
- stable browser installability
- secure-context browser notification support
- the existing T3 WebSocket + SQLite server model

## Current hostname state

As of 2026-04-06, the goal is for `t3.thewrighthome.app` to go straight to this Mac through Cloudflare Tunnel, with authentication handled inside T3 itself.

## Local server env

Create a local env file:

```bash
cp .env.remote.example .env.remote.local
```

Fill in:

- `T3CODE_AUTH_TOKEN`
- `T3CODE_APP_AUTH_USERNAME`
- `T3CODE_APP_AUTH_PASSWORD`
- `T3CODE_APP_AUTH_SESSION_SECRET` (optional, but recommended)
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

The hostname should keep using Cloudflare Tunnel for HTTPS transport, but Cloudflare Access should be removed from the request path so the installed PWA stays inside the app during login.

## Notes

- Tailscale can still be used as a direct fallback path.
- PWA installability and background push are only expected to work reliably on the HTTPS hostname.
- The T3 server still needs `T3CODE_AUTH_TOKEN` for non-session server auth and bootstrap use.
- Built-in app auth is device/session-based and works best when the browser reaches the app directly on the same origin.
