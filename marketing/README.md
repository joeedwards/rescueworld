# Adoptar.io -- Marketing Kit

> **Adoptar.io** is a multiplayer .io game where players drive rescue vans to save stray pets, dismantle breeder mills, and place animals into forever homes. Compete on seasonal leaderboards, build shelters, and earn Karma Points that carry over to our upcoming companion game, **Shelter Sim**.

Play now at **[adoptar.io](https://adoptar.io)**

---

## Game Overview

Adoptar.io combines fast-paced collection mechanics with strategic shelter-building and competitive multiplayer. Players operate rescue vans across a dynamic map, picking up stray pets and delivering them to Adoption Centers. The goal: rescue every stray before breeders overwhelm the map.

### Core Loop

1. **Drive** your van to collect stray pets scattered across the map
2. **Deliver** pets to the Adoption Center (green zone) -- earn **5 RT** (Rescue Tokens) each
3. **Build** a personal shelter (250 RT), then add upgrades: Adoption Center, Gravity pull, Advertising, Speed boost
4. **Dismantle** breeder mills by out-caring for their pets -- if breeders reach 2,000 strays, the match is lost
5. **Win** by rescuing all strays from the map

### Three Game Modes

| Mode | Players | Win Condition |
|------|---------|---------------|
| **FFA (Free-For-All)** | Up to 8 (with bots) | First to 150 adoptions, or rescue all strays |
| **Teams** | Red vs Blue (up to 8 total) | Team with most adoptions when map is cleared |
| **Solo / vs CPU** | 1 player + CPU helpers | Rescue all strays; triggers Boss Mode |

### Power-ups

- **Green orbs** -- +Size (grow your van)
- **Blue orbs** -- Speed boost
- **Purple orbs** -- Random Port (teleport to a random location)
- **Teal orbs** -- Home Port (teleport back to your shelter)

---

## Seasonal Gameplay

Adoptar.io features **four distinct seasons** that rotate throughout the year. Each season changes the map visuals, weather effects, and gameplay mechanics.

### Winter (December -- February)
- **Visuals:** Snowflakes falling, ice/snow patches, light blue background
- **Mechanics:** All vehicles move at **0.82x speed** (slippery conditions)
- **Atmosphere:** Quiet, frosty rescue missions under falling snow

### Spring (March -- May)
- **Visuals:** Lush green landscape, vegetation patches with flower dots
- **Mechanics:** Mud/vegetation patches slow vehicles to **0.7x speed**
- **Atmosphere:** Vibrant growth, new life -- the perfect rescue season

### Summer (June -- August)
- **Visuals:** Green-brown terrain, dry patches, baseline background
- **Mechanics:** Full speed (**1.0x**) -- the fastest season
- **Atmosphere:** Peak rescue season, breeders are most active

### Fall (September -- November)
- **Visuals:** Orange/brown falling leaves, wind streaks, earthy palette
- **Mechanics:** Wind gusts vary speed between **0.8x--1.2x** unpredictably
- **Atmosphere:** Dramatic rescues amid swirling autumn leaves

### Season Leaderboards

Each season has its own leaderboard tracking adoption scores. Compete for seasonal rankings alongside daily, weekly, and all-time boards.

---

## Boss Mode: The PetMall

Boss Mode is the endgame challenge in Solo matches. When all strays and breeders are cleared from the map, the **Breeder Tycoon** arrives with the **PetMall** -- five specialized pet mills arranged in a pentagon around the map center.

### The Five Mills

| Mill | Pet Type | Capacity |
|------|----------|----------|
| Horse Stable | Horses | 5 pets |
| Cat Boutique | Cats | 6 pets |
| Dog Depot | Dogs | 5 pets |
| Bird Barn | Birds | 6 pets |
| Rabbit Hutch | Rabbits | 5 pets |

### How It Works

1. **Timer starts:** 3 minutes (180 seconds) to clear all 5 mills
2. **Drive to a mill** and enter its proximity zone
3. **Purchase ingredients** (bowls, water, treats, etc.) using your Rescue Tokens
4. **Submit meals** to rescue each pet inside the mill
5. **Avoid the Breeder Tycoon** who patrols between mills -- getting caught costs 50% of purchased ingredients
6. **Clear all 5 mills** for a full victory

### Rewards

| Result | Bonus |
|--------|-------|
| Full victory (5/5 mills) | **100 RT + 1 Karma Point** |
| Partial (3--4 mills) | 50 RT per mill |
| Minimal (1--2 mills) | 25 RT per mill |
| Speed clear bonus (<30s per mill) | +20 RT each |

### Boss Mode Music

Boss Mode features its own dramatic soundtrack ("Boss Mode in D Minor") that replaces the regular game music during the PetMall challenge.

---

## Karma Points and Shelter Sim

### What Are Karma Points?

**Karma Points (KP)** are a cross-game currency that bridges Adoptar.io's Rescue World with our upcoming companion game, **Shelter Sim**. Unlike Rescue Tokens (RT) which are earned and spent within a single match, Karma Points persist across your account and carry forward to connected games.

### How to Earn Karma Points

| Action | KP Earned |
|--------|-----------|
| Win an FFA match (50+ adoptions) | 1 KP |
| Win a Teams match (on winning team) | 1 KP |
| Full Boss Mode victory (all 5 mills) | 1 KP |

Karma Points are **never deducted** -- they only accumulate. Every KP you earn is yours to keep.

### Shelter Sim Integration (Coming Soon)

**Shelter Sim** is Adoptar.io's upcoming companion game -- a shelter management simulator where your Karma Points become a powerful resource.

In Shelter Sim, Karma Points will unlock:

- **Shelter Upgrades:** Expand and improve your virtual shelter with specialized wings, advanced medical facilities, and luxury adoption suites
- **Rare Animals:** Access exclusive rescue animals that only appear for players with high Karma
- **Staff Hiring:** Recruit specialized staff (veterinarians, trainers, adoption counselors) to improve shelter operations
- **Community Events:** Participate in limited-time rescue events that reward additional KP and exclusive items
- **Cross-game Progress:** Your rescue achievements in Adoptar.io directly enhance your Shelter Sim experience

The Karma system is fully built with:
- Real-time balance tracking visible in-game (shown as "KP" in the UI)
- Complete transaction history (`/api/karma/history`)
- Server-to-server API for Shelter Sim integration (`/api/karma/award`)
- Secure API key authentication for cross-game awards

Karma Points earned in Shelter Sim will also count toward your Adoptar.io profile, creating a virtuous cycle between both games.

---

## Soundtrack

| Track | Duration | Usage |
|-------|----------|-------|
| **Forever Home Rush** | 3:16 | Main gameplay loop |
| **Boss Mode in D Minor** | 3:09 | Boss Mode (PetMall challenge) |

Both tracks are original compositions.

---

## Asset Inventory

### Images (`images/`)

| File | Description |
|------|-------------|
| `hero-banner.png` | Main hero banner for landing pages and storefronts |
| `social-card.png` | Open Graph / Twitter card image for social sharing |
| `frame-rescue.png` | "Rescue" theme frame for social content |
| `frame-adopt.png` | "Adopt" theme frame for social content |
| `frame-protect.png` | "Protect" theme frame for social content |

### Screenshots (`screenshots/`)

| File | Description |
|------|-------------|
| `landing-page.png` | Game landing / title screen |
| `season-winter.png` | Winter season gameplay (snowflakes, icy blue) |
| `season-spring.png` | Spring season gameplay (green, vegetation) |
| `season-summer.png` | Summer season gameplay (dry terrain, breeders) |
| `season-fall.png` | Fall season gameplay (falling leaves, wind) |
| `boss-mode.png` | Boss Mode -- PetMall with countdown timer |
| `boss-mode-gameplay.png` | Boss Mode -- approaching a mill |
| `gameplay-petmall.png` | PetMall overview (rendered) |
| `screenshot_001.png` -- `screenshot_009.png` | 9-frame rescue sequence (rendered) |

### Video (`video/`)

| File | Duration | Description |
|------|----------|-------------|
| `adoptario-promo-15s.mp4` | 15s | Full promo: hero banner, rescue/adopt/protect frames, all 4 seasons, Boss Mode, social card -- 720x720 square with music |
| `adoptario-promo-9s.mp4` | 9s | Compact seasons + Boss Mode promo with music crossfade |
| `adoptario-promo-7s.mp4` | 7s | Original promo clip |
| `adoptario-promo-mixed-7s.mp4` | 7s | Mixed gameplay promo clip |
| `adoptario-promo-io.mp4` | 7.5s | IO games library thumbnail -- 276x158, 2x speed, silent, under 500KB |
| `adoptario-video.mp3` | 3:16 | "Forever Home Rush" -- main game music |
| `music.mp3` | 3:16 | Main gameplay music (same track, source file) |
| `boss.mp3` | 3:09 | "Boss Mode in D Minor" -- boss battle music |

### GIFs (`gifs/`)

| File | Description |
|------|-------------|
| `promo-slideshow.gif` | Animated slideshow for social/web embeds |

### Scripts

| File | Description |
|------|-------------|
| `render-gameplay.mjs` | Node-canvas script to render gameplay screenshot sequences |
| `capture-screenshots.mjs` | Puppeteer script to capture live game screenshots (seasons + boss mode) |

---

## Quick Facts

- **Genre:** Multiplayer .io / Arcade / Strategy
- **Platform:** Web browser (desktop + mobile)
- **URL:** [adoptar.io](https://adoptar.io)
- **Players:** 1--8 per match
- **Match length:** 5--15 minutes
- **Controls:** WASD + E (build menu)
- **Account:** Optional Google sign-in for persistent progress
- **Price:** Free to play
