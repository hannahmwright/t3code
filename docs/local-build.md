# Local Build Notes

Use Node 22 for local development commands.

Some bundled app environments can put a packaged Node binary first on `PATH`, for example:

```bash
/Applications/Codex.app/Contents/Resources/node
```

That Node can reject native tool bindings used by `rolldown`, `oxfmt`, and `oxlint` with a macOS code-signing error like:

```text
not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs
```

If build, format, lint, or Vitest fails before project code runs, make sure a normal Node 22 install is first on `PATH`:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
node -v
```

Then run the usual checks:

```bash
bun fmt
bun lint
bun typecheck
cd apps/server && bun run build
```

Project tests must be run with `bun run test`, not `bun test`:

```bash
cd apps/server && bun run test src/codexAppServerManager.test.ts
```
