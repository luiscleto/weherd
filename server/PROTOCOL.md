# Herdr bridge

The local bridge uses Herdr's Unix socket NDJSON API for `session.snapshot`,
`tab.create`, `pane.close`, and `workspace.close`. The installed
`herdr api schema --json` (Herdr 0.8.2, protocol 20) was the implementation
authority. Snapshot protocols 19 and 20 are accepted; unsupported protocols
report disconnected without creating demo agents.

Interactive terminal streams use the supported `herdr terminal session control`
NDJSON CLI, which adapts Herdr's binary terminal socket transport. It is spawned
with an argv array, `shell: false`, an exact terminal ID, and an explicit
`HERDR_SOCKET_PATH`. Browser text is written to the subprocess's stdin as
`terminal.input`, never interpolated into shell commands. The adapter validates
frame sequence, dimensions and base64 ANSI payloads. Closing a browser terminal
releases its controller and terminates only that adapter subprocess; the PTY and
agent continue. Existing control leases are never taken over automatically.

The browser API is:

- `GET /api/state?mode=live|demo`: `{mode, connected, agents, error?}`. Agent fields
  include `id`, `identity`, `name`, `kind`, `status`, `workspaceId`,
  `workspaceName`, `terminalId`, and `cwd`.
- `POST /api/agents/:encodedPaneId/close?mode=live|demo`: JSON
  `{expectedIdentity, allowWorking, deleteWorkspace}`; success `{ok, message}` or
  failure `{error}` with an appropriate HTTP status.
- `POST /api/demo/reset`: JSON `{}` resets only in-memory demo agents.
- `WS /api/terminal?mode=live|demo&paneId=…&identity=…`: browser messages
  `{type:'input',data}` and `{type:'resize',cols,rows}`; server messages
  `{type:'output',data}` containing decoded ANSI, and `{type:'status'|'error',message}`.

Working, blocked, unknown and launch-pending agents are protected unless
`allowWorking` is explicitly true. Workspace closure checks every recognized
agent in that workspace, and refuses repository-root closure when linked
workspaces would also close. `deleteWorkspace` only closes Herdr topology and
processes; no worktree or checkout deletion command exists in this bridge.

When preserving a workspace's final terminal, the bridge first creates a new
unfocused shell tab in the same workspace, then snapshots and validates the
target and replacement before closing the agent pane. Its cwd is the first
existing directory among the agent cwd, workspace checkout, user home and
temporary directory. A failed revalidation leaves both terminals open.

Agent fingerprints bind pane, workspace, terminal, kind, name and native agent
session when supplied. Every close uses a fresh snapshot, and terminal input is
serialized in short batches with a fresh identity check immediately before
forwarding. Idle streams also revalidate periodically. Herdr does not expose an
atomic compare-and-close or compare-and-input operation; a small race between
snapshot and action remains. An unnamed same-kind agent replacement in the same
PTY without a native session identifier cannot always be distinguished.

The HTTP listener binds only `127.0.0.1`. Hostnames are restricted to loopback;
mutations and WebSocket handshakes require an allowed Origin. GET requests with
a foreign Origin are rejected too. The dev origins are explicitly configured,
and there is no wildcard CORS. Browser commands are bounded in size. Production
static files are resolved with `realpath` and must remain inside `dist`.

Configuration: `PORT` (4317), `WEHERD_MODE` (live), `HERDR_SOCKET_PATH`,
`HERDR_CONFIG_PATH`, `HERDR_SESSION`, `XDG_CONFIG_HOME`, `HERDR_BIN_PATH` (herdr),
and comma-separated `WEHERD_ALLOWED_ORIGINS` (the two localhost/127.0.0.1 Vite
origins on port 5173). An explicit socket path wins over session/config lookup.

Validation: `node --test server/*.test.mjs`. A real terminal roundtrip on
2026-09-05 created a disposable workspace; sent a fixed printf marker and resize;
observed live output; released the adapter; closed only that created workspace
and confirmed its absence in a fresh snapshot. No pre-existing user terminal
received input, resize, attachment or a close from that check. See the
[review summary](../docs/REVIEW.md) for broader validation and its limits.
