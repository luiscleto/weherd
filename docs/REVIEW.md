# Independent review

The initial implementation was reviewed on 2026-09-05 by an AI reviewer separate
from the implementation agents. No blocking findings remained after the fixes
and checks below. This records development validation, not an independent human
security audit or a guarantee of correctness.

## Validation performed

- TypeScript checking and the production Vite build passed.
- The repository's backend fixture suite passed. It covers socket framing,
  identity changes, active-agent protection, workspace scope, final-pane
  preservation, request origins, explicit disconnect/demo behavior, and static
  file boundaries. Run it with `npm test`.
- Seven additional identity and terminal-input checks passed. Routine status
  updates preserved identity; replacement fields invalidated it; no queued input
  reached a replacement detected immediately before forwarding.
- Ten runtime boundary checks passed. Foreign origins and Host headers,
  cross-site fetches, originless mutations, and unauthorized WebSockets were
  refused. Blocked and stale demo closure requests were also refused.
- Browser walkthroughs covered movement, modal pause, default settings, nearby
  **E** interaction, xterm input/output, **Esc** forwarding, **Shift+Esc** and the
  visible Close button, **Q** equip, an actual demo canvas shot, and demo reset.
  Typing in xterm did not move the player or equip the shotgun.
- Synthetic roster shrink from 18 agents to the last 10 rendered correctly.
  Live disconnection remained explicitly disconnected without switching to demo.
  Office layout growth and shrink kept the player outside furniture and allowed
  movement. Final browser runs reported no JavaScript errors.

## Disposable live integration

Live terminal input and closing tests used only newly created disposable
workspaces and agents. A terminal roundtrip exercised input, output, resize, and
controller release. A separate browser walkthrough approached a disposable
coding agent, opened its terminal, entered and erased a single character, closed
the overlay, and fired at that same character through the normal game controls.

With whole-workspace closure disabled, the agent's final pane closed while its
workspace remained open with a replacement shell. Existing agent pane identities
were unchanged. All disposable test workspaces were subsequently cleaned up.

## Findings resolved

1. Closing Herdr's last pane also removes its workspace. The bridge now creates
   and verifies a replacement shell before closing the final agent when workspace
   closure is disabled.
2. Shrinking the roster retained invalid desk slot indices. Surviving agents now
   receive valid slots.
3. Closure settings understated their scope. Descriptions now explain active
   protection, all-terminal workspace closure, and checkout retention.
4. Terminal input relied only on periodic identity polling. Each queued batch
   now refreshes identity immediately before forwarding.
5. Terminal readiness and Escape handling were corrected. Input waits for
   successful attachment, plain Escape reaches the terminal, and Shift+Escape
   closes the overlay.
6. Expanding the office could place a desk over the player. Layout rebuilds now
   preserve valid positions or relocate to a collision-checked walkable point.

## Limits and reproducibility

Herdr does not provide atomic compare-and-close or compare-and-input operations.
A race remains between a fresh snapshot and its following action. An unnamed
same-kind replacement in the same terminal without a native session identifier
cannot always be distinguished from the previous occupant.

The public repository includes the portable backend tests. Additional review
scripts, raw terminal metadata, screenshots, and local session evidence are kept
out of Git because they contain machine-specific or private runtime information.
The additional checks above describe work performed during development; their
local harnesses are not part of the published test suite.

See [the bridge protocol](../server/PROTOCOL.md) for the API and identity model.
