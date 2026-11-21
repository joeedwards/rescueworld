# Adoptar.io horizontal playable

Self-contained, offline HTML5 creative optimized for the exact IAB 728×90
leaderboard and 970×250 billboard sizes. Open `index.html` directly; there is no
build step or runtime dependency.

## Player promise

Rescue passing pets, stop breeder threats, and earn 5 Rescue Tokens per pet
before a camp grows into a mill and then a Pet Mall.

## State machine

```text
ready → wave 1 (pets) → wave 2 (1 threat) → wave 3 (3 threats)
                         └ missed threats: camp → mill → Pet Mall/failure
      └ final wave cleared → forever-home result
result/failure → replay
```

The sequence uses a fixed 60 Hz simulation step, deterministic target schedule,
and 24-second hard timeout.

## Controls

- Pointer/touch: tap pets and red breeder threats.
- Keyboard: `Space`/`Enter` rescues the nearest pet; `X`/`B` stops the nearest
  threat; `P`/`Escape` pauses; `R` replays after the result.
- Only the explicit **Play Now** CTA can navigate to `https://adoptar.io`.
  Gameplay and replay interactions never click out.

The creative starts muted (it intentionally contains no audio), pauses while
the page is hidden, resumes without consuming hidden time, and responds to
resizing and orientation changes.

## Source facts and creative compression

Live source facts retained:

- Players use a rescue van to collect stray pets.
- Adoption awards 5 RT, matching `TOKENS_PER_ADOPTION` in
  `shared/src/constants.ts`.
- Breeder camps, mills, and the PetMall are established game terms.

Compressed for this ad:

- The full map, driving, delivery, multiplayer, and breeder mini-games become a
  one-axis, three-wave tap-defense loop.
- Missing breeder threats visually escalates camp → mill → Pet Mall. This is a
  legible ad pacing device, not a claim about exact production timing.
- Score values (100 per pet, 150 per stopped threat) are ad-only and
  deterministic. RT is awarded only for rescued pets at the canonical 5 RT.

## QA API

`window.AdoptarioHorizontal` exposes:

- `getState()` — serializable current state.
- `restart()`, `pause()`, `resume()`.
- `hitNext("pet" | "threat")` — activate the nearest matching target.
- `advance(ms)` — deterministically advance up to 30 seconds.

These helpers do not navigate or bypass the normal score/RT rules.

## Packaging and network unknowns

Package `index.html` alone for a generic offline creative. It contains all CSS,
JavaScript, and procedural art.

Before network submission, confirm its archive/size limit, click adapter,
required SDK, sound declaration, CSP, orientation policy, and whether the
browser fallback link is permitted. The CTA supports `mraid.open`,
`dapi.openStoreUrl`, and `FbPlayableAd.onCTAClick`, then uses its normal link in
browser previews. No network-specific compliance claim is made here.
