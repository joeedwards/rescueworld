# RescueWorld Visual Parity Audit
**Date:** 2026-02-22  
**Analysis:** TypeScript Client vs Flutter Client  
**Goal:** Identify visual gaps and provide actionable plan for visual parity

---

## Executive Summary

**Current State:**
- **TypeScript Client:** Rich, polished canvas rendering with procedural graphics, seasonal themes, image assets for special entities, and comprehensive UI/HUD
- **Flutter Client:** Basic geometric primitives (circles, rectangles) with flat colors, minimal HUD, no animations

**Visual Gap:** **CRITICAL** - Flutter client is ~15-20% visual fidelity compared to TypeScript client

**Asset Strategy:** ✅ **YES** - Generate/reuse assets, but prioritize procedural rendering for most entities

**Estimated Effort:** 40-60 hours to achieve 80% visual parity

---

## Detailed Visual Audit

### 1. Map & Background Style

#### TypeScript Client:
```typescript
// Seasonal backgrounds with distinct color palettes
SEASON_BG = {
  spring: '#8BC34A',  // Green
  summer: '#FDD835',  // Yellow  
  fall: '#FF9800',    // Orange
  winter: '#64B5F6'   // Blue
}

// Terrain patches with vegetation, snow drifts, flowers, autumn leaves
// Grid dot pattern overlay for texture
// Animated particles (snowflakes, leaves, etc.)
```

**Features:**
- 4 seasonal themes with unique backgrounds
- Procedural terrain patches (vegetation squares, snow ellipses, flower dots, autumn patches)
- Grid dot overlay for texture (configurable spacing/size)
- Seasonal particle systems (snowflakes with wind streaks, falling leaves)
- Dynamic wind effects affecting particle movement

#### Flutter Client:
```dart
// Single dark blue background
canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFF15272F));

// World bounds with stroke
canvas.drawRect(
  Rect.fromLTWH(0, 0, mapWidth, mapHeight),
  Paint()..color = const Color(0xFF1D3940)..style = PaintingStyle.stroke
);
```

**Features:**
- Static single-color background
- Simple border stroke
- No terrain features
- No seasonal themes
- No particles

**Gap:** ❌❌❌ **CRITICAL**
- Missing: Seasonal themes, terrain patches, particles, visual depth
- Impact: Game feels empty, lifeless, unprofessional

---

### 2. Player/Van Rendering

#### TypeScript Client:
```typescript
// Sophisticated van rendering with:
- Rounded rectangle body with team colors/gradients
- Darker cabin section with window
- Team-colored window tint (red/blue for teams mode)
- Two wheels with shadows
- Border outline (white for player, lighter for others)
- Ally indicator (green dashed border)
- Shadow blur effect
- Speed boost particles/aura
- Lure radius visual (glowing ring + animated dashed circle + label)
- Pet count label inside van window
- Friend/foe indicators (green/red dots)
- Ally request handshake emoji
- Eliminated ghost emoji
```

**Dimensions:**
- Base: 40x24 rounded rectangle
- Wheels: 5px radius with 2px hubs
- Window: 12x14 rounded rectangle
- Shadow: 10px blur

**Colors:**
- Default: Based on player color selection (30+ options including gradients)
- Window: Sky blue or team color overlay
- Outline: White (self) / rgba(255,255,255,0.5) (others)

#### Flutter Client:
```dart
// Simple circle
canvas.drawCircle(
  pos, 
  max(14, p.size * 0.14), 
  Paint()..color = p.id == localPlayerId 
    ? const Color(0xFFE8F16A)  // Yellow for self
    : const Color(0xFFE4E8EF)  // Light gray for others
);
```

**Features:**
- Single colored circle
- Size-based scaling
- No detail, no wheels, no cabin, no pets visible

**Gap:** ❌❌❌ **CRITICAL**
- Missing: Van shape, wheels, windows, pet counts, indicators, effects, shadows
- Impact: Can't distinguish player vans from pets, no visual feedback for boosts/status

---

### 3. Pet/Stray Rendering

#### TypeScript Client:
```typescript
// Simple circles with type-specific colors
PET_COLORS = {
  0: '#CB8F5F',  // Cat - brown
  1: '#9D6D46',  // Dog - darker brown
  2: '#75C6E8',  // Bird - light blue
  3: '#D9D3B4',  // Rabbit - beige
  4: '#FFD700',  // Special - gold
}

// Rendered as 12px diameter circles
// Inside shelters: emoji icons (🐱🐶🐦🐰) in kennel cells
```

