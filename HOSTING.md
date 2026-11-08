# Standalone games

The toolkit hosts each game's committed package with a shared-screen room and private phone controllers. Games do not need a Retro Museum installation or an administrator account.

```sh
npm install
npx retro-museum-host --package dist/game.rmg.json
```

Open `http://localhost:4311` and choose **Play solo** or **Play together**.
Solo is offered when the manifest declares `players.min: 1` or the game provides
robot opponents. It enrolls the creator as one human player and completes the
minimum seats with medium robots when needed. Each robot's difficulty can be
changed before starting. The creator keeps organiser controls on that device.
The shared-screen route also offers **Play on this device**.

Games may declare `singleDeviceView: "controller"` when their player view already
contains the complete board and controls (UNO and Chess). Other solo activities
open `?view=combined` by default. The screen toggle remains available. Mobile
host controls stay compact, with settings in a collapsible panel.

For shared play, the organiser gets a display, an invitation link and a QR code. Each phone joins with its own saved name, cropped avatar and language. Only the organiser can start, pause, resume or end a match. Players can replay completed matches. A late arrival spectates until the next match.

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


## Private data transfers

`createGameHost({requestHandler})` can serve integration routes before the standard
routes; return `true` only when the response is handled. POST origin checks run
before this hook. Server code may call `host.createRoom(request, input, definition)`
with a SHA-256-bound QuickJS package to create a room without adding a public
catalog entry. The shared origin, rate and active-room limits still apply. The
package is checkpointed with the room and restored by hash after restart.
Only trusted server code supplies this definition; never pass an uploaded engine
through this API without its own code-review boundary. The Tara integration uses
only questionnaire data inside the host's pinned quiz engine.

## Robot players (capability API 1)

An engine can opt in through its manifest:

```json
{"bots":{"apiVersion":1,"difficulties":["easy","medium","hard"]}}
```

Implement `botAction(playerId, difficulty)` alongside the other engine methods.
Return `null` if the robot should wait, or `{action, value}` for one legal player
command. Decisions must not mutate the engine. The host executes the command
through normal player-action validation and applies the existing 40 ms VM limit.
Decisions must use only public information and that robot's own private state.
API 1 does not yet support games declaring `lobbyActions`.

Room creation and organiser-only `configure` accept a `bots` array, for example
`[{difficulty:"easy"},{difficulty:"hard"}]`. To keep a robot while changing its
level, include its server-issued `id`. Omit it to create a robot; omitting an
existing robot from the array removes it. A game must retain at least one human
seat. Rosters cannot change after starting. The pilot games are UNO and Chess;
other multiplayer games remain unavailable in solo until their engines opt in.

The host creates robot identities without browser credentials or sockets. Names,
levels and identities persist in room checkpoints and rematches. Robots stop
when the match pauses, and do not prevent empty-room suspension or expiry.
Robot callbacks are sampled at most once per host tick with per-robot thinking
intervals. Chess robot games are practice and never update local Elo.

### Open the board or your controls on another device

In a player session, **Use another device** offers a link and QR code for either
of these views:

- **Shared board** opens `/r/:room?view=screen`, a read-only display without the
  invitation sidebar. Opening it does not create a player.
- **My personal screen** resumes the current player with `view=controller`.
  The authenticated player creates a transfer using `POST /api/rooms/:room/handoff`
  with their bearer credential. The returned URL contains a random transfer key
  in its fragment, never the player credential or organiser token. The receiving
  browser removes the fragment, redeems it using `POST /api/rooms/:room/redeem`,
  and stores the existing player credential locally. Name, avatar, private state,
  and player identity are preserved. Organiser privileges stay on the source device.

Transfers are single use, expire after five minutes, and are kept only in server
memory. Creating another transfer invalidates the previous transfer for that
player. Treat this link as private: whoever redeems it can control that player.
The original browser keeps access to the same player. After scanning, the source
browser can show only the board, or retain only its controls using the modal's
local-view button. Neither action starts a new match.


### Invitations and paused rooms

The invitation button stays available in player and shared-board views, including
on mobile while the game is paused. Invitation dialogs sit above room content;
a game's pause overlay remains confined to its iframe.

A shared-board connection can authenticate the organiser with `hostToken` in its
WebSocket hello. This keeps the room available while phones are disconnected,
including during a manual pause. It grants no player identity and still receives
only public game state. Public display connections cannot extend retention.
Once the last authenticated player or organiser disconnects, the room releases
active capacity after 30 seconds and expires after ten minutes. New arrivals and
returning players do not clear an organiser's manual pause; only Resume does.
