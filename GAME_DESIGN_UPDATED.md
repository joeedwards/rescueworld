# Adoptar.io - Game Design Document

## Overview

**Adoptar.io** is a competitive .io-style multiplayer game where players operate rescue vans to save stray pets from the streets and dismantle evil breeder mills. Players collect strays, deliver them to adoption centers, expand their rescue operations, and compete for **leaderboard glory** by placing the most pets into **forever homes**.

The game blends casual collection, routing efficiency, and event-based competition into an accessible experience that supports quick sessions, long runs, and seasonal races — without requiring PvP “base attacks” or match timers.
## Core Fantasy

You are a **pet rescuer** racing the city’s chaos and breeder mills to save as many animals as possible. Your rescue van collects strays from the streets, and your shelter upgrades turn those rescues into efficient, high-quality **adoptions**.

Your operation can grow endlessly (bigger vans, better shelters, more staff), but the true prestige is **impact**: how many pets you place into forever homes, how well you match them, and how you show up during high-stakes adoption events.
## Game Modes

### Free For All (FFA) — Endless Session
- Up to 8 players compete simultaneously
- Real players join a lobby; empty slots filled with CPU bots
- **No match timer** by default: players compete for **Daily / Weekly / Seasonal Adoption Score**
- Sessions are drop-in / drop-out; players can leave and re-queue without "ending" the lobby
### Solo vs CPU
- Single player against AI-controlled opponents
- CPUs actively compete for resources and attack breeder mills
- Good for practice or when no other players are available

---

## Core Gameplay Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   COLLECT STRAYS → DELIVER TO CENTER → EARN RT → BUILD/UPGRADE │
│         ↑                                              │        │
│         └──────────────────────────────────────────────┘        │
│                                                                 │
│              ↓ Once Shelter Built ↓                            │
│                                                                 │
│   GROW SHELTER → ABSORB TERRITORY → DOMINATE MAP → WIN         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1: Collection
- Drive your rescue van around the map
- Collect stray pets (orange circles) by driving near them
- Van has limited capacity based on size (max 50 pets)
- Avoid enemy vans and shelters early game

### Phase 2: Adoption
- Deliver collected pets to the central **Adoption Center** (green zone)
- Each adoption earns:
  - **+1 Size** for your van
  - **+5 Rescue Tokens (RT)** currency
  - Progress toward leaderboard ranking

### Phase 3: Building
- Once you accumulate 50+ size and 250+ RT, build a **permanent shelter**
- Shelter becomes your base of operations
- Shelter grows with each adoption, expanding your territory

### Phase 4: Events & Placement Excellence (Endless)
- After building a shelter, your focus shifts from "getting bigger" to **placing more pets into forever homes**.
- Dynamic **Adoption Events** spawn around the city (School Fair, Farmers Market, Petco Weekend, etc.).
- Events and quality placements drive your **Adoption Score** (leaderboard), while growth continues to unlock efficiency upgrades.

> **No match timer and no map-domination win screen** in the default mode — sessions are endless and competitive through leaderboards.
## Resources & Currency

### Rescue Tokens (RT)
The primary in-game currency earned through:
- **Adoptions**: 5 RT per pet adopted at main center, 10 RT at your shelter
- **Breeder Mill Raids**: Scaling rewards based on mill level (80-500+ RT)
- **Daily Gifts**: Login rewards for registered players
- **Match Winnings**: All earned RT saved to account at match end

RT is used for:
- Building a shelter (250 RT)
- Purchasing upgrades (Adoption Center, Gravity, Advertising, Van Speed)
- Stored between matches for registered users

### Size
Represents your rescue operation's scale, but **does not directly determine "winning."**

- **Van size** determines pet capacity (up to 50) and unlocks van-focused upgrades.
- **Shelter size** represents operational scale (staffing, intake, adoption throughput).
- Size is primarily gained through successful adoptions (+1 per pet) and certain power-ups.
- Size **does not** need to scale your on-screen shelter forever; see **Shelter Growth & Visual Scaling** for caps and decoupling.

> Design goal: keep the dopamine of growth, while prestige comes from **Adoptions Delivered** (leaderboards).
## Pickups & Power-ups

Scattered across the map are collectible power-ups:

| Pickup | Color | Effect |
|--------|-------|--------|
| **Growth Orb** | Green | +Size immediately |
| **Speed Boost** | Blue | Temporary movement speed increase |
| **Random Port** | Purple | Teleport to random safe location |
| **Home Port** | Teal | Teleport back to your shelter |

**Spawn Distribution**: 60% Growth, 25% Speed, 10% Random Port, 5% Home Port

---

## Shelter System

### Building Requirements
- Van size ≥ 50
- 250 RT available
- Not already owning a shelter

