# Game acceptance evidence

A passing prevalidation Action proves compatibility with the contract, not that a game is complete. Before submitting a fixed package commit, document and test these scenarios. This checklist applies to human and AI-assisted development.

1. Play through a match with a display and at least two independent controllers (or the game's single-player minimum). Exercise minimum and maximum participant counts; distinguish measured capacity from a declared limit.
2. Cover victory, defeat, draws, no-score outcomes, timeout and host termination. Every completed match must return `status().ended === true`, including `winner: null`. Test the built QuickJS artifact, not just native source classes. Test actual host replay as well as engine recreation.
3. Verify pause/resume, restoration after reconnect, a late spectator joining the next match, and behavior when each required player leaves. Do not keep eliminated players mandatory unless the rules require it.
4. Verify public and opponent snapshots never contain current secret words, cards or roles. Validate commands and rate-limit abuse at the correct layer. Describe free-text/drawing social content honestly; never claim it is moderated unless it is.
5. Test EN/FR/TL where declared, including changing language during play without losing input. Test touch input, narrow phones, shared displays and a real supported older TV. Preserve aspect ratios, avoid scrolling to reach essential controls, and handle missing/rejected fullscreen APIs. State devices that were not tested.
6. Include display and phone screenshots, a short actual-play recording or reproducible browser scenario, instructions, legible turn/result indicators and visual feedback for accepted/refused input. Do not describe a static screenshot as a gameplay test.
7. Honor host sound preferences. Sandboxed games cannot use localStorage: read the state message's `preferences['museum-sound-muted-'+role]` (`'1'` means muted), and send `{retroMuseum:1,type:'preference',key,value:'0'|'1'}` to persist changes. Unlock audio through user interaction. Respect reduced motion; avoid repeated flashes. Document sound sources, including synthesized effects.
8. Explain rule variants and known limitations. Examples: casual automatic chess draws are not all tournament procedures; dictionary length and language quality affect drawing games. Use authoritative rule references and meaningful assertions. Never use assertions that pass unconditionally.
9. List provenance and licenses for code, images, glyphs, words, recordings and music. Package everything needed offline; do not expose secrets or fetch arbitrary external assets.
10. Commit the manifest and rebuilt package together. Verify version/hash, run tests and independent SDK validation, publish an immutable release asset, and submit the new commit. Never imply Apple/Google certification or editorial approval from green CI.

The marketplace currently captures initial screens, not a complete interactive session. Its automated review must retain `needs_review` when gameplay evidence is incomplete. Publisher previews are separate, visibly identified releases, not community-review approvals.
