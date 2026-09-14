# Design Sync

Build a collaborative system design interview web application backed by the FastAPI service in `../backend`. Key features:

1. Interactive Collaborative Canvas:
- Component palette: Service, LLM, Database, Queue, Cache, Client, External System, Generic Rectangle, Note.
- Drag & drop components onto canvas, connect with directed arrows/edges, edge labels, resize, node labeling, selection, and undo/redo.
- Structured alternative object tree/list view for accessibility.

2. Interview Room & Session Management:
- Role switcher/preview (Interviewer vs Guest/Candidate).
- Interviewer features: create session, copy private share link, waiting room with admit/reject guest actions, participant list, pause editing toggle, object locking, and end session.
- Candidate/Guest join view: enter display name, waiting room state until admitted.

3. Live Collaboration & Communication (Mocked):
- Audio room bar: connect/disconnect audio, mute/unmute toggle, simulated active speaker indicators.
- In-session text chat drawer with timestamped messages.
- Note-taking panel: shared notes tab and private interviewer-only notes tab.

4. Export & Snapshots:
- Export diagram as PNG, SVG, and JSON.
- Session retention/snapshot controls.

5. Clean Architecture:
- Structure all session, participant, chat, presence, and diagram operations behind a dedicated API service interface. The default implementation uses the backend's REST and WebSocket endpoints; configure its URL and interviewer credentials with `VITE_API_URL`, `VITE_API_USERNAME`, and `VITE_API_PASSWORD`.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4b72d952-42f5-415c-a9d9-d0695bb389db).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