### Shelter Upgrades

| Upgrade | Cost | Effect |
|---------|------|--------|
| **Adoption Center** | 500 RT | Adopt pets directly at shelter (required for win) |
| **Gravity** | 400 RT | Automatically pull nearby strays toward shelter |
| **Advertising** | 350 RT | Increase stray spawn rate near shelter |
| **Van Speed** | 300 RT | Permanent van movement speed boost |

### Shelter Growth & Visual Scaling (Prevent Screen-Filling Shelters)

Shelters still "grow" as your operation succeeds, but growth is split into two layers:

**A) Functional Growth (keeps increasing)**
- **Capacity**: max pets your shelter can hold
- **Staff Slots**: how many workers / vans can be assigned to tasks
- **Adoption Throughput**: how many pets can be processed per minute
- **Event Readiness**: ability to staff more/higher-tier Adoption Events

**B) Visual / Map Footprint (capped)**
To avoid shelters becoming so large you can't see the map:

1. **Hard visual cap**
   - Shelter sprite + footprint stops scaling after a max "visual tier" (e.g., Tier 5).
   - Additional growth is shown via UI (level badge, glow intensity, banner, particle effects), not by size.

2. **Decouple size from territory**
   - Remove "territory radius = shelter size" as the primary feedback loop.
   - If you keep a radius for mechanics (e.g., passive pet attraction), cap it:
     - `functional_radius = min(MAX_RADIUS, BASE_RADIUS + tier * RADIUS_STEP)`
   - Show any extra scale as **Efficiency** (faster intake, higher quality matching), not a bigger circle.

3. **Tiered visuals**
   - Shelter has discrete **Shelter Tiers** (1–5) for visuals and collision size.
   - “Shelter Level” can continue beyond Tier 5, but visuals stay Tier 5.

4. **Camera & UI protection**
   - Camera zoom stays locked to van gameplay.
   - Use minimap markers + an on-screen “Shelter Status” card (Capacity / Staff / Throughput) so players feel growth without giant geometry.

> Result: endless growth remains meaningful, but the map stays readable and the game stays playable.

### Territory & Domination (Reframed)
Default mode does **not** end via map domination. If you want "territory" flavor, treat it as **logistics influence** instead of ownership:
- Nearby strays are slightly more likely to path toward higher-tier shelters.
- Local Adoption Events may spawn more often near active shelters.
- Influence is capped and primarily used to shape routing decisions — not to declare victory.
## Combat System

### Van vs Van Interaction (Jostle, Not Combat)
Adoptar.io competition is primarily about **outperforming**, not destroying other shelters.

When two non-allied vans overlap for extended time:
1. **Grace Period**: Brief window to click "Ally" and avoid conflict
2. **Jostle Outcome**: the smaller van drops a small portion of carried pets back onto the street as strays (no elimination)
3. **Momentum Tax**: both vans get a short slow-down (prevents "body blocking" abuse)
4. **No Size Drain**: size is not stolen from other players in the default rule set

> Optional arcade mode can re-enable classic .io “absorb” rules, but the default theme-forward mode avoids predatory PvP.
### Shelter Interactions (Help, Not Hurt)
Shelters are not "attacked" in the default mode. Instead, player-to-player interaction is cooperative and logistical:

- **Transfers**: deliver pets to another player's shelter for a negotiated split of Adoption Score (e.g., 70/30).
- **Overflow Relief**: if a shelter is at capacity, nearby allied shelters can accept overflow for a bonus.
- **Mentorship Buffs**: higher-tier shelters can “sponsor” new shelters:
  - Sponsor gains small reputation/score bonus for successful placements by the mentee
  - Mentee gains temporary efficiency boosts (intake speed, event staffing)
- **Co-op Drives**: shared objectives (e.g., “City Crisis Week: place 10,000 pets as a community”) with spotlight rewards for top contributors.

> This keeps the world social and competitive without shelter raids or griefing.
### Breeder Mill Combat
- Breeder mills are AI-controlled enemy structures
- Levels 1-15, growing stronger over time
- Attacking triggers a **mini-game**: quickly feed the correct food to rescue pets
- Rewards scale with level (more RT, more random boosts)

---

## Alliance System

### Forming Alliances
- Click/tap another player's shelter to request alliance
- Other player sees accept/deny popup
- Both players must agree for alliance to form

### Alliance Benefits
- No push-apart when overlapping
- Can deliver pets to allied shelters
- No combat damage between allies
- Allied vans can coordinate shelter attacks

### CPU Alliances
- CPU players randomly offer alliances to nearby humans
- CPUs have 40% base acceptance rate (higher if human is larger)

---

## Breeder Mills

