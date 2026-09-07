# Retro Museum SDK

Open-source game contract, bounded JavaScript runtime and automated compatibility validator.

## Game package

Create a public repository with retro-museum.json and a prebuilt dist/game.rmg.json. The reference implementation is [Werewolves](https://github.com/manaty/game-werewolf). No installation or build scripts from a submission are executed by the marketplace.

The manifest declares schemaVersion 1, id, semantic version, localized title/description (English required), author, SPDX license, languages, players.min/max, durationMinutes, runtime quickjs-v1, entry dist/game.rmg.json, and an empty permissions array. See the starter directory.

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

npm install
npm test