**Features:**
- Color-coded by pet type
- Emoji representation when inside shelters
- Consistent 12px size
- Clean, readable at any zoom

#### Flutter Client:
```dart
// Similar color system but crude
PET_COLORS = {
  0: Color(0xFFCB8F5F),  // Cat
  1: Color(0xFF9D6D46),  // Dog
  2: Color(0xFF75C6E8),  // Bird
  3: Color(0xFFD9D3B4),  // Rabbit
  4: Color(0xFFFFD700),  // Special
}

// Budget system: first 350 as circles (6px), rest as 3x3 squares
```

**Features:**
- Same colors (good!)
- Performance optimization (sprite budget)
- No emoji when inside shelters

**Gap:** ✅ **MINOR** - Colors match, just need emoji support in shelters

---

### 4. Shelter Rendering

#### TypeScript Client:
```typescript
// Detailed compound structure:
foundation: {
  color: '#e8e0d8',  // Beige base
  rounded: 6px corner radius
  shadow: heavy drop shadow (18px blur)
  stroke: 2px accent color (varies by tier)
}

rooms: [
  kennel: {
    floor: '#d9d0c4',  // Light brown
    cells: grid layout with bars/gates
    pets: emoji icons in occupied cells
    dividers: darker brown lines
  },
  playground: {
    color: '#90c67c',  // Green grass
    turf_patches: scattered darker green spots
    fence_posts: brown posts around perimeter
    equipment: jump hoops, hurdles, cone markers
  },
  reception: {
    desk: accent-colored with chair/shadow
  },
  medical: {
    table: gray with red cross icon
  },
  grooming: {
    tub: light blue with grooming table
  }
]

door: {
  frame: '#8B6914' brown
  panel: accent color
  awning: same color as door panel
}

label: {
  text: "Your Shelter" or "Shelter"
  background: accent color (85% opacity)
  font: 'bold 11px Rubik'
  positioned above shelter
}

icons: {
  adoption_center: '🐾'
  gravity: '🌀'
  advertising: '📢'
  positioned right of label
}

tier_badge: {
  circle: tier-specific color
  stroke: white 2px
  text: tier number or '👑' for tier 5
  position: top-right corner
}

stats: {
  pets_count: white text with shadow
  adoptions: '#7bed9f' green text
  positioned below shelter
}
```

**Tier Colors:**
```typescript
1: '#8B7355',  // Brown
2: '#A0A0A0',  // Silver
3: '#FFD700',  // Gold
4: '#E0115F',  // Ruby
5: '#50C878',  // Emerald
```

**Room Layout:** Dynamic based on shelter tier and size (1-5 rooms)

#### Flutter Client:
```dart
// Single translucent circle
canvas.drawCircle(
  Offset(s.x, s.y), 
  max(16, s.size * 0.2), 
  Paint()..color = const Color(0x88DF6A6A)  // Reddish semi-transparent
);
```

**Features:**
- Just a circle
- No rooms, no details, no text

**Gap:** ❌❌❌ **CRITICAL**
- Missing: Building structure, rooms, tier indication, stats, icons, door, everything
- Impact: Can't tell shelters apart, no visual progression, feels placeholder

---

### 5. Adoption Zones

#### TypeScript Client:
```typescript
// Dashed green square with glow
stroke: {
  color: 'rgba(123, 237, 159, 0.6)',
  width: 4px,
  dash: [8, 8]
}

fill: {
  color: 'rgba(74, 124, 89, 0.2)'
}

labels: {
  title: 'ADOPTION CENTER'
  description: 'Bring pets here to adopt out'
  color: '#7bed9f'
  font: 'bold 14px Rubik'
  positioned above zone
}
```

#### Flutter Client:
```dart
// Simple circle with fill and stroke
fill: Paint()..color = const Color(0x4428E08F),  // Green transparent
stroke: Paint()
  ..color = const Color(0xFF28E08F)
  ..style = PaintingStyle.stroke
  ..strokeWidth = 2
```

**Gap:** ⚠️ **MODERATE**
- Missing: Square shape, dashed border, labels
- Impact: Less clear what zone is for, but functional

---

### 6. Adoption Events

