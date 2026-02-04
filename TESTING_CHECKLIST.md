# Game Design Update – Testing Checklist

Use this list to verify all features after starting the game (e.g. `npm run dev` then open http://localhost:3000 or your deployed URL).

## 1. Pet variety
- [ ] Strays on the map show different labels (Cat, Dog, Bird, Rabbit, Special).
- [ ] Strays use different colors (orange cat, brown dog, blue bird, white rabbit, gold Special with glow).
- [ ] New strays keep spawning with a mix of types.

## 2. Shelter tiers
- [ ] After building a shelter, a tier badge (1–5) appears on it.
- [ ] As the shelter grows (adoptions), the tier number increases (e.g. 1 → 2 → 3).
- [ ] Shelter visual size does not grow past a reasonable cap (no screen-filling circle).
- [ ] Tier 5 shows a star (★) style badge.

## 3. Cooperative features (no shelter combat)
- [ ] Vans cannot attack or destroy other players’ shelters; no “attacked shelter” messages.
- [ ] When you have pets and are near an **allied** player’s shelter, a **Transfer [T]** button appears.
- [ ] Clicking Transfer opens a confirmation (“Transfer N pets? You get 30% score, they get 70%”).
- [ ] Confirm transfers pets to the ally’s shelter and you see a success toast.

## 4. Leaderboards
- [ ] Open the leaderboard (button or menu).
- [ ] Tabs exist: **All-Time**, **Today**, **Weekly**, **Season**.
- [ ] Switching tabs loads the correct list (weekly/season may be empty until you play in that period).
- [ ] Entries show score/RT and shelter color where applicable.

## 5. Adoption events
- [ ] During a match, an **Adoption Events** panel appears (top-left) when events are active.
- [ ] On the main map, event zones appear as dashed rings with a name and countdown (e.g. “School Fair”, “120s left”).
- [ ] Event panel shows event name, requirements (e.g. “Need: 2 Cats, 3 Dogs”), and time left.
- [ ] Minimap shows teal ring markers for event locations.
- [ ] Adopting pets near an event zone (within the ring) counts toward that event.

## 6. Scoring (backend)
- [ ] After a match, RT is recorded; daily/weekly/season totals update for registered users.
- [ ] Leaderboard “Today” shows players who played today; “Weekly”/“Season” show when you have played in that period.

## Quick smoke test
1. Start a solo or FFA match.
2. Move around and confirm strays have different types and colors.
3. Build a shelter and check tier badge.
4. Open leaderboard and switch Daily / Weekly / Season / All-Time.
5. Wait for an adoption event (or run match long enough) and confirm event panel and map markers.
6. If you have an ally, get pets and stand near their shelter; confirm Transfer button and flow.
