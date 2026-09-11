# Collaborative System Design Interview App

A single web app where an interviewer and a candidate share a live diagram canvas, talk, chat, and take notes. All "live" behaviour is simulated locally for now, behind one swappable service layer so a real backend can be plugged in later without touching the screens.

## Screens

1. **Home (`/`)** — Start a session as interviewer, or join with a link/code as a guest.
2. **Interview room (`/room/$sessionId`)** — the main workspace: canvas, palette, right-side panels, top bar, audio bar.
3. **Join / waiting room (`/join/$sessionId`)** — guest enters a display name, then waits until admitted.

## Canvas

- Palette with Service, LLM, Database, Queue, Cache, Client, External System, Rectangle, Note; each with its own shape and icon.
- Drag from palette onto the canvas, move, resize, rename inline, multi-select, delete.
- Connect nodes with directed arrows; click an arrow to add or edit its label.
- Undo/redo with keyboard shortcuts.
- **Tree view toggle** — the same diagram as a structured, keyboard-navigable list of components and connections, fully usable without a mouse.

## Interview room controls

- Role switcher to preview the room as Interviewer or as Guest.
- Interviewer: copy private share link, waiting-room queue with Admit/Reject, participant list, "pause editing" toggle, lock individual objects, end session.
- Guest: read-only when editing is paused or an object is locked.

## Collaboration (simulated)

- Audio bar: connect/disconnect, mute/unmute, simulated speaking indicators that pulse on the active speaker.
- Chat drawer with timestamped messages and simulated replies from the other participant.
- Notes panel with two tabs: Shared notes (both see) and Private notes (interviewer only).

## Export

- Export the diagram as PNG, SVG, or JSON from the top bar.
- Snapshot controls: save a named snapshot, list snapshots, restore one, and set a retention setting for how long snapshots are kept.

## Technical approach

- **Service layer**: `src/services/api/` defines a single `InterviewApi` TypeScript interface covering sessions, participants, presence, chat, notes, diagram ops, snapshots, and a subscribe/event channel. `mock/` implements it with artificial latency, an in-memory store persisted to localStorage, and a BroadcastChannel-backed event bus so two browser tabs act as two participants. A `createApiClient()` factory is the only import the UI uses, so a REST/WebSocket implementation swaps in at one place.
- **State**: TanStack Query for reads/mutations against the service layer; a local reducer with an undo/redo stack for canvas editing, flushed to the API as diagram ops.
- **Canvas**: custom SVG renderer (no heavy graph library) so PNG/SVG export is a direct serialization of what is drawn.
- **Design**: dark technical workspace theme, semantic tokens in `src/styles.css`; no purple-on-white defaults.
- **Routes**: `index.tsx`, `join.$sessionId.tsx`, `room.$sessionId.tsx`, each with its own head metadata.

## Build order

1. Service layer interface + mock implementation + storage/event bus.
2. Design tokens and app shell.
3. Canvas engine: nodes, edges, selection, resize, undo/redo, tree view.
4. Room chrome: roles, waiting room, participants, locking, pause.
5. Audio bar, chat, notes.
6. Export and snapshots.