#### TypeScript Client:
```typescript
// Animated pulsing circles with image
background_glow: {
  radius: event_radius + 20px
  color: 'rgba(255, 193, 7, 0.15)' with pulse multiplier
}

image_placeholder: {
  // If adoption-event.png loaded:
  draws actual image asset
  // Else:
  inner_circle: 'rgba(255, 193, 7, 0.5)' with pulse
  icon: '🎪' tent emoji
}

boundary: {
  stroke: dashed circle
  color: nearby ? green : yellow
  width: 4-6px
  dash: [12, 8]
}

labels: {
  title: event type name (uppercase)
  progress: 'X/Y rescued'
  font: 'bold 16px Rubik'
  color: '#ffc107' (yellow) or '#7bed9f' (green when nearby)
}
```

**Animation:** Pulse effect on opacity (0.8 + 0.2 * pulse)

#### Flutter Client:
```dart
// Just dashed stroke circle
stroke: Paint()
  ..color = const Color(0x99F5C04E)
  ..style = PaintingStyle.stroke
  ..strokeWidth = 2

canvas.drawCircle(Offset(e.x, e.y), e.radius.toDouble(), line);
```

**Gap:** ❌❌ **MAJOR**
- Missing: Image asset, glow, animation, labels, progress indicator
- Impact: Events barely visible, unclear what they are

---

### 7. Breeder Shelters / Mills

#### TypeScript Client:
```typescript
// Uses breeder-mill.png image asset if loaded
// Fallback: purple circle

image_drawing: {
  draws breeder-mill.png centered
  size: based on shelter size
  level-based scaling
}

fallback: {
  color: '#A65EFF' (purple)
  size: based on level
}
```

**Asset:** `/breeder-mill.png` (exists in client/public/)

#### Flutter Client:
```dart
// Purple translucent circle
canvas.drawCircle(
  Offset(s.x, s.y), 
  max(20, s.size * 0.25), 
  Paint()..color = const Color(0x99A65EFF)
);
```

**Gap:** ⚠️ **MODERATE**
- Missing: Image asset loading
- Impact: Adequate for now, but could be enhanced

---

### 8. Boss Mode

#### TypeScript Client:
```typescript
// Tycoon (boss entity):
portal_glow: {
  radius: dynamic based on animation
  gradient: purple/pink radial
}

portal_particles: {
  count: 12
  color: white with fade
  rotation: animated
}

fire_effects: {
  flames: animated procedural fire shapes
  glow: radial gradient orange/red
  particles: rising embers
}

// Mills:
draws breeder-mill.png or colored circles

// Pet Mall:
draws large structure with details
```

#### Flutter Client:
```dart
// Simple colored circles
tycoon: Paint()..color = const Color(0xFFE05252),  // Red
mills: Paint()..color = const Color(0xFFFA7C2A),   // Orange
```

**Gap:** ❌❌❌ **CRITICAL** (for boss mode feature)
- Missing: All boss mode visual effects, animations, fire, portals
- Impact: Boss mode unplayable/unenjoyable without visuals

---

### 9. Pickups (Orbs)

#### TypeScript Client:
```typescript
PICKUP_COLORS = {
  0: '#5DD267',  // Growth - green
  1: '#4DA4FF',  // Speed - blue
  2: '#FFD05A',  // Port - yellow
  3: '#C58BFF',  // Breeder - purple
  4: '#FFAA5A',  // Shelter port - orange
}

// Rendered as 20px diameter circles with glow/shadow
```

#### Flutter Client:
```dart
// Same colors, 20px diameter circles
PICKUP_COLORS = {
  0: Color(0xFF5DD267),  // Growth
  1: Color(0xFF4DA4FF),  // Speed
  2: Color(0xFFFFD05A),  // Port
  3: Color(0xFFC58BFF),  // Breeder
  4: Color(0xFFFFAA5A),  // Shelter port
}
```

**Gap:** ✅ **MATCHES** - Colors and sizes match perfectly!

---

### 10. HUD & UI Components

#### TypeScript Client:

**Top Bar:**
```css
background: linear-gradient(180deg, rgba(30,35,50,0.4), rgba(22,26,38,0.4))
border-bottom: 2px solid rgba(255,255,255,0.08)
shadow: 0 4px 20px rgba(0,0,0,0.2)
```

**Elements:**
- Score display: `#7bed9f` green with glow text-shadow
- Game clock: monospace font, dark background
- Season badge: Color-coded pill with season name
- Timer: Bold white for match countdown
- Auth area: Sign in links, profile name, settings gear icon
- Ping display: Small gray text

