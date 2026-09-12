# System Design Interview Workspace

## 1. Product summary

System Design Interview Workspace is a browser-based, real-time interview room where an interviewer creates a private session and shares a link with a candidate. Participants discuss a system design while collaboratively building the architecture on a shared canvas.

The core experience combines:

- A shared diagram canvas with system-design components and directed connections.
- Real-time collaboration, presence, and conflict-safe editing.
- A voice room for the interview conversation.
- Session controls for the interviewer.
- A session history and exportable diagram at the end of the interview.

### Assumption

“Notification” in the request refers to creating the product specification for this collaborative interview experience. This document specifies the first product slice, not a notification-delivery feature.

## 2. Goals

### Primary goals

1. Let an interviewer create a session and share a joinable link in seconds.
2. Let multiple participants edit the same diagram at the same time.
3. Make common system-design concepts quick to place, label, move, and connect.
4. Give the interviewer enough control to run a structured interview without taking over the candidate’s work.
5. Make discussion possible inside the room through low-friction voice communication.
6. Preserve a reliable final diagram and session summary for review.

### Non-goals for the initial release

- Full video conferencing.
- Automated candidate scoring or hiring recommendations.
- An AI interviewer or AI-generated architecture.
- Public discovery of sessions.
- Persistent recording of audio by default.
- A general-purpose whiteboard with arbitrary drawing tools.

## 3. Users and permissions

### Roles

| Role | Capabilities |
|---|---|
| Interviewer | Create, start, pause, end, and delete a session; edit the canvas; annotate; manage participants; export results; optionally lock selected objects. |
| Candidate | Join through the session link; edit, move, resize, label, and connect diagram objects; use voice and chat; undo their own recent actions. |
| Observer | Read-only canvas access; view presence; join voice/chat if permitted. Useful for shadowing or panel interviews. |

The candidate is an editor by default. The interviewer may temporarily disable candidate editing or lock individual objects, but the UI must make this state visible to everyone.

### Identity model

- The interviewer must sign in or use an authenticated organization account.
- A candidate may join as a guest with a display name and optional interview code.
- A guest link must not reveal other sessions or account data.
- The product should support authenticated candidates later without changing the session model.

## 4. Core user journeys

### 4.1 Create and share a session

1. Interviewer selects **New interview**.
2. Interviewer enters an optional candidate name, interview title, and duration.
3. The system creates a session in `waiting` state and displays a share link and short code.
4. Interviewer copies the link or sends it through their existing communication channel.
5. Candidate opens the link, enters a display name, and joins the waiting room.
6. Interviewer sees the candidate and selects **Start interview**.

### 4.2 Collaborate on the diagram

1. Either editor opens the component palette and drags a component onto the canvas, or double-clicks the canvas to place one.
2. The creator can edit the label, description, technology, and optional capacity/latency notes.
3. Participants drag objects to reposition them. All connected arrows remain attached.
4. A participant drags from a connection handle on one object to another object to create a directed arrow.
5. The arrow can be labeled with a protocol or relationship such as `HTTPS`, `gRPC`, `publishes`, or `reads`.
6. All participants see updates, selections, cursors, and presence without refreshing.
7. The interviewer can add private or shared notes and can lock part of the canvas when moving to discussion.

### 4.3 Talk during the interview

1. Participants join the room’s audio channel after granting microphone permission.
2. Each participant can mute/unmute, see speaking activity, and leave/rejoin audio without leaving the diagram.
3. The room provides a small text chat for links, assumptions, and brief written notes.
4. The interviewer can mute all participants locally in the interface and can end the voice room.
5. Audio is not recorded or persisted unless an explicit future recording feature is enabled with consent.

### 4.4 End and review

1. Interviewer selects **End interview** and confirms.
2. The canvas becomes read-only for guests and the final diagram is snapshotted.
3. Interviewer can export a PNG/SVG and a structured JSON representation of the diagram.
4. Interviewer can add a private review note and optionally reopen the session for corrections.

## 5. Functional requirements

### 5.1 Session lifecycle

Session states:

```text
waiting -> active -> paused -> active
active -> ended
waiting -> cancelled
paused -> ended
```

Requirements:

- Session creation returns a unique, unguessable share token and a human-friendly short code.
- The share link opens only the intended session and is revocable by the interviewer.
- The interviewer can see who is waiting, connected, disconnected, or has left.
- The interviewer can remove a participant and prevent re-entry using the same guest identity.
- A session has an optional time limit and a visible elapsed-time indicator.
- Ended sessions are read-only and expire according to the configured retention policy.
- The server remains authoritative for session state; the browser must not be able to grant itself interviewer permissions.

### 5.2 Diagram canvas

#### Canvas interactions

- Pan, zoom, fit-to-content, and reset view.
- Select one or multiple objects.
- Drag and drop objects with snap-to-grid assistance.
- Resize objects while preserving a usable minimum size.
- Duplicate, delete, and restore objects.
- Inline edit labels; use a side panel for advanced properties.
- Create, edit, reconnect, label, and delete directed arrows.
- Select a region and move its objects together.
- Undo and redo with clear indication of whose action is being undone.
- Keyboard-accessible alternatives for every essential pointer action.
- Show a “someone else is editing” selection indicator without preventing normal collaboration.

#### Initial component palette

Every component has a stable `type`, a default icon/shape, a label, and editable metadata.

| Component | Default visual | Example use |
|---|---|---|
| Service | Rounded rectangle | API service, worker, auth service |
| LLM | Rounded rectangle with LLM badge | Model gateway, prompt service, inference endpoint |
| Database | Cylinder | SQL, NoSQL, vector, or graph database |
| Queue | Queue-style rectangle or stacked cards | Kafka, SQS, RabbitMQ |
| Cache | Layered cylinder/rectangle | Redis, CDN, in-memory cache |
| Load balancer | Trapezoid | Traffic distribution and ingress |
| Client | Screen/device shape | Browser, mobile app, internal tool |
| External system | Dashed rectangle | Payment provider, identity provider, vendor API |
| Object storage | Bucket/cylinder | S3-like blob storage |
| Generic rectangle | Plain rectangle | Custom component or grouping label |
| Note | Sticky-note shape | Assumptions, constraints, open questions |

The **LLM** component is a first-class type rather than only a renamed generic rectangle so that it can later support model, provider, context-window, token-cost, and retrieval metadata.

#### Component properties

- Name/label, required.
- Optional description.
- Optional technology/provider.
- Optional metadata fields appropriate to the type, such as model name, datastore kind, or queue semantics.
- Optional color and icon override.
- Optional shared note attached to the object.
- Optional interviewer-only note, never visible to the candidate.

#### Connections

- Connections are directed and have visible arrowheads.
- A connection may have a label, protocol, request type, or throughput note.
- Connections attach to object handles and follow objects when they move.
- A connection may connect to a group or boundary in a later release; MVP connections target concrete objects only.
- Self-loops and duplicate connections are allowed only when they have different labels or metadata.

### 5.3 Groups and boundaries

MVP supports a visual boundary/group with a title, such as `VPC`, `Region`, or `Private subnet`. A boundary may contain objects and move them as a unit. It is a visual container, not a separate deployment or permission boundary.

### 5.4 Real-time collaboration

- A new participant receives the latest complete document and session metadata on join.
- Subsequent edits are sent as operations over a persistent WebSocket connection.
- Operations are applied optimistically in the local browser and acknowledged by the server.
- Operations are idempotent and include a client-generated operation ID.
- The system resolves concurrent edits deterministically. Moving the same object concurrently uses the server’s operation ordering; edits to different properties merge.
- A reconnecting client receives missed operations or a fresh snapshot, then reconciles local unsent work.
- Presence includes display name, role, connection state, current viewport, cursor, selected object IDs, and speaking state. Presence is ephemeral and is not part of the saved diagram.
- The UI indicates disconnected, reconnecting, and synchronized states.
- A participant must never lose a saved operation because another participant joined, left, or refreshed.

### 5.5 Interviewer controls

- Start, pause, resume, and end session.
- Copy/revoke share link.
- Admit or reject participants if a waiting room is enabled.
- Change a participant between candidate and observer.
- Remove a participant.
- Enable/disable candidate editing globally.
- Lock/unlock selected objects.
- Add shared or interviewer-only notes.
- Clear the canvas only after an explicit confirmation and with undo available.
- Export the final diagram.

