# Standalone games

The toolkit hosts each game's committed package with a shared-screen room and private phone controllers. Games do not need a Retro Museum installation or an administrator account.

```sh
npm install
npx retro-museum-host --package dist/game.rmg.json
```

Open `http://localhost:4311` and click **Play now**. The organiser gets a display, an invitation link and a QR code. Each phone joins with its own saved name, cropped avatar and language. Only the organiser can start, pause, resume or end a match. Players can replay completed matches. A late arrival spectates until the next match.

On a LAN, set `PUBLIC_ORIGIN` to the reachable address of the computer. Behind an HTTPS proxy, set it to the public HTTPS origin. `PORT` defaults to 4311. `DATA_DIR` defaults to `.local/rooms` and must be durable if sessions should survive restarts. The organiser credential is private; the invitation only grants a player seat. Profiles use the browser's local storage, shared across games on the same origin.

The server runs authoritative game logic inside QuickJS. Phones only receive their own private snapshot. A display receives the public snapshot. The browser view is sandboxed both by its iframe and its HTTP policy, including when opened directly. The view cannot read the host's cookies, local storage or organiser credentials.

Physics advances at 40 Hz, with at most one unacknowledged state per client. Slow devices do not accumulate a backlog. Brief controller outages release held controls and have a 20-second grace period before required players pause the match. File checkpoints occur every 15 seconds and at control/profile changes. A restart retains the match and pauses until required players reconnect. One server process owns each room; multi-process deployments need an explicit room router and ownership coordination. Do not run independent replicas behind a random load balancer.

The host accepts up to 32 rooms by default and limits room creation, player enrollment and message rates. Rooms expire after 24 hours without connected clients or commands. Updates to a game's installed package are pinned by content hash for a room's lifetime; a changed hash is not silently loaded into a saved match.

## Embedding

## Automatic start and Chess ratings

An activity can declare `autoStartWhenFull: true` in its manifest (default: false). This requires a finite `players.max`. Standalone organisers can override it and save game options before players arrive via `POST /api/rooms/:id/control` with `action: "configure"`, `autoStartWhenFull` and `options`. Only authenticated controller connections fill seats; displays, abandoned join forms and duplicate tabs do not. Automatic start only applies to the ready lobby, never to paused or finished games. The setting and options survive room restoration.

Chess controllers ask for an initial local Elo (700 by default). The host validates the profile's optional `chessElo` integer (0–4000). Chess freezes starting ratings per match and publishes `ratings` in its final snapshot and metadata; the host carries these forward for rematches. The browser stores its own result atomically in `museum-chess-rating-v1` and remembers processed match IDs, so refreshes do not apply a result twice. This is an informal rating on the current browser/origin, not a verified federation rating or a cross-device account. Elo uses K=32; wins, losses and chess draws count, organiser cancellations and the host's overall activity deadline do not.

`createGameHost({ definitions, store, publicOrigin })` creates the HTTP/WebSocket server without listening. `loadGame(path)` loads a validated package. A store implements `list()` and `put(room)`; checkpoint data contains private game state and must never be public.

An explicitly configured first-party native engine can be loaded with `loadGame(path, { createEngine })`. This is used for the real ZX80 CPU, which needs its separately installed system ROM. A native manifest uses `native-v1`. The default package validator and marketplace continue to reject native engines: untrusted submissions cannot select or load arbitrary Node.js code.

## Browser transport

The view emits `ready`, then receives `{ retroMuseum: 1, type: 'state', role, state, online, preferences }`. `state.party.community` is the game's own snapshot. Actions use `{ retroMuseum: 1, type: 'action', id, action, value }` and receive an `ack` or `error` with the same id. Only allowlisted audio preferences can be persisted by the parent. Profile cropping, credentials and the invitation QR belong to the host; a game should not implement its own pairing URL.

## Playing remotely on one device

Players can toggle **Screen + controls** on their join page. Portrait places the public game view above the personal controls; landscape puts them side by side. The choice is remembered locally, and a join link can specify `?view=combined` or `?view=controller`. The public view opens a read-only display connection, never a second player seat, and receives no private cards or roles. Hiding it keeps the controller session and inputs intact. Personal display audio starts muted to avoid duplicate effects and has separate preferences from a shared TV.