**In-Game Overlays:**
- Lobby overlay: Dark card with green border, player chips
- Match end screen: Large card with stats table, team scores
- Leaderboard: Scrollable list with rank badges, relationship indicators
- Settings panel: Tabbed interface (Audio, Display, Controls, Account)
- Item selection modal: Grid of inventory items with icons
- Color picker: Swatches + custom color inputs
- Friends panel: Lists with action buttons
- Toast notifications: Gradient backgrounds (green/red/blue)

**Fonts:**
- Primary: 'Rubik' (bold 600-700 weights)
- Monospace: For timer/ping

**Colors:**
- Primary accent: `#7bed9f` (green)
- Background: `rgba(35,42,60,0.98)` (dark blue-gray)
- Borders: Various opacity white or accent colors
- Success: `#2ecc71` (green)
- Error: `#e74c3c` (red)
- Info: `#3498db` (blue)

#### Flutter Client:

**game_hud.dart:**
```dart
// Minimal HUD implementation
- Score text in top-left
- Match timer
- Basic text rendering
```

**Gap:** ❌❌❌ **CRITICAL**
- Missing: Styled HUD, lobby UI, match end screen, settings, inventory, notifications
- Impact: No user feedback, can't configure settings, can't see match status

---

### 11. Animations & Effects

#### TypeScript Client:

**Implemented:**
1. **Particles:**
   - Snowflakes with wind streaks (winter)
   - Falling leaves with rotation (fall)
   - Rain streaks (potential)
   
2. **Speed Boost:**
   - Trail particles behind van
   - Aura glow effect
   - Duration-based intensity
   
3. **Lure Effect:**
   - Pulsing glow ring
   - Spinning dashed circle (animated lineDashOffset)
   - Label with shadow
   
4. **Adoption Events:**
   - Pulse animation (opacity cycling)
   - Color transition when nearby
   
5. **Boss Mode:**
   - Portal swirl animation
   - Fire flames procedural animation
   - Rising ember particles
   - Mill rotation effects
   
6. **UI Transitions:**
   - Toast slide-in/fade-out
   - Modal fade-in backgrounds
   - Button hover states

#### Flutter Client:

**Implemented:**
- None (static rendering only)

**Gap:** ❌❌❌ **CRITICAL**
- Missing: All animations and visual effects
- Impact: Game feels static, unresponsive, boring

---

### 12. Asset Inventory

#### TypeScript Client Assets:
```
/client/public/
  ├── favicon.svg
  ├── logo-150.png
  ├── adoption-event.png
  ├── adoption-event-transparent.png  ← Used
  └── breeder-mill.png                 ← Used
```

**Usage:**
- `adoption-event-transparent.png`: Drawn in adoption events
- `breeder-mill.png`: Drawn for breeder shelters and boss mills
- Rest: UI/branding only

**Loading Strategy:**
```typescript
const image = new Image();
image.onload = () => { imageLoaded = true; };
image.onerror = () => { /* fallback to procedural */ };
image.src = '/path/to/image.png';
```

#### Flutter Client Assets:
```
/flutter_client/assets/
  (empty - no assets defined)
```

**Gap:** ❌ **MISSING** - Need to port 2 key image assets

---

## Visual Gap Summary Table

| Component | TS Client | Flutter Client | Gap Severity | Asset Needed? |
|-----------|-----------|----------------|--------------|---------------|
| Background/Map | Seasonal themes, terrain patches, particles | Solid color | ❌❌❌ CRITICAL | No |
| Player Vans | Detailed vehicle with wheels, windows, effects | Simple circle | ❌❌❌ CRITICAL | No |
| Pets | Colored circles + emoji in shelters | Colored circles/squares | ✅ MINOR | No |
| Shelters | Multi-room buildings with tiers, stats | Translucent circle | ❌❌❌ CRITICAL | No |
| Adoption Zones | Dashed square with labels | Circle with stroke | ⚠️ MODERATE | No |
| Adoption Events | Image + glow + labels + animation | Dashed circle | ❌❌ MAJOR | Yes (1 image) |
| Breeder Mills | Image or fallback | Circle | ⚠️ MODERATE | Yes (1 image) |
| Boss Mode | Portals, fire, particles | Basic circles | ❌❌❌ CRITICAL | No |
| Pickups | Colored circles | Colored circles | ✅ MATCHES | No |
| HUD/UI | Full styled interface | Minimal text | ❌❌❌ CRITICAL | No |
| Animations | Extensive (12+ types) | None | ❌❌❌ CRITICAL | No |
| Shadows/Effects | Yes (blur, glow, gradients) | No | ❌❌ MAJOR | No |

