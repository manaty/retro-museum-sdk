# Retro Museum SDK

Open-source game contract, bounded JavaScript runtime and automated compatibility validator.

## Game package

Create a public repository with retro-museum.json and a prebuilt dist/game.rmg.json. The reference implementation is [Werewolves](https://github.com/manaty/game-werewolf). No installation or build scripts from a submission are executed by the marketplace.

The manifest declares schemaVersion 1, id, semantic version, localized title/description (English required), author, SPDX license, languages, players.min/max, durationMinutes, runtime quickjs-v1, entry dist/game.rmg.json, and an empty permissions array. The creator CLI generates a working starter.

The package contains the manifest, an IIFE engine bundle, a complete view HTML document, full licenseText, and an assets map of {type,data} where data is base64. Supported assets: PNG, JPEG, MP3 and WOFF2. Asset paths are relative to assets/ in the HTML.

## Engine API

The bundle defines globalThis.RetroMuseumGame.create(players, saved, options). It returns an object with action(playerId, action, value), advance(seconds), snapshot(playerIdOrNull), save(), release(playerIdOrNull), addPlayer(player), and status().

status returns {winner: string|null, requiredPlayers: string[]}. snapshot(null) is public; snapshot(id) contains only that player's secrets. save must be JSON-serializable and recreate the same public and private views. Late-player policy is controlled by the engine. No host filesystem, process, networking or module loader is exposed. Cryptographic randomness and a JSON structuredClone helper are available.

## View API

The view runs in a sandboxed iframe with scripts enabled and an opaque origin. It sends parent.postMessage({retroMuseum:1,type:'ready'}, '*'). The host replies with {retroMuseum:1,type:'state',role:'display'|'controller',state,online}. The public or private game view is state.party.community. The host has already filtered it for this player. Commands are {retroMuseum:1,type:'action',action,value}. Validate event.source===parent on receipt. The host validates the iframe source and all player permissions on the server. Never request pairing tokens, administration credentials or another player's view.

The UI may use local packaged assets and browser audio. External network, cookies, localStorage, top navigation and popups are unavailable. The host manages identities, avatars, QR codes, rooms, pause/replay and versions.

## Validation

validatePackage checks manifest/assets, runtime creation at minimum and maximum player counts, public/private save restoration, 120 ticks, late arrival and release. Reports identify precisely these checks; passing is not proof that every game rule or browser is correct. Each version is pinned by SHA-256. Updating the author repository never silently updates an installed game.

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
