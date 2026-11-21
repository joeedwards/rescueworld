# Adoptar.io playable ads

Three standalone, offline HTML5 creatives. Each file contains its own CSS,
JavaScript, and procedural art. There is no build step and no runtime network
request for gameplay.

| Creative | Path | Format | Loop |
|----------|------|--------|------|
| Classic | [`index.html`](index.html) | Portrait-first, ≤30s | Rescue 3 pets → Adoption Center → CTA |
| Three-round | [`three-round/index.html`](three-round/index.html) | Portrait, 60s cap / ~45s clear | R1 no camps → R2 one camp → R3 three camps that can mature into mills and merge into a Pet Mall |
| Horizontal IAB | [`horizontal/index.html`](horizontal/index.html) | Responsive 728×90 + 970×250 | Three waves: pets, one camp, three camps with the same camp → mill → Pet Mall fail path |

Live preview URLs on this host:

- https://adoptar.io/playable-ad/index.html
- https://adoptar.io/playable-ad/three-round/index.html
- https://adoptar.io/playable-ad/horizontal/index.html

`adoptar.io` serves `client/dist/` at `/`. After editing a creative, copy this
directory into the document root so the public URLs stay current:

```bash
rsync -a --delete playable-ad/ client/dist/playable-ad/
rsync -a --delete playable-ad/ client/public/playable-ad/
```

`client/public/playable-ad/` keeps the next Vite client build from dropping the
files. Prefer a dedicated `/playable-ad/` nginx location (see
`nginx-adoptar.io.conf`) when root access is available so the SPA fallback
cannot swallow these paths.

## Classic player promise

Drive a rescue van, collect three stray pets, and bring them to the Adoption
Center to earn Rescue Tokens and find them forever homes.

```text
tutorial
  └─ first drag or movement key → rescue
       ├─ collect 3 pets → deliver
       │    ├─ enter Adoption Center → adopting → success/end-card
       │    └─ timer reaches 0 → timeout → retry
       └─ timer reaches 0 → timeout → retry
```

The 30-second timer starts on the first meaningful input. It stops once the van
reaches the Adoption Center so the adoption payoff cannot be interrupted.

See [`three-round/README.md`](three-round/README.md) and
[`horizontal/README.md`](horizontal/README.md) for the other state machines.

## Controls (classic)

- Mobile and pointer devices: press or drag toward the desired destination.
- Desktop fallback: arrow keys or WASD.
- Only the end-card CTA can open an external destination. Interacting with the
  game never triggers click-through.

## Source-of-truth decisions

Facts retained from the live Adoptar.io implementation:

- The player steers a rescue van and collects nearby stray pets.
- Rescued pets are delivered to the green Adoption Center.
- Each adoption awards 5 RT, matching `TOKENS_PER_ADOPTION` in
  `shared/src/constants.ts`.
- Camps mature into mills; mills, not camps, merge into a mid-match Pet Mall
  (`server/src/game/World.ts`). That is distinct from Boss Mode PetMall.

Creative compression for ad pacing:

- Map size, population, and timers are scaled for a short ad.
- The classic creative omits camps, mills, multiplayer, and Boss Mode.
- The three-round and horizontal creatives compress multi-minute camp growth
  into short threat clocks. That compression is documented in each variant README.

## Local preview

```bash
python3 -m http.server 4173 --directory playable-ad
```

Then open `http://localhost:4173/`, `/three-round/`, or `/horizontal/`.

## Packaging

```bash
cd playable-ad
zip adoptar-io-playable.zip index.html
zip adoptar-io-three-round.zip three-round/index.html
zip adoptar-io-horizontal.zip horizontal/index.html
```

Network limits vary. Before submission, confirm the required archive name,
maximum compressed and uncompressed sizes, entry filename, orientation policy,
click API, privacy requirements, and whether the network injects its SDK.

## CTA integration

Each creative defaults to `https://adoptar.io` and tries:

1. `mraid.open(destinationUrl)`
2. `dapi.openStoreUrl()`
3. `FbPlayableAd.onCTAClick()`
4. `window.open` or a normal link as a browser preview fallback

Gameplay handlers never call the click-out adapter.

## QA checklist

Classic, three-round, and horizontal each have their own checklist in this file
or the variant README. Shared checks:

- No runtime request is required to load or play.
- The browser console remains free of errors.
- Only the CTA attempts external navigation.
- Replay works after success, failure, and timeout.
- Hidden-tab time does not drain the clock.