---

## Asset Generation Decision

### ✅ **YES - Generate/Port 2 Key Assets**

**Assets Needed:**
1. `adoption-event-transparent.png` (already exists, just port to Flutter assets)
2. `breeder-mill.png` (already exists, just port to Flutter assets)

**Why Only 2?**
- Rest of visuals are **procedural** (canvas drawing code)
- Porting procedural rendering is more efficient than creating hundreds of image assets
- Keeps bundle size small
- Easier to maintain and modify
- Better performance (no texture loading delays)

**Asset Handling:**
```yaml
# pubspec.yaml
flutter:
  assets:
    - assets/adoption-event-transparent.png
    - assets/breeder-mill.png
```

```dart
// Loading in Flutter
final image = await rootBundle.load('assets/adoption-event-transparent.png');
final bytes = image.buffer.asUint8List();
final decodedImage = await decodeImageFromList(bytes);
```

---

## Prioritized Visual Parity Roadmap

### 🔴 **Phase 1: Core Gameplay Visuals (Week 1-2, 24-30 hours)**

**Priority 1.1: Player Van Rendering** ⭐⭐⭐
- [ ] Draw rounded rectangle body
- [ ] Add cabin section with window
- [ ] Draw wheels with hubs
- [ ] Add shadows (canvas shadowBlur)
- [ ] Implement team colors
- [ ] Add border outline (thicker for self)
- [ ] Display pet count label
- [ ] Add ally green dashed border

**Files:** `game_painter.dart` - `_drawPlayers()` method

**Estimated:** 4-6 hours

---

**Priority 1.2: Shelter Rendering** ⭐⭐⭐
- [ ] Draw foundation rectangle with rounded corners and shadow
- [ ] Implement room layout logic (kennel, playground, etc.)
- [ ] Draw kennel cells with pet emoji
- [ ] Draw playground with grass color and fence posts
- [ ] Add door with awning
- [ ] Draw tier badge circle with number/crown
- [ ] Add shelter label banner
- [ ] Display stats (pets count, adoptions)
- [ ] Add upgrade icons (🐾 🌀 📢)

**Files:** `game_painter.dart` - `_drawShelters()` method

**Estimated:** 8-10 hours

---

**Priority 1.3: Background & Terrain** ⭐⭐
- [ ] Implement seasonal color palettes
- [ ] Add terrain patch system (vegetation, snow, flowers)
- [ ] Draw grid dot overlay
- [ ] Basic particle system (snowflakes or leaves)

**Files:** `game_painter.dart` - new `_drawBackground()` method

**Estimated:** 5-7 hours

---

**Priority 1.4: Adoption Zones & Events** ⭐⭐
- [ ] Change adoption zones to dashed rectangles
- [ ] Add zone labels
- [ ] Port adoption-event.png asset
- [ ] Implement event glow/pulse animation
- [ ] Add event labels and progress text

**Files:** `game_painter.dart` - `_drawZones()` and `_drawEvents()` methods

**Estimated:** 4-5 hours

---

**Priority 1.5: Basic Visual Effects** ⭐
- [ ] Add shadows to players and shelters
- [ ] Implement speed boost aura
- [ ] Add lure radius visual
- [ ] Port breeder-mill.png asset

**Files:** `game_painter.dart` - various methods

**Estimated:** 3-4 hours

---

### 🟡 **Phase 2: HUD & UI (Week 3, 16-20 hours)**

**Priority 2.1: Top Bar HUD** ⭐⭐⭐
- [ ] Styled background with gradient
- [ ] Score display with green accent
- [ ] Match timer
- [ ] Season badge
- [ ] Ping display

**Files:** `game_hud.dart` - major rewrite with Flutter widgets

**Estimated:** 6-8 hours

---

**Priority 2.2: Match End Screen** ⭐⭐
- [ ] Stats table with rankings
- [ ] Team scores display (teams mode)
- [ ] Continue/rejoin buttons
- [ ] Styled card with dark background

**Files:** New `match_end_screen.dart`

**Estimated:** 4-5 hours

---

