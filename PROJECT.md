# Weherd

A playable Three.js office for the agents in a local Herdr session.

## Product scope

- Each recognized Herdr agent becomes an office character with its workspace label.
- Working agents sit at a desk with a laptop. Blocked agents turn red and hold their heads. Idle and done agents walk to the coffee area.
- The player walks around the office and presses **E** near a character to open its interactive xterm.js terminal. A visible close button returns to the game.
- The player can equip a shotgun and fire. Hitting a live character requests closure of that agent's terminal, subject to the configured protections.
- Separate settings allow closing busy agents and closing their entire Herdr workspace. Both start disabled. Closing a Herdr workspace does not mean deleting checkout files.
- An explicit demo mode supports exploration and destructive gameplay tests without touching Herdr.

## Architecture

- **Browser:** Vite, TypeScript, Three.js, and xterm.js. The scene and characters are procedural, so the project has no downloaded model assets.
- **Local bridge:** Node.js and WebSockets. Agent discovery uses the Herdr Unix socket API. Interactive terminals use Herdr's supported terminal stream adapter.
- **Identity:** A pane handle plus an occupant fingerprint protects against stale selections. The bridge refreshes live state before closing a target and evaluates every affected agent when closing a whole workspace.
- **Local access:** The bridge binds to loopback and validates request origins. The development server proxies the API and terminal WebSocket to preserve one browser origin.
- **Connection state:** Demo data is explicitly labeled. A disconnected live session is reported as disconnected.

## Delivery and validation

Frontend and backend execution agents implemented separate directories. An independent AI reviewer checked protocol handling, browser behavior, and the closure protections.

All development shooting, terminal input, and close tests must target demo fixtures or exact disposable Herdr objects created for this project. Existing user agents and workspaces must not be modified by validation.

Completed verification includes TypeScript/build checks, backend fixture tests, browser walkthroughs with screenshots, read-only discovery of the running Herdr session, a disposable terminal roundtrip, and a disposable agent closed through the game's actual shooting controls. The final browser pass also verified movement with the full live roster and across office layout changes. See the [AI review summary](docs/REVIEW.md). Raw local review artifacts are excluded from version control.