### Overview
Evil structures that spawn wild strays and must be shut down. They represent the antagonist faction in the game's narrative.

### Mechanics
- Spawn randomly on the map
- Grow in level over time (1-15)
- Continuously spawn stray pets
- Can only be attacked when `cpuCanShutdownBreeders` is enabled

### Mini-Game
When attacking a breeder mill:
1. Modal appears with pet needing rescue
2. Three food options displayed
3. Select correct food to rescue pet
4. Repeat for multiple rounds based on level
5. Rewards granted on completion

### Rewards by Level
| Level Range | RT Reward | Bonus Boosts |
|-------------|-----------|--------------|
| 1-3 | 80-120 | 1-2 random |
| 4-6 | 160-240 | 2-3 random |
| 7-9 | 300-400 | 3 random |
| 10+ | 400-600 | 3-4 random |

---

## Progression & Persistence

### Guest Players
- Temporary progress, lost on disconnect
- Cannot access leaderboards or daily gifts
- Nickname randomly generated

### Registered Players

**Saved Between Matches**:
- All earned RT stored in "chest"
- Unused port charges (random + home)
- Speed and size boosts
- Nickname and shelter color preference

**Leaderboard Tracking**:
- Total all-time wins
- Total RT earned
- Daily wins (resets at midnight)
- Top 10 daily players receive bonus chest

### Daily Gift System
- 7-day login streak rewards
- Escalating rewards each day
- Day 7 offers premium reward chest
- Must be registered to claim

---

## User Interface

### HUD Elements
- **Top Bar**: Score, timer, game clock, settings
- **Domination Indicator**: Shows leader's name and map coverage %
- **Bottom Buttons**: Menu, ports, shelter navigation
- **Minimap**: Shows player positions, shelters, pickups, breeder mills

### Action Menu (E key)
- Build Shelter section (when no shelter)
- Upgrade options (when shelter exists)
- Van upgrades
- Costs and availability displayed

### Announcements
- Scrolling marquee banner for game events
- Breeder spawn notifications
- Combat outcomes
- Milestone achievements

---

## Audio Design

### Music
- Ambient background music (toggleable)
- Looping track suitable for extended play

### Sound Effects
- Pickup collection (growth, speed, port)
- Adoption success
- Combat sounds
- UI interactions
- Welcome/start game fanfare

---

## Visual Style

### Art Direction
- Bright, friendly color palette
- Cartoon-style pet representations
- Van design: Rounded rescue vehicle with visible wheels
- Shelter design: Building with peaked roof, kennels visible

### Color Language
- **Green**: Player's shelter, positive feedback, growth
- **Blue**: Speed, allies
- **Purple**: Teleportation, ports
- **Red/Orange**: Breeder mills, danger, enemies
- **Yellow**: Currency (RT), menu, warnings

---

## Competitive Elements (Endless Leaderboard Play)

### Primary Objective
There is no single “match win” in the default mode. The core objective is to **place the most pets into forever homes** and climb the leaderboards.

- **Leaderboard = adoptions, not size**
- Growth still matters because it increases **capacity, staffing, throughput, and event readiness**
- Players compete through **routing, optimization, and event performance**, not shelter attacks

---

## Scoring & Leaderboards

### Leaderboard Types
- **Daily**: Adoption Score earned today (resets daily)
- **Weekly**: Adoption Score earned this week (resets weekly)
- **Season**: Adoption Score earned this season (resets at season end; awards cosmetics/titles)
- **All-Time**: Total forever homes placed (prestige stat; never resets)

### What “Size” Does (and does NOT do)
- **Does**: increases operational power (capacity, upgrades, staffing, efficiency)
- **Does NOT**: determine leaderboard rank directly, and does not create screen-filling shelters

---

## Adoption Events (Competition Through Scarce Opportunities)

Adoption Events are limited-time objectives that spawn around the map:
- Examples: **School Fair**, **Farmers Market**, **Petco Weekend**, **Stadium Game Night**
- Events request a **mix** of pets (e.g., 4 cats + 2 small dogs + 1 special)
- Players compete to staff the event and deliver the right pets quickly
- Top contributors gain **large Adoption Score payouts** and **Reputation** boosts

Event structure (suggested):
- **Spawn cadence**: 1–2 active events per map area; new event spawns when one ends
- **Duration**: 2–4 minutes each (local timer, not a match timer)
- **Rewards**:
  - Completion payout (flat points)
  - Rank payout (Top 1/2/3 + participation)
  - Temporary city-wide buff (e.g., +10% adoption throughput for 60s)

---

## Quality, Variety, and Anti-Grind Scoring

Raw adoption volume should feel strong (e.g., ~100/day at a Level 10 shelter), but not “solved.”
To do that, leaderboard points come from **Adoption Score**, not a simple adoption count.