**Priority 2.3: Settings Panel** ⭐⭐
- [ ] Tabbed interface
- [ ] Audio controls (music, SFX volumes)
- [ ] Display options
- [ ] Control configuration

**Files:** New `settings_panel.dart`

**Estimated:** 6-7 hours

---

### 🟢 **Phase 3: Polish & Effects (Week 4, 12-16 hours)**

**Priority 3.1: Animation System** ⭐⭐
- [ ] Implement AnimationController for effects
- [ ] Pulse animation for events
- [ ] Particle system (snowflakes, leaves)
- [ ] Speed boost trail particles
- [ ] Lure spinning dash animation

**Files:** `game_painter.dart` - add animation controllers

**Estimated:** 6-8 hours

---

**Priority 3.2: Boss Mode Visuals** ⭐
- [ ] Portal glow effect
- [ ] Fire animation for mills
- [ ] Boss particle effects

**Files:** `game_painter.dart` - `_drawBoss()` enhancement

**Estimated:** 4-5 hours

---

**Priority 3.3: UI Feedback** ⭐
- [ ] Toast notifications
- [ ] Button hover effects
- [ ] Modal transitions

**Files:** Various UI components

**Estimated:** 2-3 hours

---

## Technical Implementation Guide

### 1. Van Rendering Example

```dart
void _drawPlayers(Canvas canvas, List<PlayerState> players, Rect viewport) {
  for (final p in players) {
    final pos = Offset(p.x, p.y);
    if (!viewport.contains(pos)) continue;
    
    final isMe = p.id == localPlayerId;
    final vanWidth = 40.0;
    final vanHeight = 24.0;
    final cornerRadius = 4.0;
    
    canvas.save();
    canvas.translate(pos.dx, pos.dy);
    
    // Determine facing direction from velocity
    final facingDir = p.vx >= 0 ? 1.0 : -1.0;
    canvas.scale(facingDir, 1.0);
    
    // Shadow
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(2, 2), width: vanWidth, height: vanHeight),
        Radius.circular(cornerRadius),
      ),
      Paint()..color = Colors.black.withOpacity(0.25)..maskFilter = MaskFilter.blur(BlurStyle.normal, 5),
    );
    
    // Van body (use player color - needs color system implementation)
    final bodyColor = _getPlayerColor(p);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset.zero, width: vanWidth, height: vanHeight),
        Radius.circular(cornerRadius),
      ),
      Paint()..color = bodyColor,
    );
    
    // Cabin (darker section on right)
    final cabinWidth = vanWidth * 0.35;
    canvas.drawRRect(
      RRect.fromRectAndCorners(
        Rect.fromLTWH(vanWidth / 2 - cabinWidth, -vanHeight / 2, cabinWidth, vanHeight),
        topRight: Radius.circular(cornerRadius),
        bottomRight: Radius.circular(cornerRadius),
      ),
      Paint()..color = Colors.black.withOpacity(0.15),
    );
    
    // Window
    final windowWidth = cabinWidth * 0.7;
    final windowHeight = vanHeight * 0.6;
    final windowPad = 3.0;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(
          vanWidth / 2 - cabinWidth + windowPad,
          -windowHeight / 2,
          windowWidth,
          windowHeight,
        ),
        Radius.circular(2),
      ),
      Paint()..color = Color(0xB087CEFA),  // Sky blue
    );
    
    // Outline
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset.zero, width: vanWidth, height: vanHeight),
        Radius.circular(cornerRadius),
      ),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = isMe ? 3.0 : 2.0
        ..color = isMe ? Colors.white.withOpacity(0.9) : Colors.white.withOpacity(0.5),
    );
    
    // Wheels
    final wheelY = vanHeight / 2 + 4;
    final wheelRadius = 5.0;
    final frontWheelX = vanWidth / 2 - vanWidth * 0.3;
    final rearWheelX = -vanWidth / 2 + vanWidth * 0.2;
    
    for (final wheelX in [frontWheelX, rearWheelX]) {
      canvas.drawCircle(Offset(wheelX, wheelY), wheelRadius, Paint()..color = Color(0xFF333333));
      canvas.drawCircle(Offset(wheelX, wheelY), wheelRadius * 0.4, Paint()..color = Color(0xFF888888));
    }
    
    // Pet count label
    if (p.petsInside.isNotEmpty) {
      final textPainter = TextPainter(
        text: TextSpan(
          text: '${p.petsInside.length}',
          style: TextStyle(
            color: Colors.white,
            fontSize: 13,
            fontWeight: FontWeight.bold,
            fontFamily: 'Rubik',
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      textPainter.layout();
      textPainter.paint(canvas, Offset(-textPainter.width / 2, 10));
    }
    
    canvas.restore();
  }
}

Color _getPlayerColor(PlayerState p) {
  // Implement color system based on shelterColor field
  // For now, use default colors
  if (p.team == 'red') return Color(0xFFE74C3C);
  if (p.team == 'blue') return Color(0xFF3498DB);
  return Color(0xFF5DD267);  // Default green
}
```