### 5.6 Voice and text communication

#### MVP voice requirements

- One audio room per interview session.
- Join/leave audio independently from canvas presence.
- Mute/unmute and microphone device selection.
- Speaking indicator and participant audio status.
- Connection quality indicator and graceful reconnect.
- Target capacity: 20 simultaneous audio participants per session.

#### Text chat requirements

- Session-scoped messages with display name and timestamp.
- Message length limit and basic rate limiting.
- Candidate and interviewer can post; observer access is controlled by the interviewer.
- Chat is included in session retention only if the organization’s policy allows it.

Video, recording, transcription, captions, and AI summarization are future extensions and require explicit consent and retention controls.

## 6. Suggested technical architecture

```text
Browser clients
  | HTTPS: session pages, snapshots, exports
  | WebSocket: diagram operations, presence, chat, session events
  | WebRTC: microphone media through an SFU
  v
API / session service ---- PostgreSQL: users, sessions, participants, snapshots, audit data
        |
        +---- Redis: presence, pub/sub, connection coordination, rate limits
        |
        +---- Object storage: exported PNG/SVG/JSON and optional retained artifacts
        |
        +---- WebRTC SFU: audio routing; managed service or self-hosted LiveKit/mediasoup
```

### Recommended implementation choices

- Frontend: React + TypeScript.
- Canvas: a node/edge canvas library such as React Flow, or an equivalent library that supports custom nodes, handles, selection, viewport transforms, and accessibility.
- Diagram state: a normalized document model with a CRDT or operation log. Yjs is a practical MVP option if the team wants robust concurrent editing and offline reconciliation.
- Backend: a stateless HTTP API plus WebSocket gateway; any typed server framework is acceptable.
- Persistence: PostgreSQL for session metadata and periodic diagram snapshots; append-only operation storage can be added for replay and audit needs.
- Voice: WebRTC via an SFU rather than peer-to-peer mesh so participant count can scale without every browser opening a connection to every other browser.
- Exports: server-side or browser-side SVG/PNG generation from the same normalized diagram document.

The first release may use server-ordered operations instead of a full CRDT if the product limits edits to well-defined object and property operations. The protocol must still retain operation IDs, version numbers, acknowledgements, and resync behavior so the storage strategy can evolve.

## 7. Data model

### Session

```text
Session
- id
- owner_user_id
- title
- state: waiting | active | paused | ended | cancelled
- share_token_hash
- short_code
- created_at, started_at, ended_at
- expires_at
- candidate_editing_enabled
- settings_json
```

### Participant

```text
Participant
- id
- session_id
- user_id nullable
- display_name
- role: interviewer | candidate | observer
- guest_token_hash nullable
- joined_at, left_at, last_seen_at
- removed_at nullable
```

### Diagram document

```text
DiagramDocument
- session_id
- document_version
- snapshot_json
- updated_at

Node
- id
- type
- x, y, width, height
- z_index
- label
- properties_json
- locked
- created_by
- updated_at

Edge
- id
- source_node_id
- target_node_id
- source_handle nullable
- target_handle nullable
- label
- properties_json
- created_by
- updated_at
```

Chat messages and audit events should reference the participant and session, but ephemeral cursors, selections, and WebRTC signaling data should not be stored as diagram content.

## 8. Real-time protocol outline

All messages include `sessionId`, `participantId`, `messageId`, and a protocol version.

### Client to server

```text
session.join
diagram.operation
diagram.undo_request
presence.update
chat.send
voice.signal
session.control
```

### Server to client

```text
session.snapshot
session.participant_joined
session.participant_left
diagram.operation_applied
diagram.operation_rejected
diagram.resync_required
presence.updated
chat.message
session.state_changed
permissions.changed
voice.signal
error
```

An operation should contain an operation ID, base document version, operation type, target ID, changed fields, author, and client timestamp. The server returns the accepted version or a rejection reason such as `permission_denied`, `object_locked`, or `stale_document`.

## 9. Security, privacy, and abuse controls

