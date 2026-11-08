# Retro Museum SDK

Open-source game contract, bounded JavaScript runtime and automated compatibility validator.

## Game package

Create a public repository with retro-museum.json and a prebuilt dist/game.rmg.json. The reference implementation is [Werewolves](https://github.com/manaty/game-werewolf). No installation or build scripts from a submission are executed by the marketplace.

The manifest declares schemaVersion 1, id, semantic version, localized title/description (English required), author, SPDX license, languages, players.min/max, durationMinutes, runtime quickjs-v1, entry dist/game.rmg.json, and an empty permissions array. The creator CLI generates a working starter.

The package contains the manifest, an IIFE engine bundle, a complete view HTML document, full licenseText, and an assets map of {type,data} where data is base64. Supported assets: PNG, JPEG, MP3 and WOFF2. Asset paths are relative to assets/ in the HTML.

## Engine API

The bundle defines globalThis.RetroMuseumGame.create(players, saved, options). It returns an object with action(playerId, action, value), advance(seconds), snapshot(playerIdOrNull), save(), release(playerIdOrNull), addPlayer(player), and status().

status returns {winner: string|null, ended: boolean, requiredPlayers: string[]}. Set ended to true for **every** completed match, including draws and zero-score outcomes where winner is null. Release requiredPlayers at completion. An internal phase named "ended" is not sufficient: the host reads status(). Test this on the compiled package, then verify host replay creates a fresh match. snapshot(null) is public; snapshot(id) contains only that player's secrets. save must be JSON-serializable and recreate the same public and private views. Late-player policy is controlled by the engine. No host filesystem, process, networking or module loader is exposed. Cryptographic randomness and a JSON structuredClone helper are available.

## View API

### Optional lobby choices (SDK 1.9)

Declare `lobbyActions: ["chooseCharacter"]` for game-specific setup before the host starts. The standalone host creates a sandbox engine when the first participant arrives and calls `addPlayer` on subsequent arrivals. Repeated reconnects may call `addPlayer` again; it must be idempotent. Only the declared player actions are accepted in the ready phase. The engine must reserve teams/characters authoritatively and validate availability.

At start the host calls `action(null, "hostStart", {...options, players: [connectedPlayerIds]})` on that existing engine. Apply the final options, remove absent participants, and begin the match. Client commands starting with `host` are forbidden. Lobby state is saved, and replay creates a fresh lobby with connected players, including previous spectators. Games without `lobbyActions` retain their existing lifecycle. This capability requires SDK 1.9 or newer on the host.

The view runs in a sandboxed iframe with scripts enabled and an opaque origin. It sends parent.postMessage({retroMuseum:1,type:'ready'}, '*'). The host replies with {retroMuseum:1,type:'state',role:'display'|'controller',state,online}. The public or private game view is state.party.community. The host has already filtered it for this player. Commands are {retroMuseum:1,type:'action',action,value}. Validate event.source===parent on receipt. The host validates the iframe source and all player permissions on the server. Never request pairing tokens, administration credentials or another player's view.

The UI may use local packaged assets and browser audio. External network, cookies, localStorage, top navigation and popups are unavailable. The host manages identities, avatars, QR codes, rooms, pause/replay and versions.

## Validation

validatePackage checks manifest/assets, runtime creation at minimum and maximum player counts, public/private save restoration, 120 ticks, late arrival and release. Reports identify precisely these checks; passing is not proof that every game rule or browser is correct. Each version is pinned by SHA-256. Updating the author repository never silently updates an installed game.

Read the [game acceptance checklist](GAME-QUALITY.md) before submitting; it includes required gameplay, privacy, device and release evidence.

## Tests

```sh
npm ci --ignore-scripts
npm test
```

## Creator toolkit and GitHub Action

Copy [examples/prevalidate.yml](examples/prevalidate.yml) into `.github/workflows/retro-museum.yml`. It runs on pushes and pull requests with read-only repository permissions. `uses: manaty/retro-museum-sdk@v1` accepts a `path` input and produces `status`, `sha256` and `report` outputs. For a reproducible supply chain, pin the Action to a full release commit SHA. Linux GitHub-hosted runners are supported.

Commit your prebuilt package first. The Action installs only the SDK's locked dependencies with lifecycle scripts disabled, then runs the WASM validator in a separate, time-limited process. It never installs or executes your repository's build scripts. The report is stored in the runner's temporary directory; the example uploads it even after a failed check. Do not use `pull_request_target` to run untrusted pull-request code.

For local development, clone this SDK, run `npm ci --ignore-scripts`, then `node create-game.js my-game`. Edit the generated files, run `node build.mjs` in your game directory and `node /path/to/retro-museum-sdk/validate.js /path/to/my-game` to prevalidate. No account or API key is needed.

```sh
git clone https://github.com/manaty/retro-museum-sdk.git
cd retro-museum-sdk
npm ci --ignore-scripts
node create-game.js my-game
node validate.js my-game
```

A passing Action is feedback for the author, **not marketplace approval**. The marketplace fetches a fixed source commit, independently validates the exact artifact and applies its versioned content policy and AI review. Changes require a new submission. See [marketplace policy](https://github.com/manaty/retro-museum-marketplace/blob/main/POLICY.md).

The standalone host accepts optional `allowedOrigins` alongside `publicOrigin` when migrating a domain. Invitations stay on the recognised hostname used by each visitor, so existing links and locally stored player profiles continue to work. Local and cloud room stores retain the exact game package pinned to each room.

Views may announce `{ retroMuseum: 1, type: 'ready', renderAck: true }` and answer each state with `{ retroMuseum: 1, type: 'rendered', renderId }` after rendering. This prevents slow displays from accumulating obsolete frames. Existing views without this capability remain supported. A `suspend` message asks the view to release held controls and conceal temporary private cards when host settings open.

## Player invitations and live catalogs

Every standalone player screen includes **Invite a player**, translated into English, French and Tagalog. It immediately opens a QR-code dialog and copies the invitation URL when the browser permits it. The dialog keeps the link selectable if copying is blocked, offers another copy button, and provides explicit native sharing when available. The payload and QR contain the public join URL, never a player credential or organiser token. The museum can reuse this control through `@manaty/retro-museum-sdk/share`; supply a `qrUrl` callback to enable the QR dialog. Without that callback, the existing native-share-first behavior remains supported.

Hosts can add approved immutable packages through `registerGame(definition)` and remove games from new-room listings through `removeGame(id)`. Existing rooms keep their original package, including after restart. `refreshGames` allows a host to resolve a newly published game when its direct URL is opened. Package registration is an operator-side API; no public route accepts arbitrary code or repository URLs.

## Classroom-sized activities (1.4)

A manifest may declare `players.max: null` for activities limited by host capacity instead of game rules. The standalone host defaults to 128 participants for these activities; operators can set `playerCapacity` (1–1000) when creating the host. This is a resource guard, not a measured Wi-Fi capacity. Other games retain their existing player and spectator limits. Compatibility validation exercises 1/minimum and 128 clients; it is not a network load test. Host-limited activity snapshots are delivered at most twice per second.

Options may also use `{label:{en:"Questions"},type:"integer",min:1,max:100,default:10}`. The organiser sees an integer choice and the host rejects out-of-range or non-integer values. Engines must additionally validate content-dependent limits, such as how many questions exist in the selected questionnaire.
# Offline lookup tables (SDK 1.5)

An optional package `data` object carries read-only lookup tables for large offline vocabularies. Each table is `{ "encoding": "gzip-base64", "data": "…" }`. Decoded UTF-8 consists of sorted, unique `key\tvalue` rows separated by newlines. Table names contain lowercase ASCII letters, digits or hyphens; keys accept those characters and `ñ`, at most 80 characters. Values are at most 1,000 characters. Up to 32 tables share a 64 MiB decoded limit and remain inside the existing 24 MiB complete-package limit.

The isolated engine calls `__dataLookup(table, key)` and receives a string or `null`. It can read only data included in its own package. No file paths, network calls, mutable data or host objects are exposed. Tables are validated and decoded once per loaded package, outside the VM; individual lookups use bounded binary search. A native adapter can import `prepareData` from `@manaty/retro-museum-sdk/data` for identical results. Packages using this feature require SDK 1.5+ on their host.

Data must include its source and licence in the repository and the package licence text. The offline table channel does not replace technical and editorial marketplace review.

## Shared room lifetime (SDK 1.6)

A room releases its active slot and game engine 30 seconds after its last authenticated controller disconnects. An open display, organiser page, QR poll or HTTP join request does not keep a slot occupied. New empty rooms use the same grace period.

The saved match, credentials, profiles and original game version remain resumable for **10 minutes from the last controller disconnect**, including the initial 30 seconds. A returning controller reclaims an available slot and restores its match; if capacity is full, it can retry without extending the deadline. At expiry the room record is deleted, display connections close and clients show a translated expiration message. Browser-stored player profiles are unchanged.

Restarts preserve the absence deadline; a connected room gets a reconnection grace period after a server restart. Legacy abandoned rooms older than ten minutes are discarded on startup. Custom persistent stores must implement asynchronous `delete(roomId)` in addition to `list`, `put`, `putPackage` and `getPackage` to physically remove expired room records.

`GET /health` reports active `rooms`, dormant `savedRooms`, `connectedPlayers` and `playingRooms` separately. Saved rooms do not consume `maxRooms`. This policy applies to shared standalone rooms; museum stations use their own visit lifecycle. Dedicated paid rooms are a future product, not implemented by this policy.

## Acknowledged state deltas (SDK 1.10)

The browser host negotiates `stateDeltas: 1` in its socket hello. The initial rollout is limited to Serpents; other games and older clients retain full snapshots. Game frames still receive the same reconstructed state through `postMessage`, so the game rendering contract is unchanged. Controller updates remain capped at 10 Hz and displays at 20 Hz, with existing rendering acknowledgements and backpressure.

Each socket owns its baseline, committed only after the matching state acknowledgement. Stable `id` arrays transmit additions, removals and changed fields. Serpents trajectory points use `[x,y,sequence]` and descending sequence order. Full snapshots are sent on connect, match changes, resynchronisation, or when a delta would not save at least 10%. A browser detecting a missing baseline requests `resync`. No credentials or private snapshots are shared across clients. `StateEncoder` and `StateDecoder` are exported through `@manaty/retro-museum-sdk/state-delta` for protocol testing.

## Installable app and offline play over a Wi-Fi hotspot (SDK 1.13)

The standalone host is an installable web app (manifest, icons and service worker at `/sw.js`). Pages, scripts and `/api/games` are network-first with a cached fallback. `/packages/HASH/package.json` serves each complete immutable package; the service worker caches it, and `/api/games` marks each game `offline: true|false`. Native engines (for example ZX80) are not available offline.

**Download games for offline play** on the catalogue stores every offline-capable package in Cache Storage and requests persistent storage. The organiser's device needs the downloaded games. Players only need to have opened the app once while online: a connected player who lacks a game receives the verified package from the organiser over the local link.

With **Offline games (Wi-Fi hotspot)** enabled, creating a game starts an in-browser host on the organiser's device. It reuses `RoomParty` with QuickJS compiled to WebAssembly (`/quickjs.wasm`) and the same request and socket protocol as `host.js`, so the standard client UI is unchanged. Rooms are saved in IndexedDB and restored if the hosting tab reloads; offline rooms are kept for 24 hours. Tabs on the same device share one host through Web Locks and `BroadcastChannel`; another tab takes over if the hosting tab closes.

Players join without any server or Internet:

1. The organiser turns on their phone's Wi-Fi hotspot (or all devices use the same Wi-Fi) and creates an offline game.
2. The organiser screen shows an invitation QR code containing a WebRTC offer (no STUN/TURN, local addresses only). A player scans it with the camera or **Join an offline game** in the app.
3. The player's phone displays an answer QR code, which the organiser's camera reads. A data channel then carries the room protocol (requests and sockets are tunnelled; large messages are chunked).

Each invitation code is single use; a new one appears after each connection. If a player's connection drops, their phone asks them to scan the current code again and keeps the same seat. The organiser's device needs a camera; codes can also be pasted for testing. Avatars are omitted offline; device transfer links are not available offline.

Game views remain in an opaque-origin sandbox. Because browsers never let service workers serve sandboxed frames, offline views use a small loader document: the parent sends the view HTML and package assets by `postMessage`, the loader creates blob URLs inside the sandbox and writes the view. Static `assets/…` references and common dynamic ones (`img.src`, media `src`, `setAttribute`, `Audio`, `fetch`, `XMLHttpRequest`, `FontFace`) are mapped. A view's content security policy then only allows inline code and blob/data resources.

Limits: browser support for local WebRTC connections varies. Chromium only reveals the real local address in the offer after camera permission is granted, which the organiser's pairing screen requests first. Some Android hotspots or managed networks isolate clients; then use any ordinary Wi-Fi access point. This has been verified with automated browser tests on one computer, not yet on a whole class of phones.

A browser check is in `scripts/offline-e2e.cjs` (Playwright): it downloads games, stops the origin server, hosts UNO and Werewolves offline, pairs players by code, starts a match and transfers a 20 MB package to a player.

Run `npm run build` after changing `web/host-source.js` or `web/offline/*`; the bundles (`host-client.js`, `offline.js`, `offline-runtime.js`) and `quickjs.wasm` are committed so hosts never run a build step.
