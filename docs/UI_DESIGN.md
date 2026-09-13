# DuoBotics — UI design philosophy

The reference implementation is `DuoBotics Landing v3.dc.html`. This document records the rules that produced it, so an older or inconsistent UI can be brought in line without guessing.

Both UIs in this repo follow it: the teaching game (`game/style.css`) and the Learning Lab (`web/src/styles.css`). One deliberate exception: the grain layers (§3) were tried on both and removed, so the ground is flat warm paper.

DuoBotics teaches robotics fundamentals in short lessons that end with a real self-balancing robot. The product is built on Bracket Bot. The interface has one job: make the hardware the most interesting thing on the screen.

---

## 1. Principles

**The product is the content.** Video and motion carry the page. Text is a caption on top of it, never a substitute for it. If a block needs more than two sentences, the visual isn't doing its job.

**One idea per screen.** Each section makes a single point. Two explanations never stack.

**Warm paper, not white.** The page is off-white with a warm cast. Pure white is reserved for surfaces that sit on top of the page: cards, frames, input fields.

**Grain instead of color.** Texture supplies the warmth that gradients and accent colors would otherwise provide. A page with grain needs very little else.

**Quiet, competent tone.** No hype, no exclamation marks, no emoji. Real numbers and real technical nouns, stated plainly.

---

## 2. Color

Shade differences, not color differences. The palette is a single warm neutral ramp; sections are distinguished by stepping one notch along it.

| Role | Value |
|---|---|
| Hero panel | `#FDFBF9` |
| Page / body ground | `#FBF8F5` |
| Section band (placeholders) | `#F7F2EB` |
| Section band (steps) | `#F4EFE8` |
| Footer band | `#EFE7DD` |
| Card surfaces, video frame | `#FFFFFF` |
| Hairline border | `rgba(23,23,23,.12)` |
| Ink (headings, primary text) | `#171717` |
| Ink-2 (body) | `#3A3A3A` |
| Ink-3 (metadata, captions) | `#6B6B6B` |

Rules:

- **No cool grays.** Every neutral has more red than blue. A bluish panel reads as a mistake against this ground.
- **Shade steps run down the page**, lightest at the top, so scrolling feels like descending.
- **No gradients** on page backgrounds. The one previous gradient was removed deliberately.
- Body text at `#3A3A3A` or darker; muted labels no lighter than `#6B6B6B` (lighter grays fail contrast at caption sizes).

In the two apps, pass/fail state is the only colour kept, and it is muted and warm: good `#2E6B45`, bad `#A0402F`, each on a 9 % tint. Everything else (graph lines, markers, the favourite bar, the trail) is ink.

---

## 3. Grain

Grain is the signature. It is gaussian pixel noise, not SVG fractal noise — fractal noise blends into a flat gray film and reads as a dirty background rather than texture.

- Generated as a 240×240 PNG of per-pixel gaussian noise (black and white specks, alpha from the noise magnitude), inlined as a base64 data URI so no network request can fail mid-render.
- **Two layers:** a `position: fixed` page-wide layer at ~0.32 opacity, and a per-panel layer at ~0.45 inside the hero.
- The page layer animates: a ten-step `translate` keyframe loop on `steps(1, end)` at 1.2s, which shifts the tile every frame and reads as live sensor noise.
- Grain sits behind content, never over text. White card surfaces are opaque and stay clean — the frame around the robot is deliberately grain-free.

---

## 4. Type

Inter throughout, at one weight ramp. No display face, no hand-lettered accent, no serif.

| Element | Spec |
|---|---|
| Hero title | 700, `clamp(32px, 5.4vw, 66px)`, `line-height: 1.06`, `letter-spacing: -0.035em` |
| Section heading | 700, `clamp(24px, 3vw, 32px)`, `letter-spacing: -0.03em` |
| Sub-heading | 700, `clamp(22px, 2.6vw, 28px)` |
| Card title | 600, 17px, `letter-spacing: -0.02em` |
| Body | 400, 16px, `line-height: 1.6`, `text-wrap: pretty` |
| Caption / metadata | 400, 13.5px, `#6B6B6B` |

- Base tracking on `body` is `-0.011em`; headings tighten further as they grow.
- Sentence case everywhere. No uppercase labels, no mono eyebrows — both were tried and removed; metadata uses the same face as everything else, just smaller and lighter.
- **The hero title breaks manually into two lines** ("Robotics Fundamentals," / "Made Simple.") rather than relying on `max-width`.
- Headings end in a period.
- **No em dashes.** Split into two sentences instead.