### 2. Shelter Rendering Example (Simplified)

```dart
void _drawShelters(Canvas canvas, List<ShelterState> shelters) {
  for (final s in shelters) {
    final size = max(60.0, s.size * 0.3);
    final rect = Rect.fromCenter(center: Offset(s.x, s.y), width: size, height: size);
    
    // Shadow
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect.shift(Offset(4, 4)), Radius.circular(6)),
      Paint()
        ..color = Colors.black.withOpacity(0.25)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 18),
    );
    
    // Foundation
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(6)),
      Paint()..color = Color(0xFFE8E0D8),
    );
    
    // Accent border
    final tierColor = _getTierColor(s.tier);
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(6)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = tierColor,
    );
    
    // Draw rooms (simplified - just kennel for now)
    _drawKennelRoom(canvas, rect, s.petsInside.length);
    
    // Label
    final labelText = 'Shelter';
    final textPainter = TextPainter(
      text: TextSpan(
        text: labelText,
        style: TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.bold,
          fontFamily: 'Rubik',
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    
    final labelRect = Rect.fromCenter(
      center: Offset(s.x, s.y - size / 2 - 20),
      width: textPainter.width + 14,
      height: 18,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(labelRect, Radius.circular(4)),
      Paint()..color = tierColor.withOpacity(0.85),
    );
    textPainter.paint(canvas, Offset(s.x - textPainter.width / 2, s.y - size / 2 - 26));
    
    // Tier badge
    final badgeCenter = Offset(s.x + size / 2 - 12, s.y - size / 2 + 12);
    canvas.drawCircle(badgeCenter, 12, Paint()..color = tierColor);
    canvas.drawCircle(
      badgeCenter,
      12,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white,
    );
    
    final badgeText = TextPainter(
      text: TextSpan(
        text: s.tier >= 5 ? '👑' : '${s.tier}',
        style: TextStyle(
          color: s.tier >= 5 ? Color(0xFF333333) : Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    );
    badgeText.layout();
    badgeText.paint(canvas, Offset(badgeCenter.dx - badgeText.width / 2, badgeCenter.dy - badgeText.height / 2));
    
    // Stats
    final statsY = s.y + size / 2 + 15;
    _drawTextWithShadow(canvas, 'Pets: ${s.petsInside.length}', Offset(s.x, statsY), Colors.white, 10);
    _drawTextWithShadow(canvas, 'Adoptions: ${s.totalAdoptions}', Offset(s.x, statsY + 13), Color(0xFF7BED9F), 10);
  }
}

Color _getTierColor(int tier) {
  switch (tier) {
    case 1: return Color(0xFF8B7355);
    case 2: return Color(0xFFA0A0A0);
    case 3: return Color(0xFFFFD700);
    case 4: return Color(0xFFE0115F);
    case 5: return Color(0xFF50C878);
    default: return Color(0xFF8B7355);
  }
}

void _drawTextWithShadow(Canvas canvas, String text, Offset pos, Color color, double fontSize) {
  final textPainter = TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontFamily: 'Rubik',
        shadows: [
          Shadow(color: Colors.black.withOpacity(0.6), blurRadius: 3),
        ],
      ),
    ),
    textDirection: TextDirection.ltr,
    textAlign: TextAlign.center,
  );
  textPainter.layout();
  textPainter.paint(canvas, Offset(pos.dx - textPainter.width / 2, pos.dy - textPainter.height / 2));
}

void _drawKennelRoom(Canvas canvas, Rect shelterRect, int petCount) {
  // Simplified kennel - just draw colored rectangle
  final roomRect = Rect.fromLTWH(
    shelterRect.left + 8,
    shelterRect.top + 8,
    shelterRect.width * 0.4,
    shelterRect.height * 0.4,
  );
  canvas.drawRRect(
    RRect.fromRectAndRadius(roomRect, Radius.circular(3)),
    Paint()..color = Color(0xFFD9D0C4),
  );
  canvas.drawRRect(
    RRect.fromRectAndRadius(roomRect, Radius.circular(3)),
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = Color(0xFF8A7B6B),
  );
  
  // Draw pet count
  if (petCount > 0) {
    _drawTextWithShadow(
      canvas,
      '$petCount 🐾',
      Offset(roomRect.center.dx, roomRect.center.dy),
      Color(0xFF8A7050),
      9,
    );
  }
}
```

