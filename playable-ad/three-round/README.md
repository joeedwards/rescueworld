# Adoptar.io three-round playable

Self-contained, offline HTML5 creative. Open `index.html` directly; it has no
build step, external assets, runtime requests, audio, analytics, or dependencies.

## Player promise and state machine

**Promise:** Steer a rescue van, find forever homes for stray pets, then stop
Breeder Camps before they grow into Breeder Mills and merge into a Pet Mall.

```text
tutorial → round 1 → transition → round 2 → transition → round 3
                                                        ├─ cleared → success
                                                        └─ 60s cap → failure
success/failure → unlimited replay → tutorial
```

The cap starts with the first steering input. A typical clear is approximately
45 seconds. Visibility changes and the pause control stop the deterministic
game clock.

## Controls

- Drag/press in the playfield to steer.
- Use WASD or arrow keys as a desktop fallback.
- Near a Breeder Camp, Breeder Mill, or Pet Mall, hold **CARE** (or Space).
- Pause/resume with the top-right control or Escape.
- Only the explicit **Play Adoptar.io** CTA can navigate to
  `https://adoptar.io`; gameplay and replay never click out.

## Source facts and creative compression

Retained from `server/src/game/World.ts` and `shared/src/constants.ts`:

- Rescue vans collect nearby stray pets and deliver them to a green Adoption
  Center.
- Each adoption awards 5 Rescue Tokens (RT).
- Breeder Camps grow into Breeder Mills, and mills can merge into a Pet Mall.

Compressed for the playable:

- Round 1 uses three pets and omits camps.
- Production's multi-minute camp growth is represented by short, independent
  threat clocks.
- CARE is a forgiving hold-in-range abstraction of shutting down breeder
  structures.
- Multiplayer, shelters, ingredients, the Breeder Tycoon, server state, and
  progression are intentionally omitted.

## QA API

`window.AdoptarioThreeRound` exposes:

- `getState()` — serializable state, timers, rewards, and threats.
- `restart()` — unlimited deterministic replay reset.
- `advanceTime(ms)` — advances the game clock in fixed steps (capped at 65s).
- `moveVanNearObjective(index)` — moves the van to a current pet, center, or
  threat for focused QA.
- `setCareHeld(boolean)` — controls CARE without synthesizing pointer input.

## Packaging unknowns

This generic portrait-first creative uses common CTA adapters (`mraid`, `dapi`,
and `FbPlayableAd`) with `window.open` only as a local-preview fallback. Before
network submission, confirm its SDK/click API, size cap, archive structure,
orientation rules, sound policy, privacy requirements, and whether browser
fallbacks are permitted. No network-specific compliance is claimed.
