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

Every standalone player screen includes **Invite a player**, translated into English, French and Tagalog. It opens the device's native share sheet when available, then falls back to copying or selecting the invitation URL. Cancelling a share does not copy anything. The payload contains the public join URL, never a player credential or organiser token. The museum can reuse this control through `@manaty/retro-museum-sdk/share`.

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