- Use TLS for all HTTP, WebSocket, and WebRTC signaling traffic.
- Store only hashes of share tokens and guest tokens.
- Use short-lived, scoped guest credentials rather than bearer URLs that remain valid indefinitely.
- Rate-limit session creation, join attempts, chat, and diagram operations.
- Validate all object types, coordinates, labels, metadata sizes, and operation targets on the server.
- Enforce authorization on every session and diagram mutation.
- Avoid placing candidate names or interview content in analytics event payloads.
- Provide link revocation, session deletion, configurable retention, and export deletion.
- Do not record audio or generate transcripts without explicit participant consent.
- Log security-relevant actions such as link revocation, participant removal, permission changes, and exports.
- Add moderation controls for abusive chat content if sessions can be used outside a trusted organization.

## 10. Non-functional requirements

### Performance targets

- Initial session view usable within 3 seconds on a typical broadband connection.
- 95th-percentile diagram-operation propagation under 500 ms for participants in the same region.
- Presence updates visible within 1 second.
- Reconnect and resync within 5 seconds after a transient network interruption.
- Canvas remains interactive with at least 500 nodes and 1,000 edges in one document.

### Reliability targets

- No acknowledged diagram operation is lost.
- A participant refresh must recover the latest persisted state.
- Graceful degradation: if voice fails, canvas and chat remain usable.
- Session service target availability: 99.9% monthly for production.

### Accessibility

- Keyboard-operable palette, selection, editing, and connection creation.
- Visible focus states and sufficient color contrast.
- Do not rely on color alone to distinguish component types or connection states.
- Screen-reader labels for tools, objects, locks, and participant status.
- Provide a structured object list as an alternative to canvas-only navigation.

## 11. MVP acceptance criteria

The MVP is complete when all of the following are true:

1. An authenticated interviewer can create a session and copy a private link.
2. A guest can join with a display name, and the interviewer can see and admit them.
3. At least two editors can simultaneously add, move, rename, delete, and connect components.
4. The palette includes Service, LLM, Database, Queue, Cache, Client, External system, Generic rectangle, and Note.
5. Directed arrows remain connected while nodes move and can carry labels.
6. A refresh or temporary disconnect does not lose acknowledged changes.
7. The interviewer can pause editing, lock an object, remove a participant, and end the session.
8. Participants can join a session audio room, mute/unmute, and see who is speaking.
9. Session members can exchange text chat messages.
10. The interviewer can export the final diagram as PNG/SVG and JSON.
11. Unauthorized users cannot read or mutate a session by guessing IDs or modifying browser requests.
12. Automated tests cover permissions, concurrent operations, reconnect/resync, link revocation, and export correctness.

## 12. Delivery plan

### Phase 1: Interview room foundation

- Authentication for interviewers.
- Session creation, share link, guest join, waiting room, participant list.
- Session lifecycle and permissions.
- Basic persistence and expiration.

### Phase 2: Collaborative canvas

- Component palette and custom node rendering.
- Drag/drop, resize, labels, selection, deletion, undo/redo.
- Directed edges and edge labels.
- WebSocket synchronization, presence, reconnect, and conflict tests.

### Phase 3: Conversation and controls

- WebRTC audio room through an SFU.
- Text chat.
- Pause/lock/remove controls.
- Shared and interviewer-only notes.

### Phase 4: Review and hardening

- PNG/SVG/JSON export.
- Session snapshot and retention controls.
- Accessibility pass, load testing, observability, abuse protections, and security review.

## 13. Product analytics and observability

Track privacy-safe operational and product events such as:

- Session created, joined, started, paused, ended, and expired.
- Join success/failure and reconnect count.
- Diagram operation latency, rejection rate, and resync count.
- Number and type of nodes/edges created.
- Audio join success, packet-loss/quality buckets, and mute events.
- Export success/failure.

Do not record canvas text, chat content, candidate names, audio, or cursor trails in analytics by default.

## 14. Open decisions

1. Should candidate access be anonymous guest access, authenticated access, or organization-configurable?
2. What is the retention period for diagrams, chat, and interviewer notes?
3. Is video required after the MVP, or should the product integrate with an existing meeting tool?
4. Should interviewers be able to replay diagram history as a timeline?
5. Should the LLM node eventually support provider/model metadata and cost estimates?
6. Are private interviewer notes sufficient, or is a structured rubric required?
7. Which organization, calendar, and identity-provider integrations are needed?
8. What participant and document-size limits should be enforced per subscription tier?