Below are three concrete scoring formulas you can implement (choose 1 as primary, keep others as variants/tuning tools).

### Formula A — Per-Adoption Points with Diminishing Returns (Simple + Tunable)
For each pet adopted out:

`Points = BASE * Q * D * S * E * G`

Where:
- `BASE = 10`
- `Q` (Match Quality) ∈ `[0.6 … 2.0]`
  - 1.0 = acceptable home
  - 1.5 = strong match
  - 2.0 = ideal match (rare / requires good play)
- `D` (Diversity Bonus) = `1 + 0.05 * min(8, distinct_pet_types_today - 1)`  → caps at `1.35`
- `S` (Streak Bonus) = `1 + 0.03 * min(10, perfect_days_streak)` → caps at `1.30`
- `E` (Event Multiplier) = `1.0` normally, `1.25–3.0` when fulfilling event requirements
- `G` (Anti-Grind) = `max(0.50, 1 / (1 + (N_today / 200)^1.3))`
  - First ~100 adoptions/day still score strongly
  - Extreme grinding hits diminishing returns (but never drops below 50%)

Why this works:
- Volume still matters (Level 10 doing 100/day feels great)
- The top of the leaderboard requires **quality + variety + event play**, not just farming

### Formula B — Reputation-Weighted Score (Punishes Sloppy Grinding)
Track `Reputation` as a rolling value `[0 … 100]` affected by returns, quality, and event performance.

Per-adoption points:
`Points = BASE * Q * E`

Leaderboard score:
`LeaderboardScore = TotalPoints * (1 + Reputation / 100)`

Suggested reputation updates:
- On adoption: `Reputation += 2*(Q - 1)`  (ideal matches raise it, poor matches lower it)
- On return: `Reputation -= 8`
- On event top-3 finish: `Reputation += 3`
- Clamp between `0` and `100`

Why this works:
- Players can’t brute-force forever without quality: returns and low-Q placements drag their multiplier down
- High-skill players separate themselves via consistency and event execution

### Formula C — Weekly “Impact” with Sublinear Volume (Anti-Grind by Math)
Compute a weekly score that rewards scale but compresses huge volume:

`WeeklyImpact = Σ_day ( (Adoptions_day ^ 0.70) * AvgQuality_day * (1 + 0.10 * EventPodiums_day) )`

Why this works:
- Doubling volume does **not** double score
- Strong for grinders, but “solved” farming won’t dominate without quality and podiums

---

## Seasonal Structure (Endless, but Meaningful)

- **Daily & Weekly** leaderboards reset to keep races fresh
- **Season** leaderboard (e.g., 4–8 weeks) awards:
  - titles (e.g., “Top Rescuer”, “Matchmaker”, “Event MVP”)
  - cosmetic shelter/van skins
  - profile badges
- **All-Time Forever Homes** remains the long-term prestige metric

---

## Skill Expression (Theme-Forward)
- Optimal routing for stray collection + deliveries
- Event prioritization and loadout planning (right pet mix, right timing)
- Quality matching decisions (maximize Q without tanking throughput)
- Alliance negotiation and cooperative logistics (transfers, mentorship, co-op drives)
- Breeder mill prioritization (PvE pressure without griefing)
## Monetization Considerations

### Current Implementation
- Free to play
- No premium currency
- No pay-to-win mechanics

### Potential Future Features
- Cosmetic shelter skins (earned through referrals)
- Van customization
- Pet variety packs
- Battle pass style seasonal content

---

## Technical Specifications

### Networking
- WebSocket-based real-time multiplayer
- Server-authoritative simulation
- 25 tick/second update rate
- Client-side prediction for responsiveness

### Platform Support
- Web browser (desktop + mobile)
- Touch controls for mobile
- Keyboard/mouse for desktop

### Performance Targets
- 60 FPS rendering
- <100ms input latency
- Support 8+ concurrent players per match

---

## Design Pillars

1. **Accessible**: Easy to understand, hard to master
2. **Competitive**: Meaningful player-vs-player interaction
3. **Progressive**: Clear sense of growth and achievement
4. **Social**: Alliance and rivalry systems
5. **Thematic**: Rescue fantasy feels good, fighting breeders feels righteous

---

## Future Roadmap Ideas

- [ ] Team modes (2v2, 4v4)
- [ ] Seasonal events with special breeder types
- [ ] Pet variety with unique abilities
- [ ] Shelter customization and decoration
- [ ] Spectator mode for tournaments
- [ ] Replay system for match review
- [ ] Achievement/trophy system
- [ ] Weekly challenges with bonus rewards

---

*Document reflects game state as of February 2026*