---

## 5. Layout

- Content column `max-width: 860px`, centered, 28px side padding. The page itself carries a 12px inset so every band reads as a rounded panel.
- Band radius `8px`; cards `12–14px`; buttons `8px`. Nothing is pill-shaped.
- Hairline `1px` borders. No shadows at rest except the single upward shadow that lifts the video frame off the hero.
- Section padding 72–96px vertical, tightening on shorter viewports.
- **The hero is exactly one viewport tall** (`height: calc(100svh - 12px)`, 480px floor) with the video frame pinned to its bottom edge, so nothing from the next band peeks in at scroll-top. The frame is a flex child with `min-height: 0` and the clip uses `object-fit: contain` — height comes from leftover space, never from the clip's aspect ratio, or the hero grows past the fold.
- Sibling groups use flex/grid with `gap`, never margins between inline items.
- Everything below the hero reflows: `max-width` not fixed widths, `minmax(0, 1fr)` tracks.

---

## 6. Motion

One easing curve: `cubic-bezier(.2, .7, .2, 1)`.

- **Reveal:** `opacity 0 → 1` plus `translateY(16px) → 0` over 0.8–0.9s, as a CSS `animation … both` so content is visible without JavaScript. Stagger siblings by 0.06s.
- **Grain:** the stepped translate loop described above. The only continuous animation on the page.
- **Hover:** buttons rise 1px or shift opacity to 0.85. Cards do not move.
- No parallax, no springs, no bounce, no scroll-jacking.

---

## 7. Components

**Video frame.** White card, hairline border, no bottom border, radius `14px 14px 0 0`, 14px padding, upward shadow (`0 -30px 60px -40px rgba(23,23,23,.35)`). Sits flush to the hero's bottom edge as though the page continues below it. The clip inside is muted, looping, `playsinline`, on a white ground.

Reliability rules learned the hard way, applied to any media element:
- Assign `src` as a plain path. Do not route through `fetch` → `Blob` → object URL; the body read fails in sandboxed contexts and the failure is silent.
- Force `muted`, `defaultMuted`, `loop`, `playsInline` as DOM properties in script — attributes alone don't guarantee autoplay.
- Re-run attachment on mount, on update, and on a short interval until every clip reports `readyState >= 2` and `paused === false`, then clear the timer. Template edits recreate nodes; a one-shot attach leaves them blank.

**Placeholder panels.** Warm-neutral blocks stepping off `#F4EFE8`, each with a slightly different grain frequency so the shades read as intentional. Radius 14px, label bottom-left at 13px. They mark where motion graphics will go and are labelled as such.

**Buttons.** Primary: white fill, `#171717` text, 8px radius, 1px hairline shadow, rises 1px on hover. Secondary: translucent white fill, `#3A3A3A` text, hairline border. Dark variant (`#171717` fill, white text) for in-page CTAs below the hero. Two buttons maximum, side by side.

**Step cards.** Hairline border, 12px radius, 20px padding, no fill. A muted number, a 17px title, one sentence. Three across, collapsing to one column.

---

## 8. Copy

- Slogan: **Robotics Fundamentals, Made Simple.**
- Lessons are described as *lessons*, hardware as *the bot* or *Bracket Bot*, the three steps as *Learn / Tune / Run*.
- Keep the user's own words verbatim when they supply copy. Add formatting, not rewrites.
- Credits and provenance ("Built on Bracket Bot · built in an evening", contributor names) sit as small `#6B6B6B` lines in the normal body face, centered under the hero buttons, never absolutely positioned.

---

## 9. Revamping an existing UI against this doc

In order:

1. **Strip color.** Replace every accent, gradient, and dark section with the warm neutral ramp in §2. Keep only shade differences.
2. **Re-ground.** Page to `#FBF8F5`; white only on cards and frames.
3. **Add both grain layers** (§3) before judging anything — the texture changes how every other value reads.
4. **Collapse the type system** to Inter at the ramp in §4. Delete decorative faces, uppercase mono labels, and em dashes.
5. **Reduce each section to one idea** and cut copy to two sentences.
6. **Re-lay out** to the 860px column with 12px page inset and rounded bands.
7. **Make the hero exactly one viewport** with its primary visual pinned to the bottom edge.
8. **Replace all reveal JavaScript** with CSS `animation … both` on the single easing curve.
9. **Check contrast last:** no text lighter than `#6B6B6B`, nothing below 13.5px.