### 3. Background & Terrain

```dart
void _drawBackground(Canvas canvas, Size size, String season) {
  // Season background color
  final bgColor = _getSeasonBackground(season);
  canvas.drawRect(Offset.zero & size, Paint()..color = bgColor);
  
  // Terrain patches (simplified - just a few vegetation squares for spring)
  if (season == 'spring') {
    final random = Random(42);  // Seeded for consistency
    for (var i = 0; i < 50; i++) {
      final x = random.nextDouble() * mapWidth;
      final y = random.nextDouble() * mapHeight;
      canvas.drawRect(
        Rect.fromCenter(center: Offset(x, y), width: 20, height: 20),
        Paint()..color = Color(0x40145214),
      );
    }
  }
  
  // Grid dots
  final dotSpacing = 40.0;
  final dotRadius = 1.0;
  final dotColor = _getSeasonDotColor(season);
  final dotPaint = Paint()..color = dotColor;
  
  for (var y = 0.0; y < mapHeight; y += dotSpacing) {
    for (var x = 0.0; x < mapWidth; x += dotSpacing) {
      canvas.drawCircle(Offset(x, y), dotRadius, dotPaint);
    }
  }
}

Color _getSeasonBackground(String season) {
  switch (season) {
    case 'spring': return Color(0xFF8BC34A);
    case 'summer': return Color(0xFFFDD835);
    case 'fall': return Color(0xFFFF9800);
    case 'winter': return Color(0xFF64B5F6);
    default: return Color(0xFF8BC34A);
  }
}

Color _getSeasonDotColor(String season) {
  switch (season) {
    case 'spring': return Color(0x60609060);
    case 'summer': return Color(0x60C0A040);
    case 'fall': return Color(0x60905030);
    case 'winter': return Color(0x60608090);
    default: return Color(0x60609060);
  }
}
```

---

## Minimal Viable Visual (MVV) Checklist

For launch-ready Flutter client:

### Must Have (Blocking):
- ✅ Van rendering with wheels and pet count
- ✅ Shelter buildings with rooms and tier indication
- ✅ Colored pickup orbs (already done)
- ✅ Adoption zone rectangles with labels
- ✅ Basic HUD (score, timer)
- ✅ Match end screen

### Should Have (Important):
- ✅ Seasonal backgrounds
- ✅ Shadows on vans and shelters
- ✅ Speed boost visual indicator
- ✅ Adoption event images
- ✅ Settings panel

### Nice to Have (Polish):
- ⚪ Particle systems
- ⚪ Animation effects
- ⚪ Boss mode visuals
- ⚪ UI transitions

---

## Conclusion & Recommendations

### Summary:
- **Visual gap is severe but fixable**
- **Most rendering is procedural (canvas), not image assets**
- **Only 2 image assets needed, already exist**
- **Estimated 40-60 hours total for 80% parity**
- **Can be done incrementally without breaking existing functionality**

### Recommended Approach:

1. **Start with Phase 1** (core gameplay visuals) - this gives immediate visual impact
2. **Use TypeScript client as reference** - copy the canvas drawing logic almost 1:1
3. **Test incrementally** - each component can be tested independently
4. **Reuse color constants** - they already match between clients
5. **Add assets last** - procedural rendering works fine for most things

### Asset Strategy:
✅ **Copy existing assets, don't generate new ones**
- Port `adoption-event-transparent.png` to Flutter assets
- Port `breeder-mill.png` to Flutter assets
- That's it!

### Success Metrics:
- [ ] Players can easily distinguish their van from others
- [ ] Shelters look like buildings, not circles
- [ ] Game has visual depth (backgrounds, terrain)
- [ ] HUD provides necessary information
- [ ] Visual style matches TypeScript client at ~80% fidelity

---

**Next Action:** Begin Phase 1.1 (Van Rendering) immediately - this is the single highest-impact change for visual parity.
