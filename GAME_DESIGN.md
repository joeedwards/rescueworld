# Adoptar.io - Game Design Document

## Overview

**Adoptar.io** is a competitive .io-style multiplayer game where players operate rescue vans to save stray pets from the streets and evil breeder mills. Players collect strays, deliver them to adoption centers, grow their rescue operations, and ultimately compete to dominate the map with their shelters.

The game blends casual collection mechanics with territorial conquest, creating an accessible experience that scales from quick solo sessions to intense multiplayer battles for map control.

---

## Core Fantasy

You are a **pet rescuer** fighting against time, other rescuers, and sinister breeder mills to save as many animals as possible. Your mobile rescue van collects strays from the streets, but to truly make an impact, you must build a permanent shelter and grow it large enough to dominate the entire neighborhood.

---

## Game Modes

### Free For All (FFA)
- Up to 8 players compete simultaneously
- Real players join a lobby; empty slots filled with CPU bots
- Winner is determined by map domination (51% coverage) or highest score at time limit

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

### Phase 4: Domination
- First player whose shelter covers **51% of the map** wins instantly
- Alternatively, highest adoption count when time expires wins

---

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
Represents your rescue operation's scale:
- Van size determines pet capacity (up to 50)
- Shelter size determines territory radius
- Gained through adoptions (+1 per pet)
- Lost through combat with larger players

---

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

### Shelter Growth
- Each adoption at your shelter adds +1 size
- Shelter radius = 32 + (size × 2.5) pixels
- Defeating enemy vans adds +5-10 size

### Territory & Domination
- Shelter territory is calculated as a circular area
- Map size: 4800 × 4800 pixels (23,040,000 sq pixels)
- Win condition: Shelter area ≥ 51% of map area
- At size 761, shelter reaches ~51% coverage

---

## Combat System

### Van vs Van Combat
When two non-allied vans overlap for extended time:
1. **Grace Period**: Brief window to click "Ally" and avoid combat
2. **Strength Calculation**: Size + (Pets × weight) × adoption speed factor
3. **Gradual Transfer**: Winner slowly absorbs loser's size
4. **Variance**: Stray count adds randomness to outcomes

### Van vs Shelter Combat

**Solo Attacker**:
- Attacking alone = instant elimination
- Attacker's pets drop near shelter
- Shelter absorbs +10 size

**Group Attack (2+ vans)**:
- Combined strength vs shelter strength
- If attackers stronger: steal pets from shelter
- If shelter stronger: attackers take massive damage proportional to strength difference
- Weak attackers are eliminated entirely

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

## Competitive Elements

### Win Conditions
1. **Map Domination**: First to 51% shelter coverage
2. **Time Victory**: Highest adoption count when timer expires
3. **Last Standing**: Only remaining player (all others eliminated)

### Leaderboard Rankings
- **All-Time**: Total career wins
- **Daily**: Wins within current day
- **RT Earned**: Total rescue tokens earned

### Skill Expression
- Optimal routing for stray collection
- Timing port usage for escapes/repositioning
- Alliance negotiation
- Breeder mill prioritization
- Combat engagement decisions

---

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
