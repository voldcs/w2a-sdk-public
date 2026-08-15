// W2A Web SDK - browser runtime, режим A (Portal Tag).
// Реализует недостающий из TS-проекта ModeAExecutor: ad request -> рендер
// оверлея -> billable impression -> clickout. Публичный API совпадает с
// дизайном (init/showAd/showInterstitial/showRewarded/on). Ноль зависимостей.
//
// Модель клика (из верифицированных ограничений): CTA - реальный DOM-элемент
// на top-level, активируется ТОЛЬКО после подтверждения billable impression,
// навигация синхронно по тапу (один gated-экшен), трекинг клика - через наш
// server-side redirect внутри единственного click URL.

const STATES = ['loading', 'opened', 'closed', 'rewarded', 'failed', 'no_fill', 'unsupported']

// Hard ceiling on how long a clicked-out show may hold the `active` slot while
// it waits for the player to come back from the store. It matches the server's
// RESERVATION_TTL in backend/adserving.js, and it is a CEILING rather than a
// setting: a publisher can ask for less, never for more.
const MAX_CLICK_SUSPEND_MS = 60000

function el(tag, style, props) {
  const e = document.createElement(tag)
  if (style) Object.assign(e.style, style)
  if (props) Object.assign(e, props)
  return e
}

// Layout lives in a stylesheet, not in inline styles, for one reason: media
// queries. A phone that turns sideways loses ~55% of its height, and a column
// of [creative, headline, CTA, footer] that fits in portrait cannot fit in
// landscape at any size. Only a rule can say "in landscape, lay this out as a
// row" - an inline style cannot, and a JS resize listener that recomputes it
// is a listener we would have to remember to tear down on every exit path.
//
// Sizing rule: the CREATIVE is the thing that gets sized, and it is sized by
// its own intrinsic ratio against a box with a definite width AND height
// (max-width/max-height + width:auto/height:auto). That fits any ratio the
// advertiser ships - 16:9, 9:16, 1:1, 4:5 - with no per-format branching and
// no cropping.
//
// What NOT to do here, learned the hard way: put `aspect-ratio` on the frame
// and `height:100%` on the media inside it. The frame's width then depends on
// the media and the media's height on the frame; the box collapses to 0x0 and
// the video never plays. The frame keeps a definite size; only the media flexes.
const LAYOUT_CSS = `
.w2a-backdrop{
 --w2a-t:env(safe-area-inset-top,0px);--w2a-r:env(safe-area-inset-right,0px);
 --w2a-b:env(safe-area-inset-bottom,0px);--w2a-l:env(safe-area-inset-left,0px);
 position:fixed;top:0;left:0;width:100%;height:100vh;height:100dvh;z-index:2147483647;
 display:block;margin:0;padding:0;overflow:hidden;overscroll-behavior:contain;
 background:#000;color:#fff;isolation:isolate;box-sizing:border-box;
 font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.w2a-backdrop *,.w2a-backdrop *::before,.w2a-backdrop *::after{box-sizing:border-box}
.w2a-stage,.w2a-cardwrap,.w2a-card{position:absolute;inset:0;display:block;width:100%;height:100%;
 min-width:0;min-height:0;margin:0;padding:0;overflow:hidden;border:0;border-radius:0;
 box-shadow:none;background:transparent}
.w2a-media{position:absolute;z-index:10;inset:0;display:block;
 width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;
 margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;
 object-fit:contain;object-position:50% 50%}
iframe.w2a-media,.w2a-frame{position:absolute;z-index:10;inset:0;width:100%;height:100%;
 border:0;border-radius:0;box-shadow:none;background:#000}
/* Cover is opt-in and bounded. It is allowed only when the creative is marked
   crop-safe AND the viewport/creative mismatch is at most 1.25x, which keeps at
   least 80% of the source dimension on screen. Outside that window it falls back
   to contain on its own - a square creative on a tall phone would lose 27% from
   each side, and no amount of "full bleed" is worth that. */
@media (min-aspect-ratio:9/20) and (max-aspect-ratio:45/64){
 .w2a-backdrop[data-fit="auto"][data-crop-safe="true"][data-ratio="9x16"] :is(img,video).w2a-media{object-fit:cover}}
@media (min-aspect-ratio:64/45) and (max-aspect-ratio:20/9){
 .w2a-backdrop[data-fit="auto"][data-crop-safe="true"][data-ratio="16x9"] :is(img,video).w2a-media{object-fit:cover}}
@media (min-aspect-ratio:4/5) and (max-aspect-ratio:5/4){
 .w2a-backdrop[data-fit="auto"][data-crop-safe="true"][data-ratio="1x1"] :is(img,video).w2a-media{object-fit:cover}}
@media (min-aspect-ratio:16/25) and (max-aspect-ratio:1/1){
 .w2a-backdrop[data-fit="auto"][data-crop-safe="true"][data-ratio="4x5"] :is(img,video).w2a-media{object-fit:cover}}
.w2a-backdrop[data-fit="cover"][data-crop-safe="true"] :is(img,video).w2a-media{object-fit:cover}
/* TWO SHAPES, and only two. Every large network converged on the same pair, and
   the partner's side-by-side asked for exactly it:
     BAR  - while the creative is running: app icon on the left, CTA pill on the
            right, over a short gradient. It reserves ~80px and nothing else.
     CARD - once the creative is finished: a centred stack (icon, name, facts,
            CTA) over a dimmed, blurred still of the creative.
   What this replaces, and why. The panel used to be a bottom SHEET anchored over
   the creative's own end-card art. On Toon Blocks that art has a "PLAY NOW"
   button in the same band, so the sheet cut it in half - the partner
   photographed it. A scrim was tried first and did not help, because the defect
   is COLLISION, not contrast: dimming a button that sits across the app name
   leaves a dim button still sitting across the app name. A centred card cannot
   collide with the art at all, because the whole art is behind the scrim. */
.w2a-side{position:absolute;z-index:30;top:auto;left:0;right:0;bottom:0;width:auto;
 display:flex;flex-direction:row;align-items:center;gap:14px;
 padding:16px calc(var(--w2a-r) + 16px) calc(var(--w2a-b) + 16px) calc(var(--w2a-l) + 16px);
 background:linear-gradient(to top,rgba(0,0,0,.78) 0%,rgba(0,0,0,.42) 55%,transparent 100%);
 text-align:left;pointer-events:none}
.w2a-listing{display:flex;flex-direction:column;gap:2px;min-width:0}
/* CARD. Applies to the two kinds that HAVE a finished state. A static image ad
   is in the endcard phase from its first frame - scrimming it would blur the
   only thing we were paid to show - so it keeps the bar. */
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-side{
 inset:0;flex-direction:column;align-items:center;justify-content:center;
 gap:10px;text-align:center;
 padding:calc(var(--w2a-t) + 78px) calc(var(--w2a-r) + 24px) calc(var(--w2a-b) + 26px) calc(var(--w2a-l) + 24px);
 background:rgba(6,8,14,.84);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-listing{
 align-items:center;gap:6px}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-cta{
 margin:12px 0 0;
 min-width:220px;min-width:clamp(220px,84.6vmin,330px);
 min-height:58px;min-height:clamp(58px,22.3vmin,87px);
 font-size:19px;font-size:clamp(19px,7.44vmin,29px)}
.w2a-headline{margin:0;color:#fff;font-size:17px;line-height:1.2;font-weight:700;
 text-shadow:0 2px 8px rgba(0,0,0,.8);
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.w2a-subtitle{margin:0;color:rgba(255,255,255,.78);font-size:13px;line-height:1.35;
 font-weight:500;text-shadow:0 2px 6px rgba(0,0,0,.8);
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* During playback the creative is the message: host copy must not reserve screen,
   so the bar carries the icon and the pill and nothing else. The listing comes
   back on the end card, where there is a whole screen for it. */
.w2a-backdrop[data-phase="video"] .w2a-listing{display:none}
/* With the listing gone the bar is two objects, and the reference keeps them
   TOGETHER at the trailing edge rather than pinned to opposite corners. In
   landscape that lands both of them in the pillarbox gutter beside a portrait
   creative, which is exactly where the reference puts them and is why nothing
   overlaps the gameplay. The auto margin on the pill has to be cancelled here or
   it would split the free space between the two and strand the icon mid-bar. */
.w2a-backdrop[data-phase="video"] .w2a-side{justify-content:flex-end}
.w2a-backdrop[data-phase="video"] .w2a-cta{margin-left:0}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-headline{
 font-size:26px;font-weight:800;white-space:normal;text-shadow:none}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-subtitle{
 font-size:15px;white-space:normal;text-shadow:none}
/* A playable owns the screen WHILE it is being played, so the panel is hidden
   then - not for the whole ad. It used to be hidden unconditionally, which
   meant a playable had no Install button at any point: the creative posts
   complete expecting the parent to reveal its CTA (the iframe is sandboxed
   without top navigation, so it cannot link to a store itself), and the parent
   never did. Every playable impression was unconvertible. */
.w2a-backdrop[data-kind="playable"][data-phase="video"] .w2a-side{display:none}
/* A PILL, not a full-width slab. The slab was the loudest difference in the
   partner's comparison: at 100% width with a 12px radius it reads as a page
   footer, and on the end card it spanned the whole phone under a centred logo.
   Every reference CTA in this category is a capsule sized to its own label. */
/* The auto left margin pushes the pill to the far edge of the bar rather than
   the row being justified apart, so a missing app icon cannot re-centre the
   button. It lives HERE, inside the shorthand, and not in an earlier standalone
   rule: the margin shorthand below sits later in the sheet at equal specificity
   and silently won, which put the Install pill next to the icon on the LEFT of
   the screen. The end-card rule that re-centres it is more specific, so it still
   wins. */
/* SIZE: PROPORTIONAL BETWEEN TWO FIXED ENDS.
   The button read as small against the creative, so it is bigger - as a ratio,
   not a constant, because a phone and a tablet do not want the same pixels.
   The two ends are what keep a ratio honest:
     floor   = the OLD size. vmin measures the viewport the SDK is embedded in,
               not the device, so a small slot would otherwise make the button
               smaller than before - turning "1.5x bigger" into "smaller" in
               exactly the places it is already hard to tap.
     ceiling = the old size times 1.5, which is what was asked for. Without it a
               768px short side gives 2x, and a tablet gets a banner.
   Between them it tracks vmin, calibrated so a 390x844 phone lands exactly on
   the ceiling: 52 -> 78, 17 -> 26, 30 -> 45.
   vmin rather than vw or vh: it is the short side, so the button is the same
   size before and after a rotation, and a short landscape viewport shrinks it
   without needing a media query to catch it.
   Each clamp is preceded by the plain value it clamps to. clamp() is Safari
   13.1 and Chrome 79; an engine older than that drops the whole declaration,
   and losing min-height entirely is worse than losing the proportionality. */
.w2a-cta{pointer-events:auto;touch-action:manipulation;appearance:none;
 display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
 min-height:52px;min-height:clamp(52px,20vmin,78px);margin:0 0 0 auto;
 padding:0 30px;padding:0 clamp(30px,11.5vmin,45px);max-width:100%;
 border:0;border-radius:999px;
 background:linear-gradient(180deg,#35d17e 0%,#12a55b 100%);color:#000;
 box-shadow:0 6px 22px rgba(0,0,0,.45);
 font:inherit;font-size:17px;font-size:clamp(17px,6.67vmin,26px);
 line-height:1.2;font-weight:700;text-align:center;
 white-space:nowrap;text-decoration:none;cursor:pointer;
 transition:filter .2s,transform .1s}
.w2a-cta:active{filter:brightness(.94);transform:scale(.98)}
/* Our own request id / format / placement is plumbing. It was being rendered
   under every creative, where a partner reads it as an unfinished build. */
.w2a-backdrop:not([data-debug="true"]) .w2a-meta{display:none!important}
.w2a-meta{margin:0;pointer-events:none}
/* 50px, not 44: MRAID 3.0 requires a close region of at least 50x50 dp and
   recommends the top-right corner. Apple's 44pt is a floor for buttons in
   general, not for the control that dismisses a full-screen ad. */
/* FILLED discs, not outlined ones. A 1px translucent ring around a dark circle
   is what an unstyled placeholder looks like at phone scale, and it was the
   detail the partner's comparison landed on first. A filled disc also survives a
   light creative underneath, which a hairline outline does not. */
.w2a-backdrop button[data-w2a="close"],.w2a-backdrop button[data-w2a="sound"]{
 position:absolute;display:grid;place-items:center;width:50px;height:50px;margin:0;padding:0;
 border:0;border-radius:50%;background:rgba(0,0,0,.55);
 -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
 color:#fff;box-shadow:none;font:inherit;line-height:1;font-weight:600;
 cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.w2a-backdrop button[data-w2a="close"]{z-index:60;
 top:calc(var(--w2a-t) + 12px);right:calc(var(--w2a-r) + 12px);left:auto;font-size:24px}
/* Locked: a rewarded video's close slot carries the credible playback still
   owed. Fixed width and tabular digits keep the pill stable as the value moves.
   It keeps the same safe-area anchors as the armed disc. */
.w2a-backdrop button[data-w2a="close"][data-state="locked"]{
 width:112px;min-width:112px;padding:0 12px;border-radius:999px;font-size:14px;
 font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;color:#ddd}
/* A LABELLED PILL, not a disc with a speaker glyph. The glyph version was read
   as a mute switch by the first partner who saw it - reasonably, because a
   crossed-out speaker is what a mute control looks like everywhere else. It is
   the opposite: the only way back to sound after the browser refused unmuted
   autoplay. Overriding width and border-radius from the shared disc rule above
   is deliberate; the label has to fit, and it is the label that removes the
   ambiguity. */
.w2a-backdrop button[data-w2a="sound"]{z-index:50;
 top:calc(var(--w2a-t) + 12px);left:calc(var(--w2a-l) + 12px);right:auto;
 width:auto;min-width:50px;padding:0 16px;border-radius:999px;font-size:14px;
 white-space:nowrap}
.w2a-backdrop button[data-w2a="reward"]{pointer-events:auto;z-index:30;flex:0 0 auto;
 background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);color:#fff;
 padding:10px 18px;border-radius:999px;font-size:14px;min-height:44px;cursor:pointer;
 -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.w2a-backdrop button[data-w2a="close"]:focus-visible,
.w2a-backdrop button[data-w2a="sound"]:focus-visible,
.w2a-cta:focus-visible{outline:3px solid #fff;outline-offset:3px}
/* LANDSCAPE is the SAME two shapes, only tuned for a short viewport.
   What this replaces: a two-column split with an opaque panel beside the
   creative, built when the reference the partner pointed at was Google's
   renderer. That reference is now AppLovin, which overlays rather than splits -
   and the split had two defects of its own, both photographed on a handset:
     - Below its own 600x320 floor it fell back to the PORTRAIT bottom sheet.
       A phone in landscape, minus the browser chrome, is about 290 CSS px tall,
       so the fallback was not an edge case - it was the common case, and the
       ad rendered as a portrait sheet crammed sideways.
     - On the end card, the rule that removed the sheet's background also
       removed the panel's own, leaving #111827 text on black. The listing was
       invisible and nothing said so.
   One layout that adapts cannot drift apart from itself the way two did. The
   pill lands in the pillarbox gutter for a portrait creative on a landscape
   screen - which is where the reference puts it - and over the bottom-right
   corner when the creative fills the width, which is what the reference does
   too. No JS measures anything, so rotation re-resolves for free. */
@media (orientation:landscape){
 .w2a-side{padding-top:12px;padding-bottom:calc(var(--w2a-b) + 12px)}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-side{
  gap:6px;padding-top:calc(var(--w2a-t) + 64px);padding-bottom:calc(var(--w2a-b) + 16px)}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-app-icon{
  width:78px;height:78px;border-radius:18px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-headline{font-size:21px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-cta{
  margin-top:6px;min-height:50px;min-height:clamp(50px,19.2vmin,75px);
  font-size:17px;font-size:clamp(17px,6.67vmin,26px)}}
/* Under ~400px of height the end card has to give something up. It gives up the
   store name and shrinks the icon, in that order: the name is the least
   load-bearing line on the card, and the button is the reason the card exists. */
@media (orientation:landscape) and (max-height:400px){
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-app-icon{
  width:56px;height:56px;border-radius:14px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-headline{font-size:19px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-store-name{display:none}}
/* Below ~340px of height the card still has to give something up, even with a
   proportional button: measured, it overflowed its own panel at 640x300. The
   order of sacrifice is unchanged - icon and subtitle first, button last. The
   button itself needs no rule here, because vmin already tracks the short side;
   only its min-width does, so a 260px floor cannot exceed a narrow viewport. */
@media (orientation:landscape) and (max-height:340px){
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-app-icon{
  width:44px;height:44px;border-radius:12px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-subtitle{display:none}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-headline{font-size:17px}
 .w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-cta{
  margin-top:4px;min-width:200px;min-width:min(260px,62vw)}}

/* The HTML hidden ATTRIBUTE is only display:none in the UA stylesheet, and ANY
   author display rule outranks it. Three elements here carried an author display
   - the icon, the facts row and the store name - so setting .hidden = true,
   which is how every one of them is meant to disappear when the advertiser did
   not supply that field, did precisely nothing. The grey plate the partner
   photographed where the app icon belongs is this bug: the icon's own error
   handler set hidden and the plate stayed.
   Restated once, for the whole overlay, so the next element with an author
   display does not reintroduce it. The !important is restoring UA behaviour that
   author rules are outranking, which is the case the keyword is actually for. */
.w2a-backdrop [hidden]{display:none!important}

/* End-card store listing: icon, rating, downloads. In the BAR the icon is a
   52px badge next to the pill; on the CARD it is the largest thing on screen,
   because a store listing is what the end card is. No background plate under it
   in either: an icon that has not loaded yet should be nothing, not a grey
   square that looks like a broken build. */
.w2a-app-icon{display:block;width:52px;height:52px;border-radius:14px;
 object-fit:cover;background:transparent;align-self:center;flex:0 0 auto;
 box-shadow:0 4px 14px rgba(0,0,0,.45)}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"] .w2a-app-icon{
 width:108px;height:108px;border-radius:26px;box-shadow:0 12px 32px rgba(0,0,0,.55)}
.w2a-store-facts{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:4px 14px;
 margin:0;font-size:14px;font-weight:650;text-shadow:0 2px 6px rgba(0,0,0,.8)}
.w2a-store-name{margin:0;font-size:13px;text-align:left;opacity:.85;
 text-shadow:0 2px 6px rgba(0,0,0,.8)}
.w2a-backdrop:is([data-kind="video"],[data-kind="playable"])[data-phase="endcard"]
 :is(.w2a-store-facts,.w2a-store-name){justify-content:center;text-align:center;text-shadow:none}
.w2a-store-facts{color:#f3f4f6}.w2a-store-name{color:#d1d5db}

/* Ad disclosure. Top-CENTRE deliberately: the top-left corner holds the sound
   control and the top-right holds close, so a corner label collides with the two
   controls a thumb reaches for. Opaque black on white is 21:1 contrast, well past
   the 4.5:1 accessibility floor, because this has to stay legible over an
   arbitrary advertiser creative rather than over our own background. */
/* A capsule, 11px, uppercase - the shape a disclosure takes everywhere else.
   The 12px block with a 4px radius read as a sticker pasted on the creative,
   which is the first thing the partner circled. The background stays OPAQUE
   black: this label has to hold 4.5:1 over an arbitrary advertiser creative, and
   a translucent chip over a light one falls to about 3:1. Prettier is not a
   reason to lose a contrast floor, so only the geometry changed. */
.w2a-ad-label{position:absolute;z-index:70;
 top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);
 display:flex;align-items:center;justify-content:center;
 min-height:20px;padding:3px 10px;border-radius:999px;
 background:#000;color:#fff;
 font:600 11px/14px system-ui,-apple-system,sans-serif;
 letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;pointer-events:none}
`
// VAST ships one ad in several shapes and expects the PLAYER to choose between
// them - that is what the width/height attributes on MediaFile are for. We took
// the first node in the document, so a landscape phone got served the 9:16 cut
// and lost most of its screen to letterboxing while the 16:9 cut sat unused in
// the very same response.
//
// The choice is made ONCE, when the ad loads. Re-picking on rotation would mean
// swapping `src` mid-flight, which restarts playback and re-buffers: the layout
// already adapts to the new orientation on its own, so a swap would buy nothing
// and cost the view.
function pickMediaFile(nodes, slotRatio) {
  const cands = []
  for (const n of nodes || []) {
    const url = (n.textContent || '').trim()
    if (!url) continue
    const w = Number(n.getAttribute('width')), h = Number(n.getAttribute('height'))
    cands.push({
      url,
      // A file that declares no size is still playable, so it stays in as a
      // last resort instead of being dropped - it just never beats a sized one.
      ratio: w > 0 && h > 0 ? w / h : null,
      bitrate: Number(n.getAttribute('bitrate')) || 0,
    })
  }
  if (!cands.length) return null
  // Distance in log space, because ratios are multiplicative: 16:9-vs-1:1 and
  // 1:1-vs-9:16 are the same amount of wrong, and plain subtraction says the
  // wide one is nearly twice as far off.
  const dist = (c) => (c.ratio == null ? Infinity : Math.abs(Math.log(c.ratio / slotRatio)))
  cands.sort((a, b) => (dist(a) - dist(b)) || (a.bitrate - b.bitrate))
  return cands[0].url
}

// The CSS gates full-bleed per RATIO BUCKET, so the bucket has to be named. Taken
// from the creative's own dimensions once they are known, not from the file name:
// a MediaFile can claim anything, and the pixels are what the browser will fit.
function ratioBucket(w, h) {
  if (!(w > 0 && h > 0)) return null
  const r = w / h
  const buckets = [['16x9', 16 / 9], ['1x1', 1], ['4x5', 4 / 5], ['9x16', 9 / 16]]
  let best = null, bestD = Infinity
  for (const [name, br] of buckets) {
    const d = Math.abs(Math.log(r / br))
    if (d < bestD) { bestD = d; best = name }
  }
  // Beyond ~6% off a named bucket it is not that shape, and claiming it is would
  // let the CSS crop something it was never cleared to crop.
  return bestD < 0.06 ? best : null
}

// The ad is full-screen, so the slot IS the viewport. Falls back to square,
// which is the shape that is least wrong for both orientations, when the host
// gives us no usable dimensions.
function viewportRatio() {
  const w = (typeof window !== 'undefined' && window.innerWidth) || 0
  const h = (typeof window !== 'undefined' && window.innerHeight) || 0
  return w > 0 && h > 0 ? w / h : 1
}

// ---------------------------------------------------------------------------
// Presentation surface.
//
// `position:fixed; inset:0` fills the viewport of OUR document. On a portal the
// game is a cross-origin iframe, so that is the game frame, not the browser
// window - which is exactly what a partner means by "the ad was not full
// screen". The only web mechanism that escapes the frame is the Fullscreen API,
// and it needs three things at once: the embedding page to delegate the
// permission (`allow="fullscreen"`), live transient activation in OUR document,
// and a platform that has element fullscreen at all - which iPhone does not, at
// any version.
//
// Worth knowing before judging this as a shortfall: the portals' OWN ad SDKs do
// the same thing we do. Poki renders its ad into the game document with
// `position:fixed` and never calls requestFullscreen. GameDistribution sizes its
// container to the game document. Only CrazyGames covers the window, and only
// because their SDK is a postMessage bridge into a parent page they own - which
// a third-party in-frame SDK cannot replicate without the portal's cooperation.
// Google's own H5 contract is "the ad must always fully cover the enclosing
// document", and that is the floor we must never regress on.
//
// So: cover the document always, upgrade to the screen where the host allows
// it, and REPORT which of the two actually happened on every ad event.
function isFramed() {
  try { return window.self !== window.top } catch { return true } // a cross-origin throw is itself proof
}
// `fullscreenEnabled` is precisely "would requestFullscreen be permitted here" -
// it is false both when the parent withheld the permission and on iPhone.
function fullscreenAllowed() {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true
}
function foreignFullscreen() {
  return typeof document !== 'undefined' && !!document.fullscreenElement
}
function fullscreenBlocksOverlay() {
  if (typeof document === 'undefined') return false
  const element = document.fullscreenElement
  // The SDK overlay lives under <body>. When the root element is fullscreen,
  // the overlay remains inside that top-layer subtree and can cover it. A child
  // fullscreen element, such as a video or canvas, excludes our sibling overlay.
  return !!(element && element !== document.documentElement)
}
// Transient activation, not sticky: requestFullscreen needs a gesture that is
// still live, and it CONSUMES it. Absent the API we assume no activation rather
// than guessing yes, so we report 'no_activation' instead of a bare rejection.
function hasActivation() {
  const ua = typeof navigator !== 'undefined' && navigator.userActivation
  return !!(ua && ua.isActive)
}

/**
 * Is the browser painting UI that fullscreen would reclaim?
 *
 * MEASURED, not read off the user agent. Two conditions, and both are needed:
 *
 *   coarse pointer - a desktop window is routinely smaller than the screen for
 *     reasons that have nothing to do with a toolbar (it was resized, it is
 *     tiled, there is a second monitor). Without this check every windowed
 *     desktop browser would look like a phone with an address bar, and a
 *     top-level desktop ad would start yanking the tab into fullscreen.
 *
 *   viewport shorter than the screen - this is the toolbar itself, in CSS
 *     pixels. Compared on the axis the chrome actually eats, which is the
 *     CURRENT orientation's height: a phone in landscape reports a screen whose
 *     long side may or may not follow the rotation depending on the platform, so
 *     the screen's height for this purpose is min/max of the two by orientation
 *     rather than `screen.height` as reported.
 *
 * The 6% slack absorbs a rounding difference and a hairline gesture bar without
 * calling either of them a toolbar.
 */
function browserChromeVisible() {
  try {
    if (typeof window === 'undefined' || typeof screen === 'undefined') return false
    const coarse = (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0)
      || !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)
    if (!coarse) return false
    const sh = screen.height || 0, sw = screen.width || 0
    const vh = window.innerHeight || 0, vw = window.innerWidth || 0
    if (!(sh > 0 && sw > 0 && vh > 0 && vw > 0)) return false
    const screenH = vh >= vw ? Math.max(sh, sw) : Math.min(sh, sw)
    return vh < screenH * 0.94
  } catch (e) { return false }
}

// Idempotent: a page may run several ads, and re-appending the same rules on
// every show would grow the head without bound.
function injectLayoutCss(doc) {
  if (!doc || doc.getElementById('w2a-layout-css')) return
  const s = doc.createElement('style')
  s.id = 'w2a-layout-css'
  s.textContent = LAYOUT_CSS
  ;(doc.head || doc.documentElement).appendChild(s)
}

/**
 * What a publisher is allowed to see.
 *
 * Named fields with checked types, rather than "ctx minus the bits we remember
 * to delete": a deny-list has to be updated every time the render path gains an
 * internal, and it silently fails open when someone forgets. This fails closed -
 * a new internal is invisible until it is deliberately published - and the
 * result is frozen and structured-cloneable, so an integration can forward it
 * across a worker or postMessage boundary.
 */
const PUBLIC_STRING_FIELDS = Object.freeze([
  'state', 'requestId', 'blockingRequestId', 'format', 'placement', 'reason', 'detail', 'campaignId',
  'tier', 'impressionState', 'readinessProof', 'audio', 'playableSizing',
  'fullscreen', 'presentation', 'clickPhase',
  // A reward is money the PUBLISHER pays its own player, so the evidence behind
  // it has to travel with the event. `dwell_only` next to `full` is the whole
  // point: a mediation partner can tell a watched video from a waited-out one.
  'rewardBasis', 'rewardQuality',
])
const PUBLIC_NUMBER_FIELDS = Object.freeze([
  'priceCpm',
  'rewardCoverageRatio', 'rewardAttentionRatio', 'rewardDurationMs',
  'rewardVisibleMs', 'rewardSeeks', 'rewardRejectedJumps', 'rewardMaxRate',
])
const PUBLIC_BOOLEAN_FIELDS = Object.freeze([
  'preloaded', 'matched', 'impressionConfirmed', 'clicked', 'visibilityEnforced',
  'synthetic', 'framed', 'ctaGatedByImpression', 'completed', 'paused', 'suspended',
  'rewardEarned', 'rewardEndedSeen', 'playableCompleteSeen', 'rewardVisibilityEnforced',
])

function publicEventDto(data) {
  const out = {}
  for (const key of PUBLIC_STRING_FIELDS) {
    if (typeof data[key] === 'string') out[key] = data[key]
  }
  for (const key of PUBLIC_NUMBER_FIELDS) {
    if (Number.isFinite(data[key])) out[key] = data[key]
  }
  for (const key of PUBLIC_BOOLEAN_FIELDS) {
    if (typeof data[key] === 'boolean') out[key] = data[key]
  }
  return Object.freeze(out)
}

/**
 * What the player actually watched, measured instead of assumed.
 *
 * The reward used to be gated on the browser's `ended` event. `ended` is cheap
 * to produce without watching anything: assign `currentTime = duration`, or set
 * `playbackRate = 16` and wait two seconds. Both fire a perfectly genuine
 * `ended`, and both used to pay out in full.
 *
 * The runtime gate now latches when min(coverage, attention) reaches
 * videoRewardMs. Natural `ended` remains separate: it marks VAST completion and
 * the exported legacy ratio verdict, but is not required for the publisher's
 * 30-second eligibility latch. The two measurements are:
 *
 *   coverage  - the UNION of the media intervals that were played through. A
 *               union, not a running sum of deltas: watching the same ten
 *               seconds three times is ten seconds of the film, and a sum would
 *               score it as thirty. This is what a seek cannot buy.
 *   attention - real elapsed time during which the media was advancing AND the
 *               ad was on screen. This is what a fast playback rate cannot buy:
 *               rate 16 covers the whole film in a sixteenth of the attention.
 *
 * A sample counts only when the media advanced no faster than the clock allows,
 * `dm <= max(minStepMs, tolerance * dw)`. The wall-relative term is what keeps
 * an honest player on a stalled main thread from being scored as a cheat - a
 * three-second event-loop gap legitimately carries three seconds of media. The
 * fixed floor does the same job for a coarse clock and for the ordinary gap
 * between `timeupdate` events, which fire as slowly as 4Hz.
 *
 * This is NOT a security boundary and must not be described as one. The SDK
 * shares a document with the game, so a hostile host can patch these methods or
 * simply grant its own player the currency directly. What this buys is that the
 * cheap cheats stop working silently, and that the terminal event carries the
 * evidence instead of a bare verdict.
 */
/**
 * What has to be undone when a particular show ends, keyed by that show.
 *
 * These three handlers used to live on the SDK instance, one slot each. Preloads
 * are keyed by `format|placement`, so two of them coexist by design - and the
 * second one to render overwrote all three slots. Finishing the FIRST ad then
 * removed the SECOND ad's visibility and message listeners and leaked its own,
 * which left the still-unshown ad unable to measure whether it was on screen and
 * deaf to its own playable. A `WeakMap` rather than a field on `ctx` because
 * `ctx` is spread into every publisher event, and a callable there is exactly the
 * leak that was closed earlier.
 */
const showTeardown = new WeakMap()
const showSettlements = new WeakMap()

function createShowSettlement(ctx) {
  const existing = showSettlements.get(ctx)
  if (existing) return existing.result
  let resolveResult
  const result = new Promise((resolve) => { resolveResult = resolve })
  showSettlements.set(ctx, { result, resolveResult, settled: false, rewarded: false })
  return result
}

function latchShowReward(ctx) {
  const settlement = showSettlements.get(ctx)
  if (settlement) settlement.rewarded = true
  return settlement ? settlement.rewarded : true
}

function settleShow(ctx, terminal) {
  const settlement = showSettlements.get(ctx)
  if (!settlement || settlement.settled) return
  settlement.settled = true
  const result = {
    requestId: terminal.requestId,
    format: terminal.format,
    placement: terminal.placement,
    status: terminal.state,
    rewarded: settlement.rewarded === true,
  }
  if (typeof terminal.reason === 'string') result.reason = terminal.reason
  if (typeof terminal.blockingRequestId === 'string') result.blockingRequestId = terminal.blockingRequestId
  settlement.resolveResult(Object.freeze(result))
  settlement.resolveResult = null
}

export function createRewardEvidence(opts = {}) {
  const optNum = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const minStepMs = optNum(opts.minStepMs, 500)
  const tolerance = optNum(opts.tolerance, 1.25)
  const maxRate = optNum(opts.maxRate, 1.05)
  const requiredRatio = optNum(opts.requiredRatio, 0.9)
  const fullRatio = optNum(opts.fullRatio, 0.98)

  const covered = []          // merged [startMs, endMs] of media actually played
  let attentionMs = 0
  let anchor = null           // { mediaMs, wallMs } of the last credible sample
  let epochMediaMs = 0
  let epochWallMs = 0
  let epochAttentionMs = 0
  let ended = false
  let seeks = 0, rejectedJumps = 0, rateViolations = 0, maxRateSeen = 0

  // Ratios are compared with a tolerance because 0.9 is not representable and a
  // player who watched exactly the required share must not lose on the last bit.
  const atLeast = (a, b) => a >= b - 1e-9

  function merge(startMs, endMs) {
    if (!(endMs > startMs)) return
    let lo = startMs, hi = endMs
    const keep = []
    for (const iv of covered) {
      if (iv[1] < lo || iv[0] > hi) { keep.push(iv); continue }
      lo = Math.min(lo, iv[0])
      hi = Math.max(hi, iv[1])
    }
    keep.push([lo, hi])
    keep.sort((a, b) => a[0] - b[0])
    covered.length = 0
    for (const iv of keep) covered.push(iv)
  }

  const coveredMs = () => covered.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0)
  const resetEpoch = () => {
    epochMediaMs = 0
    epochWallMs = 0
    epochAttentionMs = 0
  }
  const breakEpoch = () => {
    anchor = null
    resetEpoch()
  }

  return {
    /**
     * One observation of the player. Call it on `timeupdate` and on every event
     * that ends a playback epoch (pause, seeking, waiting, ratechange, hide,
     * ended) - an epoch that is not closed leaves its final segment uncounted.
     */
    sample(s) {
      const mediaMs = Number(s && s.mediaSec) * 1000
      const wallMs = Number(s && s.wallMs)
      const rate = Number(s && s.rate)
      if (!Number.isFinite(mediaMs) || !Number.isFinite(wallMs)) { breakEpoch(); return }
      if (Number.isFinite(rate) && rate > maxRateSeen) maxRateSeen = rate
      // Anything that is not "on screen and advancing at an honest rate" ends
      // the epoch. Dropping the anchor is the point: time accrued before a
      // pause must never license the media jump that follows it.
      if (!s.playing || !s.visible || !(rate > 0)) { breakEpoch(); return }
      if (rate > maxRate) { rateViolations++; breakEpoch(); return }
      if (anchor === null) { resetEpoch(); anchor = { mediaMs, wallMs }; return }
      const dw = wallMs - anchor.wallMs
      const dm = mediaMs - anchor.mediaMs
      if (dw < 0) { resetEpoch(); anchor = { mediaMs, wallMs }; return }   // clock went backwards
      // Several listeners can observe the exact same clock point in one event
      // turn. A redundant observation must be a no-op: resetting the epoch here
      // would make evidence depend on how many listeners happened to sample it.
      if (dm === 0 && dw === 0) return
      if (dm <= 0) {
        // Standing still while visible: a stall, or a backward seek. Neither is
        // coverage and neither is attention, but neither is a cheat either.
        // The wall surplus accumulated before a stationary sample must not pay
        // later media. Keep the current point as the next anchor, but start a
        // fresh comparison window on either zero or backward progress.
        if (dm < 0) seeks++
        resetEpoch()
        anchor = { mediaMs, wallMs }
        return
      }
      if (dm > Math.max(minStepMs, tolerance * dw)) {
        // The film moved further than the clock allows: a seek, or a rate the
        // element reported as 1 while behaving otherwise.
        rejectedJumps++
        seeks++
        resetEpoch()
        anchor = { mediaMs, wallMs }
        return
      }
      merge(anchor.mediaMs, mediaMs)
      // Compare totals inside one uninterrupted playback epoch, not each sample
      // in isolation. Real media and monotonic clocks trade a few milliseconds
      // of lead between adjacent events. Summing min(dm, dw) discarded both
      // halves of that harmless jitter and turned a 30-second wall/media span
      // into 29.37 seconds of attention. Epoch totals let the next credible
      // sample repay the difference, while every pause, hide, seek, invalid
      // rate and rejected jump still destroys the bridge.
      epochMediaMs += dm
      epochWallMs += dw
      const credibleAttentionMs = Math.min(epochMediaMs, epochWallMs)
      if (credibleAttentionMs > epochAttentionMs) {
        attentionMs += credibleAttentionMs - epochAttentionMs
        epochAttentionMs = credibleAttentionMs
      }
      anchor = { mediaMs, wallMs }
    },

    /**
     * End the current playback epoch without discarding what it already earned.
     *
     * The credibility test compares media progress against WALL progress, and
     * that comparison is only meaningful while the film is actually rolling. A
     * buffering stall breaks it: thirty seconds of wall time accrue with the
     * media standing still, and the next sample - a seek straight to the end -
     * then looks like thirty seconds of honest playback. The caller has to say
     * when playback stopped, because nothing in the numbers can tell.
     */
    break() { breakEpoch() },

    /** The creative reached its natural end. */
    end() { ended = true },

    /**
     * @param durationMs total media length, from metadata or from the terminal
     *        currentTime. An unusable duration cannot be scored: there is no
     *        denominator, so the verdict is "not earned by watching" and the
     *        caller falls back to its dwell policy rather than inventing one.
     */
    verdict(durationMs) {
      const d = Number(durationMs)
      const usable = Number.isFinite(d) && d > 0
      // Clip each interval to the film rather than capping the total. Capping
      // the sum lets coverage OUTSIDE the timeline stand in for content inside
      // it, so a stream that briefly reported a currentTime past its own
      // duration could paper over a stretch that was never watched.
      const cov = usable
        ? covered.reduce((sum, iv) => sum + Math.max(0, Math.min(iv[1], d) - Math.max(iv[0], 0)), 0)
        : coveredMs()
      const att = Math.min(attentionMs, usable ? d : Infinity)
      const coverageRatio = usable ? cov / d : null
      const attentionRatio = usable ? att / d : null
      const earned = ended && usable &&
        atLeast(coverageRatio, requiredRatio) && atLeast(attentionRatio, requiredRatio)
      const full = earned && atLeast(coverageRatio, fullRatio) && atLeast(attentionRatio, fullRatio)
      const round = (v) => (v === null ? null : Math.round(v * 1000) / 1000)
      return {
        earned,
        quality: earned ? (full ? 'full' : 'threshold') : 'not_earned',
        endedSeen: ended,
        durationMs: usable ? Math.round(d) : null,
        coverageMs: Math.round(cov),
        attentionMs: Math.round(att),
        coverageRatio: round(coverageRatio),
        attentionRatio: round(attentionRatio),
        seeks,
        rejectedJumps,
        rateViolations,
        maxRate: Math.round(maxRateSeen * 100) / 100,
      }
    },
  }
}

class W2ASDK {
  constructor() {
    this.cfg = null
    this.sessionId = cryptoId()
    // `w2a_click` is NOT a terminal and not a pause/resume. It reports that the
    // player left for the store and that the ad is still standing behind them,
    // which is a state this SDK had no way to express before: a click used to BE
    // the end of the show.
    this.listeners = {
      ad_state: new Set(), w2a_pause: new Set(), w2a_resume: new Set(),
      w2a_impression: new Set(), w2a_click: new Set(),
    }
    this.active = null
    this.overlay = null
    this._timers = [] // billable/rewarded таймеры активного показа
  }

  init(cfg) {
    this.cfg = Object.assign(
      // `creativeFormat` is deliberately ABSENT from these defaults. Materialising
      // one here made "the publisher did not choose" indistinguishable from "the
      // publisher chose image", and the two need different answers: a rewarded
      // ad has no image route anywhere, so the second is a permanent no-fill.
      // Absence is resolved per ad format in `_requestBody`.
      { backend: '', publisherId: 'demo-pub', gameId: 'block-blitz', cell: 'matched', siteId: 'demo', billableMs: 1000, rewardSecs: 5, requestTimeoutMs: 4000,
        // Video has separate clocks. maxVideoMs is retained as the legacy total
        // deadline from activation, never as an allowance added to the film.
        videoRewardMs: 30000, videoStartTimeoutMs: 10000, videoStallTimeoutMs: 10000,
        maxVideoMs: 10000, maxPlayableMs: 20000,
        requireVisible: true, preloadTtlMs: 30000,
        // How long a show waits for a player who left for the store. Clamped to
        // MAX_CLICK_SUSPEND_MS, and cut shorter still by the server's own
        // reservation lease while the impression is unbilled - see the ceiling
        // arithmetic in the CTA path. A show cannot wait forever: it owns the
        // `active` slot, and a game whose next ad is refused as `busy` because a
        // player wandered off yesterday is worse than a lost impression.
        clickReturnTimeoutMs: MAX_CLICK_SUSPEND_MS,
        // 'auto' asks for sound and falls back to muted if the browser refuses.
        // 'muted' is for publishers whose own game audio must keep playing.
        audio: 'auto' },
      // Present-but-undefined keys are DROPPED rather than allowed to overwrite
      // a default. `{ ...base, billableMs: maybeFromRemoteJson }` is the ordinary
      // way to assemble a config, every field is optional in the published type,
      // and `Object.assign` copies an explicit `undefined` over the default just
      // as happily as a number. `billableMs: undefined` then made the billing
      // deadline `NaN`, so the ad rendered, opened and stayed clickable while
      // nothing was ever billed and nothing reported - a silent total loss of
      // impression revenue for that publisher. `requestTimeoutMs: undefined`
      // aborts every ad request instead.
      cfg && Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)),
    )
    // A fresh configuration gets a fresh set of warnings. Whoever calls init()
    // again has changed something, and the point of the once-per-reason rule is
    // to stop repetition, not to hide the effect of a fix.
    this._explained = new Set()
    return this
  }

  on(evt, cb) { this.listeners[evt]?.add(cb); return () => this.listeners[evt]?.delete(cb) }
  _emit(evt, data) {
    // Everything crossing into publisher code goes through the allowlist first.
    // The reward gate leaking was one symptom; the shape was the cause. `ctx`
    // accumulates whatever the render path needs - DOM nodes, timers, internal
    // flags - and spreading it into an event handed a publisher our internals
    // and made the payload un-cloneable, so an integration forwarding events
    // over postMessage broke on fields it never asked for.
    const payload = publicEventDto(data || {})
    // A host listener that throws must not take the SDK down with it: before
    // this, an exception here escaped _finish BEFORE `active` was cleared, so
    // every later show was refused with `busy` for the rest of the session.
    for (const cb of [...(this.listeners[evt] || [])]) {
      try { cb(payload) } catch (e) { /* host listener error is the host's problem */ }
    }
  }

  // consent: read (don't enforce in demo) TCF / GPP / US-privacy signals if a
  // publisher CMP is present; pass state to the backend which records it.
  _readConsent() {
    try {
      // coarse override set by a mediation adapter (e.g. GameDistribution GDPR
      // events), which don't expose a TCF/GPP string. Honest: it's a coarse flag.
      if (this.cfg && this.cfg.consentState) return this.cfg.consentState
      if (typeof window.__tcfapi === 'function') return 'tcf_present'
      if (typeof window.__gpp === 'function') return 'gpp_present'
      const m = document.cookie.match(/(?:^|;\s*)usprivacy=([^;]+)/)
      if (m) return 'usp:' + decodeURIComponent(m[1])
    } catch (e) {}
    return 'unknown'
  }

  /** test seam: override the monotonic clock (null restores the real one) */
  __setNow(fn) { _nowFn = fn || null }

  showAd(format, placement) {
    const ctx = { requestId: cryptoId(), format, placement }
    if (!this.cfg) return this._settleLocalShow(ctx, 'not_initialised')
    if (this.active) {
      ctx.blockingRequestId = this.active.requestId
      return this._settleLocalShow(ctx, 'busy')
    }
    const claim = this.tryShowReady(format, placement)
    if (claim.started) return claim.result
    if (claim.reason === 'not_ready') return this._settleLocalShow(ctx, claim.reason)
    if (claim.reason === 'fullscreen_conflict' || fullscreenBlocksOverlay()) {
      return this._settleLocalShow(ctx, 'fullscreen_conflict')
    }
    const result = createShowSettlement(ctx)
    if (this._startDirectShow(ctx)) this._loadDirectShow(ctx).catch(() => {
      if (!ctx.completed) this._finish(ctx, { state: 'failed', reason: 'internal_error' })
    })
    return result
  }
  showInterstitial(placement) { return this._show('interstitial', placement) }
  showRewarded(placement) { return this._show('rewarded', placement) }

  /**
   * Correlated host escape hatch for a show whose lifecycle went silent.
   * Refuse a stale requestId so one watchdog can never tear down a later ad.
   */
  cancelActive(requestId, reason = 'host_cancelled') {
    const ctx = this.active
    if (!ctx || ctx.completed || !requestId || ctx.requestId !== requestId) return false
    const safeReason = typeof reason === 'string' && reason ? reason.slice(0, 64) : 'host_cancelled'
    this._finish(ctx, { state: 'failed', reason: safeReason })
    return true
  }

  /**
   * Tell a suspended show that the player is back.
   *
   * The browser signals - `visibilitychange`, `pageshow`, `resume` - cover an
   * ordinary web page, and the SDK listens to all of them. They do NOT cover a
   * native Android WebView: `WebView.onPause()` does not pause JavaScript and
   * the document is frequently never marked hidden at all, so a host that
   * retained its WebView while an external store Activity covered it has to say
   * so itself, from `onResume`.
   *
   * Correlated by requestId for the same reason `cancelActive` is: a late
   * Activity callback must not be able to resume an ad that is not the one it
   * was talking about.
   */
  resumeActive(requestId) {
    const ctx = this.active
    if (!ctx || ctx.completed || !requestId || ctx.requestId !== requestId) return false
    const teardown = showTeardown.get(ctx)
    return !!(teardown && teardown.resumeFromClick && teardown.resumeFromClick())
  }

  _settleLocalShow(ctx, reason) {
    const result = createShowSettlement(ctx)
    this._finish(ctx, { state: 'failed', reason })
    return result
  }

  _startDirectShow(ctx) {
    this.active = ctx
    this._state({ ...ctx, state: 'loading' })
    return !ctx.completed && this.active === ctx
  }

  async _show(format, placement) {
    if (!this.cfg) throw new Error('W2A.init was not called')
    if (this.active) {
      // With a `requestId`, like every other event. There is no ad call behind a
      // refusal, so one is minted here - the field's job is to let a host
      // correlate an event with the show it asked for, and a refusal is exactly
      // the case where a host needs to know WHICH of its calls was dropped. It
      // used to be omitted, which broke the published type declaring it required
      // and left a busy refusal indistinguishable from any other.
      const ctx = { requestId: cryptoId(), blockingRequestId: this.active.requestId, format, placement }
      this._state({ ...ctx, state: 'failed', reason: 'busy' })
      return
    }
    // Gesture-safe fast path: a ready preloaded ad is claimed and shown
    // SYNCHRONOUSLY, with no await between the game's tap and the ad appearing.
    const claim = this.tryShowReady(format, placement)
    if (claim.started) return

    // Nothing ready. This is the legacy path: fetch and load the creative AFTER
    // the ad call, which means the player waits. Mediation hosts must not use
    // it - they call tryShowReady() and pass back when it says no.
    const ctx = { requestId: cryptoId(), format, placement }
    if (!this._startDirectShow(ctx)) return
    await this._loadDirectShow(ctx)
  }

  async _loadDirectShow(ctx) {
    const { format, placement } = ctx
    const r = await this._requestAd(ctx.requestId, format, placement)
    // A host watchdog can cancel while the request is in flight. Its terminal
    // may start a newer show immediately, so the stale continuation must neither
    // render nor tear down that newer owner when the network finally answers.
    if (ctx.completed || this.active !== ctx) {
      if (r && r.resp) this._release(ctx.requestId, r.resp)
      return
    }
    if (r.error) {
      this._finish(ctx, { state: 'failed', reason: r.error })
      return
    } // active гарантированно освобождается
    const resp = r.resp
    if (!resp || resp.no_fill || !resp.creative) {
      // Preserve WHY there was no ad. An unsupported device is a permanent
      // property of this player and a mediation host may want to stop asking us;
      // a plain no-bid is transient. Collapsing both into 'no_bid' erased that.
      const reason = noFillReason(resp)
      // `detail` says WHICH check refused - desktop_os, unknown_device_type and
      // so on. Dropping it forced the host to word its message from `reason`
      // alone, so a device we merely could not classify got told, as fact, that
      // it was a desktop. Pass the server's own answer through.
      this._finish(ctx, {
        state: reason === 'unsupported_device' ? 'unsupported' : 'no_fill',
        reason,
        ...(resp && resp.detail ? { detail: String(resp.detail) } : {}),
      })
      return
    }
    // _render вне try выше: любой бросок в рендере ОБЯЗАН пройти через _finish,
    // иначе this.active не сбросится и все следующие показы залипнут в busy
    try {
      this._render(ctx, resp)
    } catch (e) {
      this._finish(ctx, { state: 'failed', reason: 'creative_error' })
    }
  }

  // Shared /v1/request payload (used by _show and preload).
  _requestBody(requestId, format, placement) {
    return JSON.stringify({
      publisherId: this.cfg.publisherId,
      gameId: this.cfg.gameId,
      placement, format, // format = ad format (interstitial/rewarded)
      // THE DEFAULT DEPENDS ON THE AD FORMAT, and it has to. A single `image`
      // default meant that any integration which simply did not set this field
      // asked for a rewarded IMAGE - a route no campaign has - so its rewarded
      // ads were a guaranteed no-fill for ever, with a reason (`no_bid`) that
      // says nothing about the cause. Our own templates set `image` globally,
      // so the documentation walked publishers straight into it, and that is
      // how it reached a partner.
      //
      // `auto` lets the server pick from the routes a campaign actually has,
      // which is the right answer for rewarded and needs no update the day a
      // rewarded image route exists. An explicit setting still wins outright.
      creativeFormat: this.cfg.creativeFormat ?? (format === 'rewarded' ? 'auto' : 'image'),
      sessionId: this.sessionId,
      cell: this.cfg.cell,
      siteId: this.cfg.siteId,
      requestId,
      // Publisher price floor. It was accepted by the backend but the SDK never
      // sent it, so a publisher could not actually set one - and a test could
      // not force a real no-fill decision through the real auction.
      ...(this.cfg.floorCpm != null ? { floorCpm: this.cfg.floorCpm } : {}),
      // Internal harness capability. The server verifies the signature and
      // derives traffic class; there is deliberately no client-set class flag.
      ...(this.cfg.diagnosticCapability
        ? { diagnosticCapability: this.cfg.diagnosticCapability } : {}),
      consent_state: this._readConsent(),
      lang: navigator.language,
      ua: navigator.userAgent,
      // Country is a HINT, and it is labelled as one. A browser cannot prove
      // where it is; the region subtag of the locale is the cheapest honest
      // guess. Real geo is an IP lookup on the server - see geo_source, which
      // exists so reporting can never mistake this for a verified country.
      ...(localeRegion() ? { geo: localeRegion(), geo_source: 'client_hint' } : {}),
      // Real detection by default. `deviceOverride` exists ONLY so an automated
      // harness on a desktop can exercise mobile-targeted creatives; it is opt-in,
      // named for what it is, and never set by a real integration.
      ...(this.cfg.deviceOverride || detectDevice()),
    })
  }

  /**
   * One ad request with an HONEST failure taxonomy. Everything here used to be
   * reported as `timeout`, because `fetch` does not reject on 4xx/5xx - it
   * resolves, and it was `r.json()` that threw on the error body. A mediation
   * host could not tell "we were slow" from "the ad server is broken" from "the
   * ad server answered garbage", and all three are different operational bugs.
   * Returns { resp } or { error, status }.
   */
  async _requestAd(requestId, format, placement) {
    const ctrl = new AbortController()
    let timedOut = false
    const abortTimer = setTimeout(() => { timedOut = true; ctrl.abort() }, this.cfg.requestTimeoutMs)
    let r
    try {
      r = await fetch(this.cfg.backend + '/v1/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: this._requestBody(requestId, format, placement),
      })
    } catch (e) {
      clearTimeout(abortTimer)
      return { error: timedOut ? 'timeout' : 'network_error' }
    }
    clearTimeout(abortTimer)
    if (!r || !r.ok) return { error: 'http_error', status: r ? r.status : 0 }
    try {
      const resp = await r.json()
      // A 200 that is not an object is not a decision we can act on.
      if (!resp || typeof resp !== 'object') return { error: 'bad_response' }
      return { resp }
    } catch (e) { return { error: 'bad_response' } }
  }

  // Prefetch the ad decision WITHOUT rendering, so a later showInterstitial/
  // showRewarded renders synchronously inside a user gesture. Needed when a
  // mediation adapter must pass back to a PARTNER ad on no_fill (partner ad
  // calls require user activation). Returns { filled }. The cached decision is
  // consumed by the next matching _show, or expires after preloadTtlMs.
  async preload(format, placement) {
    if (!this.cfg) throw new Error('W2A.init was not called')
    const key = format + '|' + placement
    this._preloads = this._preloads || {}
    this._preloadSeq = this._preloadSeq || {}
    const gen = (this._preloadSeq[key] = (this._preloadSeq[key] || 0) + 1)
    // Whatever sat here is now obsolete. Tearing it down BEFORE we start also
    // hands its server reservation back, instead of leaving the campaign's
    // budget pinned until the server-side TTL sweep notices.
    this._discardPreload(key, 'superseded')

    const requestId = cryptoId()
    const rec = { key, gen, format, placement, requestId, state: 'requesting', ts: Date.now() }
    this._preloads[key] = rec
    const settle = (state, reason) => {
      // A superseded generation must never write back over a newer record.
      if (this._preloads[key] === rec) { rec.state = state; rec.reason = reason }
      return { filled: !!rec.resp, ready: state === 'ready', reason }
    }

    const r = await this._requestAd(requestId, format, placement)
    if (this._preloadSeq[key] !== gen) {
      // We lost the race, but the SERVER may still have created a reservation
      // for this requestId. Dropping the record silently would leak that budget.
      this._release(requestId, r.resp)
      return { filled: false, ready: false, reason: 'superseded' }
    }
    if (r.error) return settle('failed', r.error)
    const resp = r.resp
    if (!resp || resp.no_fill || !resp.creative) return settle('failed', noFillReason(resp))

    rec.resp = resp
    rec.state = 'loading'
    // How long this ad may be considered usable. Two independent bounds:
    //  - our own preload freshness policy;
    //  - the server's reservation, minus the time a SHOW still needs afterwards
    //    (watch the creative, then commit the impression). Ignoring the second
    //    produced ads that looked ready and then failed to bill on commit.
    // The reservation protects the advertiser's impression, not the publisher's
    // reward. For video it only has to survive genuine startup, one billable
    // stretch of advancing media, and the impression request. Making it survive
    // the whole 30-second reward plus a legacy maxVideoMs rejected usable ads
    // before their VAST document was even fetched.
    // This is deliberately clean-path headroom, not a guarantee across arbitrary
    // recoverable stalls. A late commit still receives the server's real verdict
    // and is reported degraded rather than being called confirmed.
    let creativeShowBudgetMs = Math.max(0, Number(this.cfg.billableMs) || 0)
    if (resp.creative.type === 'vast') {
      creativeShowBudgetMs += Math.max(0, Number(this.cfg.videoStartTimeoutMs) || 0)
    } else if (resp.creative.type === 'playable') {
      creativeShowBudgetMs = Math.max(0, Number(this.cfg.maxPlayableMs) || 0)
    }
    const showBudgetMs = creativeShowBudgetMs
      + (this.cfg.requestTimeoutMs || 4000) + 2000 // + clock skew allowance
    const ttlBound = Date.now() + (this.cfg.preloadTtlMs || 30000)
    const leaseBound = resp.reservationExpiresAt ? (resp.reservationExpiresAt - showBudgetMs) : Infinity
    rec.readyUntil = Math.min(ttlBound, leaseBound)
    if (rec.readyUntil <= Date.now()) { this._discardPreload(key, 'lease_too_short'); return { filled: true, ready: false, reason: 'lease_too_short' } }

    const ctx = { requestId, format, placement, preloaded: true }
    rec.ctx = ctx
    const loadMs = this.cfg.creativeLoadTimeoutMs || 6000
    const outcome = await new Promise((resolve) => {
      let done = false
      const finish = (o) => { if (!done) { done = true; clearTimeout(to); resolve(o) } }
      const to = setTimeout(() => finish({ ok: false, reason: 'creative_timeout' }), loadMs)
      try {
        this._render(ctx, resp, {
          hidden: true,
          onLoaded: () => finish({ ok: true }),
          onLoadError: (reason) => finish({ ok: false, reason }),
        })
      } catch (e) { finish({ ok: false, reason: 'creative_error' }) }
    })
    if (this._preloads[key] !== rec) { this._release(requestId, resp); return { filled: true, ready: false, reason: 'superseded' } }
    if (!outcome.ok) { this._discardPreload(key, outcome.reason); return { filled: true, ready: false, reason: outcome.reason } }
    if (Date.now() > rec.readyUntil) {
      this._discardPreload(key, 'preload_expired')
      return { filled: true, ready: false, reason: 'preload_expired' }
    }

    rec.state = 'ready'
    // Self-expiry: a ready ad that is never shown releases itself, so the
    // campaign budget it is holding does not stay pinned for the whole TTL.
    rec.expiryTimer = setTimeout(() => this._discardPreload(key, 'preload_expired'), Math.max(0, rec.readyUntil - Date.now()))
    return { filled: true, ready: true, requestId, readinessProof: ctx.readinessProof }
  }

  /** Advisory only. The correctness gate is tryShowReady(), which claims atomically. */
  isReady(format, placement, minValidityMs = 0) {
    const rec = this._preloads && this._preloads[format + '|' + placement]
    const headroom = Math.max(0, Number(minValidityMs) || 0)
    return !!(rec && rec.state === 'ready' && Date.now() + headroom <= rec.readyUntil)
  }

  /**
   * Fail-closed, synchronous, single-step claim-and-show. This is the mediation
   * entry point: it either starts our ad right now, inside the caller's user
   * gesture, or it tells you why not so you can pass back in the SAME gesture.
   *
   * It exists instead of `isReady() && show()` because that pair is a
   * time-of-check/time-of-use race: expiry, refresh or another caller can land
   * between the two. Nothing here awaits.
   */
  tryShowReady(format, placement) {
    const attemptId = cryptoId()
    if (!this.cfg) return { started: false, attemptId, reason: 'not_initialised' }
    const key = format + '|' + placement
    const rec = this._preloads && this._preloads[key]
    const requestIdentity = rec && rec.requestId ? { requestId: rec.requestId } : {}
    // Screen ownership dominates readiness. A mediation host may safely pass
    // back `no_preload` or `not_ready`, but doing that while another show or a
    // foreign fullscreen owns the screen stacks two providers. Check ownership
    // first and leave any matching preload untouched for a later opportunity.
    if (this.active) return {
      started: false, attemptId, reason: 'busy', ...requestIdentity,
      blockingRequestId: this.active.requestId,
    }
    // A fullscreen element we do not own means something else is already
    // covering the screen - the game itself, or a video the player expanded.
    // Refuse before the claim: after `started: true`, mediation cannot pass back.
    if (fullscreenBlocksOverlay()) return {
      started: false, attemptId, reason: 'fullscreen_conflict', ...requestIdentity,
    }
    if (!rec) return { started: false, attemptId, reason: 'no_preload' }
    if (rec.state === 'failed') {
      // A decided failure is CONSUMED here, so the next preload starts clean
      // instead of answering with a stale verdict forever.
      delete this._preloads[key]
      return { started: false, attemptId, reason: rec.reason || 'not_ready', requestId: rec.requestId }
    }
    if (rec.state !== 'ready') return { started: false, attemptId, reason: 'not_ready', requestId: rec.requestId }
    if (Date.now() > rec.readyUntil) {
      this._discardPreload(key, 'preload_expired')
      return { started: false, attemptId, reason: 'preload_expired', requestId: rec.requestId }
    }
    // Claim: remove from the ready cache and take sole ownership of teardown
    // BEFORE anything can run, so an expiry callback can no longer release it.
    rec.state = 'claimed'
    delete this._preloads[key]
    if (rec.expiryTimer) { clearTimeout(rec.expiryTimer); rec.expiryTimer = null }
    const result = createShowSettlement(rec.ctx)
    this._activate(rec.ctx)
    return { started: true, attemptId, requestId: rec.requestId, result }
  }

  /** Tear down a preloaded (never shown) ad and hand its reservation back. */
  _discardPreload(key, reason) {
    const rec = this._preloads && this._preloads[key]
    if (!rec || rec.state === 'claimed') return
    delete this._preloads[key]
    if (rec.expiryTimer) { clearTimeout(rec.expiryTimer); rec.expiryTimer = null }
    if (rec.ctx) {
      rec.ctx.completed = true // a hidden ad never emits a terminal: the game never saw it
      if (rec.ctx.overlay) rec.ctx.overlay.remove()
    }
    // Only the discarded preload's own listeners. This used to remove whatever
    // playable handler happened to be on the instance, which could belong to a
    // different, still-live preload.
    const teardown = rec.ctx && showTeardown.get(rec.ctx)
    if (teardown) {
      if (teardown.playableMsg) { window.removeEventListener('message', teardown.playableMsg); teardown.playableMsg = null }
      if (teardown.visHandler) {
        if (typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', teardown.visHandler)
        teardown.visHandler = null
      }
      // The page-lifecycle listeners of the click suspension. They live on
      // `window` and `document`, not on the overlay, so detaching the ad does
      // not take them with it: a show that left its `pageshow` handler behind
      // would hold this entire context alive and could try to resume an ad that
      // is already gone.
      if (teardown.lifecycle) {
        for (const [target, type, handler] of teardown.lifecycle) {
          try { target.removeEventListener(type, handler, true) } catch { /* already detached */ }
        }
        teardown.lifecycle.length = 0
      }
      teardown.suspendForClick = null
      teardown.resumeFromClick = null
      teardown.rewardSnapshot = null
      if (teardown.abortCreative) { teardown.abortCreative(); teardown.abortCreative = null }
      // Same reason as `_finish`: a detached <video> keeps its media resource,
      // and a discarded preload that had started buffering kept holding it.
      if (teardown.stopMedia) {
        try { teardown.stopMedia() } catch { /* nothing left to stop */ }
        teardown.stopMedia = null
      }
      // A discarded preload leaves its countdown and billing timers behind
      // otherwise, and they fire against an overlay that is no longer attached.
      if (teardown.timers) {
        for (const t of teardown.timers) { clearTimeout(t); clearInterval(t) }
        const mine = new Set(teardown.timers)
        this._timers = this._timers.filter((t) => !mine.has(t))
        teardown.timers.length = 0
      }
    }
    rec.state = 'released'
    rec.reason = reason
    this._release(rec.requestId, rec.resp)
  }

  /**
   * Give a reservation back. Best-effort and fire-and-forget: the server sweeps
   * on TTL anyway, this just returns the budget sooner. The release capability
   * comes from the server with the bid - a bare requestId would let anyone who
   * saw an id (logs, reporting, the dashboard) cancel someone else's ad.
   */
  _release(requestId, resp) {
    const token = resp && resp.releaseToken
    if (!token || !requestId || typeof fetch !== 'function') return
    try {
      fetch(this.cfg.backend + '/v1/release', {
        method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ requestId, releaseToken: token }),
      }).catch(() => {})
    } catch (e) { /* releasing is an optimisation, never a failure path */ }
  }

  /**
   * Build the ad. With `opts.hidden` the overlay is attached to the DOM but kept
   * `display:none`, the creative loads, and NOTHING user-visible happens until
   * `_activate(ctx)`. That is what makes P0-03 possible: the bytes are already
   * decoded when the game finally calls show, so the player never waits.
   *
   * Why the overlay is ATTACHED while hidden instead of built detached: removing
   * an <iframe> from the document destroys its browsing context, so a detached
   * playable would re-navigate (and re-run) the moment it was inserted. Same
   * reason we never reparent it later - we only flip `display`.
   *
   * opts.onLoaded(reason?) fires once the creative is genuinely usable;
   * opts.onLoadError(reason) fires once if it can never be shown.
   */
  _render(ctx, resp, opts = {}) {
    const hidden = !!opts.hidden
    // Carry the auction's own verdict onto ctx so every ad_state event states
    // WHICH campaign matched and at WHICH tier. The server decides this and the
    // SDK was simply dropping it, which left the host unable to tell an
    // exact-subgenre match from a run-of-network fill - the exact distinction
    // the three tiers exist to express.
    const win = resp && resp.decision && resp.decision.win
    if (win) {
      ctx.campaignId = win.campaignId
      ctx.tier = win.tier
      ctx.priceCpm = win.priceCpm
      // The server sends this and the DTO publishes it, but nothing copied it,
      // so every terminal event omitted whether the fill was a targeted match or
      // a run-of-network filler - the one field that says WHAT was bought.
      if (typeof win.matched === 'boolean') ctx.matched = win.matched
    }
    const onLoaded = opts.onLoaded || (() => {})
    const onLoadError = opts.onLoadError || (() => {})
    let settledLoad = false
    // Success only, unlike `settledLoad`, which a failure also sets. The dwell
    // reward is gated on this: it used to pay out on a timer that started at
    // activation, so an ad whose creative never arrived - and which the SDK
    // itself went on to report as failed - still paid the player in full.
    let creativeRendered = false
    const loaded = () => { if (!settledLoad) { settledLoad = true; creativeRendered = true; onLoaded() } }
    const loadFailed = (reason) => {
      if (settledLoad) return
      settledLoad = true
      // While hidden this is a PRELOAD failure: report it and let the caller
      // decide (it will pass back). Only once visible does it become a terminal
      // for this show - a visible ad can never be handed to another provider.
      if (hidden) onLoadError(reason)
      else this._finish(ctx, { state: 'failed', reason })
    }
    // Deferred until the ad is actually on screen. Billing timers, video
    // playback and watchdogs must not run against an invisible ad: that would
    // charge for an impression nobody could see and expire a preloaded ad.
    ctx._onActivate = []
    const whenActive = (fn) => { if (ctx.visible) fn(); else ctx._onActivate.push(fn) }
    if (!hidden) {
      ctx.paused = true
      this._emit('w2a_pause', { ...ctx, state: 'opened' })
      if (ctx.completed || this.active !== ctx) {
        this._release(ctx.requestId, resp)
        return
      }
    }
    injectLayoutCss(document)
    const backdrop = el('div', null, { className: 'w2a-backdrop' })
    // The layout is driven by attributes, not by branching JS, so a rotation or a
    // phase change re-resolves the same rules with no listener. `fit=auto` means
    // "full-bleed where it is safe": the CSS only honours it when the creative is
    // marked crop-safe AND the ratio mismatch is small enough that at least 80%
    // of the source stays on screen.
    backdrop.setAttribute('data-open', 'true')
    backdrop.setAttribute('data-phase', 'video')
    backdrop.setAttribute('data-fit', this.cfg.creativeFit || 'auto')
    // These creatives are the advertiser's own cuts in four ratios and the
    // publisher asked for full-bleed, so cropping them is an authorised choice
    // rather than something we do to any asset that happens to arrive.
    backdrop.setAttribute('data-crop-safe', this.cfg.cropSafe === false ? 'false' : 'true')
    if (this.cfg.debugOverlay === true) backdrop.setAttribute('data-debug', 'true')
    // The stage is what re-flows on rotation: column in portrait, row in
    // landscape. The backdrop stays a plain full-screen centring box so that
    // `display:flex` (set when a preloaded ad is revealed) keeps working.
    const stage = el('div', null, { className: 'w2a-stage' })
    const cardWrap = el('div', null, { className: 'w2a-cardwrap' })
    const c = resp.creative
    // Declared HERE, before any DOM is built, because the end-card icon needs it
    // while the panel is assembled. It used to sit below the creative branches,
    // so the first thing to reference it from higher up threw a TDZ error - and
    // the SDK reported that honestly as `creative_error`, i.e. a broken creative,
    // which is exactly the wrong place to go looking.
    const src = (u) => new URL(u, this.cfg.backend || location.origin).href
    const card = el('div', null, { className: 'w2a-card' })
    const side = el('div', null, { className: 'w2a-side' })
    // card наполняется по формату НИЖЕ (после определения activateCTA/qualify)
    const title = el('div', null, { className: 'w2a-headline', textContent: c.headline || 'Toon Blocks' })
    // No negative margin: the stage owns the spacing now, and a -8px pull that
    // was tuned against an 18px gap collapses the two lines into each other.
    const sub = el('div', null, { className: 'w2a-subtitle', textContent: c.sub || 'Block puzzle · Free' })

    // The CTA is live from the first frame. This is a deliberate product choice:
    // a player who wants the advertised game should never be told to wait. The
    // trade-off is real and is NOT hidden - see `ctaGatedByImpression` below.
    const cta = el('a', null, { className: 'w2a-cta', textContent: 'Install' })
    cta.setAttribute('data-w2a', 'cta')
    // Sandboxed portals commonly allow popups but forbid navigation of their
    // own top-level page. A top-level game keeps the existing same-tab route.
    cta.target = isFramed() ? '_blank' : '_top'
    if (cta.target === '_blank') cta.rel = 'noopener'
    // Can this document still be here after the player taps Install?
    //
    // `_blank` opens a separate browsing context and leaves us running, so the
    // ad can genuinely wait behind the store page. `_top` replaces us, and no
    // amount of lifecycle listening changes that - the suspension machinery is
    // simply not applicable there.
    //
    // A native host is the third case and it has to SAY so. An Android wrapper
    // that intercepts the store URL and opens it with its own Intent keeps the
    // WebView alive, but nothing observable from inside the page distinguishes
    // that from an ordinary navigation. It is not guessable: `window.open` is
    // no probe either, because a WebView with multiple windows disabled can
    // return an object and then silently drop the request. So the host declares
    // it, and pairs the declaration with `resumeActive(requestId)` from its own
    // `onResume` - which is the only reliable return signal in that embedding
    // anyway, since such a WebView often never marks its document hidden.
    const clickPreservesDocument = () =>
      cta.target === '_blank' || this.cfg.clickPreservesDocument === true

    // rewarded: кнопка награды/закрытия появляется после просмотра
    const rewardBtn = el('button', {
      background: 'transparent', border: '1px solid #4b5163', color: '#c7ccdd',
      padding: '10px 18px', borderRadius: '10px', fontSize: '14px', marginTop: '4px',
      cursor: 'pointer', display: ctx.format === 'rewarded' ? 'block' : 'none',
    }, { textContent: ctx.format === 'rewarded' ? 'Watch to earn reward' : '' })
    rewardBtn.setAttribute('data-w2a', 'reward')

    // The reward gate lives in this closure, not on `ctx`.
    //
    // It used to be assigned as `ctx._maybeReward`, and `ctx` is spread into
    // every publisher event: `this._state({ ...ctx, state })`. Assignment makes
    // an enumerable own property, so the spread copied it, and the function was
    // handed to whoever the publisher registered as a listener - along with
    // whatever else happened to be on the context. It also means the event is no
    // longer structured-cloneable, so an integration that forwards events across
    // a postMessage boundary or through structuredClone fails on an object it
    // never asked for.
    //
    // A closure is not a stricter version of the same thing: it removes the
    // capability rather than hiding it. Marking the property non-enumerable
    // would stop the spread and still leave a callable reward trigger on an
    // object handed to publisher code.
    let rewardEarned = false
    const paintEarned = () => {
      // Not "Claim reward": the reward has ALREADY been emitted by the time this
      // paints, and the button only closes the ad. A player who never presses it
      // still keeps the currency, and a label that says otherwise is a lie the
      // publisher's support inbox pays for.
      rewardBtn.textContent = 'Reward earned - close'
      // Revealed here rather than left to its constructor state: on a rewarded
      // VIDEO the button is hidden for the whole roll, because the locked close
      // slot is already saying "watch N seconds" and one screen does not need
      // that sentence twice. Earning the reward is the point at which it has
      // something else to say, so that is where it comes back.
      rewardBtn.style.display = 'block'
      rewardBtn.style.borderColor = '#4ade80'
      rewardBtn.style.color = '#4ade80'
      rewardBtn.onclick = () => this._finish(ctx, { state: 'closed' })
    }
    // Measured evidence for the video gate; unused by the dwell formats, which
    // have no media clock to measure.
    const evidence = createRewardEvidence()
    if (ctx.format === 'rewarded') ctx.rewardEarned = false
    const grantReward = (report) => {
      if (ctx.format !== 'rewarded' || rewardEarned || ctx.completed) return
      rewardEarned = true
      Object.assign(ctx, report, { rewardEarned: latchShowReward(ctx) })
      paintEarned()
      // EARNING IT IS ALSO AN EXIT. The close control on a rewarded video is
      // gated on the end card, and the end card is the end of the FILM - which
      // on a 60-second master with a 30-second gate is half a minute after the
      // player has already earned everything the ad can give them. Holding them
      // there is not a reward gate, it is a hostage situation. The gate exists
      // so nobody skips out BEFORE earning; once earned, it has done its job.
      if (closeGatedOnEndcard) unlockClose()
      this._state({ ...ctx, state: 'rewarded' })   // emitted ONLY here
    }
    // Set on every terminal path, earned or not, so "no reward" is reportable
    // rather than merely absent.
    const recordVideoEvidence = (v) => {
      // An interstitial has no reward to evidence. Publishing these on one
      // contradicted both the types and the SDK's own test - which passed only
      // because it happened to use an image creative, where the video path that
      // writes them never runs.
      if (ctx.format !== 'rewarded') return
      ctx.rewardEndedSeen = v.endedSeen
      ctx.rewardDurationMs = v.durationMs
      ctx.rewardCoverageRatio = v.coverageRatio
      ctx.rewardAttentionRatio = v.attentionRatio
      ctx.rewardSeeks = v.seeks
      ctx.rewardRejectedJumps = v.rejectedJumps
      ctx.rewardMaxRate = v.maxRate
    }

    // Close is the opposite of the CTA: it is withheld for a fixed few seconds so
    // the ad gets a real look, and the wait is SHOWN as a countdown instead of
    // just being absent. A player staring at a corner where a × is supposed to
    // be, with nothing there, assumes the ad is broken and kills the tab.
    const closeAfterSecs = Math.max(0, Number(this.cfg.closeAfterSecs ?? 5))
    // Position, size and safe-area offsets live in the stylesheet now. Inline
    // styles beat a stylesheet rule, so setting them here would silently pin the
    // control to the old 44px geometry and the CSS would look like it did nothing.
    // Only per-state values stay inline.
    const close = el('button', {
      // The countdown is not a button yet: taps must not land on it, or a fast
      // double-tap on the ad would close it before it was ever seen.
      pointerEvents: 'none', cursor: 'default', color: '#bbb',
    }, { textContent: closeAfterSecs > 0 ? String(closeAfterSecs) : '×' })
    // Stable hooks: integrators and tests must not have to find our controls by
    // tag order or by which one happens to be visible.
    close.setAttribute('data-w2a', 'close')

    // Sound control. Top-LEFT deliberately: the close button owns the top right,
    // and a thumb reaching for × must never find "unmute" under it. Hidden until
    // we actually end up muted - a control that does nothing is worse than no
    // control, because the player presses it and concludes the ad is broken.
    // Geometry from the stylesheet, same reason as the close control. Only the
    // hidden/shown state is inline, because that is what changes at runtime.
    //
    // THIS ONLY EVER TURNS SOUND ON. There is no mute control in this SDK and
    // there must not be one: ad audio is mandatory. It used to render as '🔇',
    // and the first partner to see it filed it as a mute button that should be
    // removed - which would have left every policy-muted ad silent forever, the
    // exact opposite of the requirement. A word says what a glyph could not.
    const soundBtn = el('button', { display: 'none' }, { textContent: 'Tap for sound' })
    soundBtn.setAttribute('data-w2a', 'sound')
    soundBtn.setAttribute('aria-label', 'Turn sound on')

    // The request id, format and placement are OUR debugging aids. They were
    // rendered into every ad, which means a partner evaluating the product read
    // "req 3fbe9b7c-d49 · interstitial · manual" underneath the creative. No ad
    // network shows that to anyone; it reads as an unfinished build. Kept behind
    // a flag because it is genuinely useful when someone photographs a broken ad
    // and we need to find that exact request in the log.
    const showMeta = this.cfg.debugOverlay === true
    const meta = el('div', { color: '#565c72', fontSize: '11px', wordBreak: 'break-all', maxWidth: '90vw', textAlign: 'center',
      display: showMeta ? 'block' : 'none' },
      { className: 'w2a-meta', textContent: `req ${ctx.requestId.slice(0, 12)} · ${ctx.format} · ${ctx.placement}` })

    cardWrap.appendChild(card)
    // Store listing on the end card - icon, rating, downloads - from the ad
    // response, never fetched from the store by this device. Every part is
    // OPTIONAL and hidden when absent: a campaign without a listing must render
    // exactly as before rather than showing an empty icon box or a bare star.
    const app = resp.app || {}
    const icon = el('img', null, { className: 'w2a-app-icon', alt: '' })
    icon.hidden = true
    if (app.iconUrl) {
      icon.src = src(app.iconUrl)
      icon.hidden = false
      // Fetched at the FRONT of the queue and rendered from the first frame in
      // the bar, not first revealed on the end card. Hidden behind
      // `display:none` for the whole video it had no reason to be decoded early,
      // and the end card opened onto an icon that had not painted yet - which is
      // the other half of the grey-square report, alongside the `hidden` bug the
      // stylesheet now fixes.
      icon.fetchPriority = 'high'
      icon.decoding = 'async'
      // A broken icon must not leave a hole where a logo should be.
      icon.addEventListener('error', () => { icon.hidden = true }, { once: true })
    }
    if (app.name) title.textContent = app.name
    if (app.shortDescription) sub.textContent = app.shortDescription

    const facts = el('div', null, { className: 'w2a-store-facts' })
    // `stale` is set by the server when the listing is older than its freshness
    // window, and then rating/downloads/price are simply absent. Showing last
    // quarter's rating as current is worse than showing none.
    for (const f of [app.rating && app.rating.display, app.price && app.price.display,
                     app.downloads && app.downloads.display].filter(Boolean)) {
      facts.appendChild(el('span', null, { textContent: String(f) }))
    }
    facts.hidden = facts.children.length === 0

    const storeName = el('div', null, { className: 'w2a-store-name', textContent: app.storeName || '' })
    storeName.hidden = !app.storeName

    // The four listing lines travel together, so the panel can be a ROW (icon |
    // listing | pill) during playback and a COLUMN on the end card without the
    // lines ever becoming four independent flex items that wrap on their own.
    const listing = el('div', null, { className: 'w2a-listing' })
    listing.append(title, sub, facts, storeName)
    side.append(icon, listing, cta, rewardBtn, meta)
    stage.append(cardWrap, side)
    // `close` and `soundBtn` stay direct children of the backdrop: they are
    // pinned to screen corners, so they must not travel when the stage switches
    // between column and row on rotation.
    // Say that this is an ad. It was not labelled at all, which is the one item
    // of the partner's list that is a disclosure question rather than a taste
    // question: paid content has to be distinguishable from the publisher's own.
    // The exact wording, size and placement are our product rule - no current
    // spec mandates one for a full-screen VAST interstitial - but the absence of
    // any label is indefensible either way.
    const adLabel = el('div', null, { className: 'w2a-ad-label', textContent: 'Advertisement' })
    adLabel.setAttribute('data-w2a', 'ad-label')
    backdrop.append(adLabel, close, soundBtn, stage)
    if (hidden) backdrop.style.display = 'none'
    document.body.appendChild(backdrop)
    // Overlay ownership is per-show (ctx), not per-instance. A late teardown from
    // an OLDER show used to null out `this.overlay` and remove the overlay of the
    // ad that had already replaced it.
    ctx.overlay = backdrop
    if (!hidden) {
      this.overlay = backdrop
      // LOOM_VISIBLE boundary: past this point the player has seen our ad, so no
      // failure may hand the slot to a fallback provider (that would show two ads).
      ctx.visible = true
      // The direct path needs this too, and not only for symmetry with _activate:
      // without it `ctx.fullscreen` is never set at all on the path that most
      // integrations actually take, so every event reports the screen coverage as
      // unknown rather than as achieved or refused. It will usually report
      // `no_activation` here - `_show` awaits the ad request first, so the tap
      // that started it may no longer be spendable - and that is a true answer,
      // not a missing one.
      this._enterFullscreen(ctx)
      this._state({ ...ctx, state: 'opened' })
      // A publisher can cancel synchronously from the public `opened` event.
      // Stop before installing teardown state on a detached, completed show.
      if (ctx.completed || this.active !== ctx) {
        this._release(ctx.requestId, resp)
        return
      }
    }

    // Qualified impression is independent from reward and VAST completion.
    // Image and playable count visible time after load; VAST counts billableMs
    // of credible advancing playback.
    // shownMs must measure how long the player saw the ad, not how long ago we
    // preloaded it. Stamped at activation for that reason.
    ctx.impStart = ctx.impStart || Date.now()

    // The CTA is available from the first rendered frame. clickState still
    // enforces genuine-input and one-shot semantics without a time gate.
    let clickState = 'BLOCKED'      // BLOCKED -> READY -> CLICKED (one-shot)
    // The show is standing behind a store page the player walked off to. It is
    // not hidden in the browser sense - in a webview the document is often never
    // marked hidden at all - so it gets its own flag, and every clock in this
    // render reads it through `isHidden()` below.
    let clickSuspended = false
    // Impression reporting lives on ctx, so EVERY terminal event carries it and
    // not just the CTA click: a host that closes with the X still has to
    // reconcile its impression count with ours, and that path used to report
    // `undefined` - indistinguishable from "the ad never rendered".
    //
    // Deliberately NOT seeded here. The field is absent until the beacon is
    // actually sent, so the four cases stay distinguishable:
    //   absent      - no impression was ever attempted (no_fill, or a creative
    //                 that failed before it qualified)
    //   'pending'   - beacon in flight, verdict not yet known
    //   'confirmed' - the server committed it
    //   'degraded'  - attempted, but the server did not commit it
    // `impressionConfirmed` (boolean) is the back-compat view and appears only
    // once the state has settled.
    let qualified = false
    // count only foreground-visible time; a backgrounded tab earns no dwell
    let visAccum = 0
    // requireVisible=true (default) counts ONLY foreground-visible time. Some
    // embedded webviews report document.hidden incorrectly, so a dwell-format
    // integrator can opt out. Record that fact on the terminal event instead of
    // pretending visibility was verified.
    const requireVisible = this.cfg.requireVisible !== false
    const isVideoCreative = c.type === 'vast' && !!c.vastUrl
    // A host may opt dwell formats out when its webview misreports visibility.
    // Video cannot opt out: hidden advancing media is the reward and billing
    // currency, so its foreground clocks must stop with the tab.
    //
    // A CLICK-SUSPENDED show is hidden unconditionally, and the opt-out does not
    // reach it. `requireVisible: false` exists for a webview that lies about
    // `document.hidden`; it is not a licence to run the dwell clock while the
    // player is demonstrably in the Play Store. Putting the suspension first
    // here is what stops every deadline, the reward floor and the impression
    // clock in one place instead of at each of their call sites.
    const isHidden = () => clickSuspended || ((requireVisible || isVideoCreative) &&
      typeof document !== 'undefined' && document.hidden === true)
    // Reported on EVERY exit, not only on a click-out. It used to be attached in
    // the CTA handler alone, so an ad closed with the × reported nothing and a
    // partner could not tell an unverified-dwell show from a verified one unless
    // the player happened to tap Install.
    ctx.visibilityEnforced = requireVisible || isVideoCreative
    // The same opt-out weakens dwell-format rewards and is therefore reported.
    // Video is different: advancing media is the reward currency, so hidden-tab
    // playback is excluded unconditionally inside the VAST branch below.
    if (ctx.format === 'rewarded') {
      // Video has an unconditional hidden-tab exclusion because its advancing
      // media clock is the reward currency. The opt-out remains available only
      // to dwell formats whose host webview misreports document.hidden.
      ctx.rewardVisibilityEnforced = isVideoCreative ? true : requireVisible
    }
    // null (not 0) means "currently hidden": now() can legitimately BE 0 at the
    // start of a session, and a falsy check would freeze the dwell at zero.
    // A PRELOADED overlay is in the DOM but invisible, so its billing and reward
    // clocks must not start until the ad is actually shown.
    let visSince = (hidden || isHidden()) ? null : now()
    ctx._startVisible = () => { if (visSince === null && !isHidden()) visSince = now() }
    const visibleMs = () => visAccum + (visSince !== null ? now() - visSince : 0)
    /**
     * Run `fn` once the ad has been ON SCREEN for `ms`, not once `ms` of wall
     * clock has passed since it was built.
     *
     * Every deadline in a show used to be a plain `setTimeout` inside
     * `whenActive`, and `whenActive` only asks whether the GAME has shown the
     * ad - never whether the player can see it. So an ad rendered into a
     * backgrounded tab billed its impression on schedule, and its watchdogs
     * expired on schedule, for an ad nobody had looked at. The ad request itself
     * takes up to `requestTimeoutMs`, so an interruption during it was enough.
     *
     * Polling rather than arithmetic because the clock can stop and start any
     * number of times; the poll only ever DELAYS a deadline, which is the safe
     * direction for both a billing event and a watchdog.
     */
    const visibleDeadlines = []
    const afterVisibleMs = (ms, fn) => whenActive(() => {
      let fired = false
      let timer = null
      // Exact rather than polled: arm a timer for the time still owed, and
      // re-arm it whenever the clock stops or starts. Polling would add its own
      // interval to every deadline - which matters, because `billableMs` can be
      // a few milliseconds and a poll would quietly turn that into its period.
      let lastLeft = Infinity
      const arm = () => {
        if (fired || ctx.completed) return
        if (timer) { dropTimer(timer); timer = null }
        const left = ms - visibleMs()
        if (left <= 0) { fired = true; fn(); return }
        if (visSince === null) { lastLeft = Infinity; return }  // off screen: the clock is stopped
        // A timeout that fired without the visible clock moving, while the ad was
        // on screen the whole time, means real time passed and the clock simply
        // is not reporting it. Re-arming on the same value would spin: honour the
        // wait instead. Without this the deadline re-armed itself hundreds of
        // times a second against any stalled clock.
        if (left >= lastLeft) { fired = true; fn(); return }
        lastLeft = left
        timer = pushTimer(setTimeout(() => { timer = null; arm() }, left))
      }
      visibleDeadlines.push(arm)
      arm()
    })
    // Assigned by the media branch below. Called BEFORE the visibility state is
    // updated, deliberately: the media has to close its current segment while
    // the ad is still counted as on screen, or the last sample before a hide is
    // thrown away and an honest player loses it.
    let onVisibilityChange = null
    const teardown = {
      visHandler: null, playableMsg: null, rewardSnapshot: null, timers: [],
      // Every listener this show puts on `window` or `document` beyond the
      // visibility one, as [target, type, handler]. They come off together in
      // `_finish`; a show that leaves a `pageshow` handler behind holds its whole
      // context alive and can resume an ad that no longer exists.
      lifecycle: [],
    }
    showTeardown.set(ctx, teardown)
    // Hand the budget back if this show ends without ever billing. Only an
    // UNCLAIMED preload released its reservation; the moment a show started -
    // preloaded or not - the reservation was pinned until the server's own sweep
    // reclaimed it a minute later. A show that ends before it qualifies
    // (`closeAfterSecs` shorter than `billableMs`, a creative that never played,
    // a player who leaves immediately) therefore held campaign budget it never
    // spent, and a campaign near its daily cap answered the next request with a
    // no-fill it should have filled.
    //
    // The `qualified` guard is not optional. `qualify()` posts the impression
    // with keepalive and settles asynchronously, and the CTA path calls
    // `_finish` immediately afterwards - so an unconditional release here would
    // void an in-flight commit and lose the billing on a CLICKED ad, which is
    // strictly worse than the leak it set out to fix.
    teardown.releaseUnbilled = () => { if (!qualified) this._release(ctx.requestId, resp) }
    // Every timer this show creates, registered against THIS show as well as on
    // the instance. `_finish` used to clear the instance-wide list wholesale, so
    // finishing one ad cancelled the close countdown of a coexisting PRELOADED
    // ad - which then opened with a × that could never arm. The instance list
    // stays as a backstop for teardown paths that have no ctx to hand.
    const pushTimer = (t) => { teardown.timers.push(t); this._timers.push(t); return t }
    // A deadline that re-arms replaces its handle rather than stacking a new one:
    // otherwise the registries grow for the whole life of the show and teardown
    // walks a list that is mostly dead handles.
    const dropTimer = (t) => {
      clearTimeout(t); clearInterval(t)
      let i = teardown.timers.indexOf(t)
      if (i >= 0) teardown.timers.splice(i, 1)
      i = this._timers.indexOf(t)
      if (i >= 0) this._timers.splice(i, 1)
    }
    const visHandler = () => {
      if (onVisibilityChange) { try { onVisibilityChange() } catch { /* media state is not worth losing the CTA over */ } }
      if (isHidden()) { if (visSince !== null) { visAccum += now() - visSince; visSince = null } }
      // `ctx.visible` is the ACTIVATION flag, and checking it here is the whole
      // fix: without it, hiding and restoring the tab started the dwell clock of
      // an ad that was still a preloaded, invisible overlay. By the time the game
      // called show(), visibleMs() already exceeded rewardSecs and the first poll
      // paid out for an ad nobody had seen. One background glance was enough.
      else if (ctx.visible && visSince === null) visSince = now()
      // Every deadline measured in foreground time has to be re-armed: the clock
      // it is waiting on just stopped or started.
      for (const arm of visibleDeadlines) { try { arm() } catch { /* one deadline must not take the rest */ } }
    }
    // ---- click-out suspension -------------------------------------------
    //
    // A tap on Install used to END the show: `_finish` ran synchronously inside
    // the click handler, so the player came back from the store to no ad at all.
    // That made Install a skip button - the partner's words: "иначе ее так
    // сбрасывать будут, чтобы получить ревард, или пропустить интерстишл" - and
    // it also put the whole teardown, `document.exitFullscreen()` included, in
    // front of the navigation the player was waiting for.
    //
    // Now the show SUSPENDS. It keeps the overlay, the media element, the
    // `active` slot and its evidence, stops every clock through `isHidden()`,
    // and waits for the player. What it must never do is wait forever: it owns
    // the `active` slot, and a game whose next ad is refused as `busy` because
    // somebody wandered off is worse than a lost impression.
    let clickDeadlineAt = null
    let clickTimer = null
    const clearClickTimer = () => {
      if (clickTimer === null) return
      dropTimer(clickTimer)
      clickTimer = null
    }
    // Guards the re-arm below against a clock that does not move. Same hazard,
    // and the same remedy, as the visible-time deadlines above: a timeout that
    // fires without its clock having advanced would re-arm on the identical
    // value and spin at whatever rate the event loop allows.
    let clickLastLeft = Infinity
    const armClickTimer = () => {
      clearClickTimer()
      // Re-armed rather than trusted once. A frozen or bfcached page runs no
      // timers at all, so a single `setTimeout` can come back late by any amount
      // - the deadline is the authority and the timer is only what wakes us to
      // read it.
      const left = Math.max(0, clickDeadlineAt - now())
      const handle = setTimeout(() => {
        if (clickTimer !== handle) return
        clickTimer = null
        if (!clickSuspended || ctx.completed) return
        const stillOwed = clickDeadlineAt - now()
        // Real time passed and the clock is not reporting it: honour the wait
        // rather than spin on it.
        if (stillOwed > 0 && stillOwed < clickLastLeft) { clickLastLeft = stillOwed; armClickTimer(); return }
        this._finish(ctx, { state: 'failed', reason: 'click_return_timeout', clicked: true })
      }, left)
      clickLastLeft = left
      clickTimer = pushTimer(handle)
    }
    /**
     * The player is back. `hostConfirmed` is a native host telling us so from
     * its own Activity lifecycle; everything else has to prove it through the
     * document, because `focus` and `pageshow` both fire in cases where the page
     * is still not on screen.
     */
    const resumeFromClick = (hostConfirmed) => {
      if (!clickSuspended || ctx.completed) return false
      if (!hostConfirmed && typeof document !== 'undefined' && document.hidden === true) return false
      if (now() >= clickDeadlineAt) {
        this._finish(ctx, { state: 'failed', reason: 'click_return_timeout', clicked: true })
        return false
      }
      clearClickTimer()
      clickSuspended = false
      if (teardown.resumeVideoDeadline) teardown.resumeVideoDeadline()
      visHandler()   // restarts the visible clock and re-arms every deadline
      // `visHandler` resumes media from inside its visibility callback, before
      // the visible clock is restarted below it. Chrome may emit `playing`
      // synchronously in that window, so the ordinary listener sees the ad as
      // still hidden and cannot establish the next evidence anchor. Seed the
      // new epoch after the foreground clock is live; this credits no time by
      // itself and preserves the break across the store visit.
      if (teardown.resumeVideoEvidence) teardown.resumeVideoEvidence()
      // NOT `w2a_resume`. The ad is back on screen and the GAME must stay
      // paused; resume means "our ad is gone", and firing it here would un-pause
      // the game underneath an ad that is still running.
      this._emit('w2a_click', { ...ctx, state: 'opened', clicked: true, suspended: false, clickPhase: 'returned' })
      return true
    }
    const suspendForClick = () => {
      if (clickSuspended || ctx.completed) return false
      // ORDER IS LOAD-BEARING. The media epoch closes while the ad still counts
      // as on screen; raising the flag first would stamp that last sample as
      // not-visible and throw away the stretch the player actually watched
      // between the previous `timeupdate` and the tap. This runs BEFORE the
      // flag for the same reason it may legitimately grant a reward here: the
      // seconds it credits were watched, and suspension is not allowed to take
      // back something that was earned before it started.
      if (teardown.creditVideoTail) teardown.creditVideoTail()
      // RE-CHECK, because the line above can finish the show. Crediting the tail
      // may cross the reward gate, and `grantReward` emits `rewarded` to
      // publisher listeners SYNCHRONOUSLY - a host that closes its ad from
      // inside that callback runs `_finish` to completion before control gets
      // back here. `_finish` guards against exactly this re-entry for its own
      // callers (see its comment); this path needed the same guard and did not
      // have it, so a finished show was re-flagged as suspended and the host was
      // told the ad was back on screen moments after being told it was gone.
      if (ctx.completed) return false
      clickSuspended = true
      ctx.clicked = true
      const wanted = Number(this.cfg.clickReturnTimeoutMs)
      const ceiling = Number.isFinite(wanted) && wanted >= 0 ? wanted : MAX_CLICK_SUSPEND_MS
      // The server's reservation lease is deliberately NOT used as a second
      // bound. `resp.reservationExpiresAt` is stamped from the SERVER clock and
      // this is the client's; subtracting one from the other silently encodes
      // whatever skew exists between them, which is exactly the kind of bug that
      // only shows up on somebody else's device. The ceiling already equals the
      // server's RESERVATION_TTL, and the server sweeps its own expired
      // reservations - it does not need us to predict when.
      clickDeadlineAt = now() + Math.min(MAX_CLICK_SUSPEND_MS, ceiling)
      if (teardown.pauseVideoDeadline) teardown.pauseVideoDeadline()
      // Close the media epoch BEFORE the clocks stop, so the last stretch the
      // player actually watched is credited rather than dropped. This settles
      // evidence for REPORTING only - it cannot grant, because every grant path
      // is guarded on `clickSuspended`, which is already true here.
      visHandler()
      armClickTimer()
      return true
    }
    teardown.suspendForClick = suspendForClick
    // A native host's word is authoritative: an Android WebView commonly never
    // marks its document hidden, so the document check would refuse a real
    // return.
    teardown.resumeFromClick = () => resumeFromClick(true)

    const visibilityHandler = () => {
      if (clickSuspended && typeof document !== 'undefined' && document.hidden !== true) {
        resumeFromClick(false)
        return
      }
      visHandler()
    }
    teardown.visHandler = visibilityHandler
    if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', visibilityHandler)

    // The rest of the page-lifecycle surface. `visibilitychange` alone misses a
    // back-forward-cache restore and Chromium's frozen-page `resume`.
    //
    // `focus` IS NOT HERE, and that is deliberate. It was, and it was wrong three
    // times over. A window gains focus in plenty of situations that are not a
    // return from the store, and the `document.hidden !== true` guard that was
    // supposed to catch those is vacuous in an Android WebView - the one host
    // this whole feature exists for - because such a webview never marks its
    // document hidden at all. So a stray focus ended the suspension, restarted
    // every clock while the player was still in the Play Store, and cleared the
    // ceiling permanently: Install became a way to bank reward time, which is the
    // exact exploit this change was written to close. Worse, routing focus
    // through `visHandler` broke the video evidence epoch on EVERY occurrence,
    // so an ordinary alt-tab during an honest full watch could leave the player
    // short of the ratio gate and earning nothing. A webview that needs to
    // announce a return has `resumeActive(requestId)`, which is explicit and
    // correlated instead of ambient and guessed.
    const listenLifecycle = (target, type, handler) => {
      if (!target || typeof target.addEventListener !== 'function') return
      target.addEventListener(type, handler, true)
      teardown.lifecycle.push([target, type, handler])
    }
    // Only ever acts on a SUSPENDED show. The old version fell through to
    // `visHandler()` for every event it saw, which made each of these listeners a
    // way to disturb the evidence of an ad that was playing perfectly normally.
    const returnHandler = () => { if (clickSuspended) resumeFromClick(false) }
    const pageHideHandler = (event) => {
      visHandler()
      // `persisted: false` means this document is going away for good: it is not
      // entering the back-forward cache and cannot come back, so this in-memory
      // show is over whatever else happens.
      //
      // This has to be a TERMINAL, not just a release. The click timeout is the
      // only other thing that ends a suspended show, and a terminated or
      // discarded document never runs another timer - so without this the show
      // ended with no terminal and no `w2a_resume` at all. In the ordinary case
      // the host document dies with us and nobody is left to notice; a host that
      // OUTLIVES this document - a native wrapper, a persistent parent frame -
      // would sit paused for ever waiting for a resume that had nowhere to come
      // from. `_finish` also performs the unbilled release on its own guarded
      // path, so nothing is leaked by routing through it.
      if (!clickSuspended || event.persisted === true || ctx.completed) return
      this._finish(ctx, { state: 'failed', reason: 'click_left_page', clicked: true })
    }
    listenLifecycle(typeof window !== 'undefined' ? window : null, 'pageshow', returnHandler)
    listenLifecycle(typeof document !== 'undefined' ? document : null, 'resume', returnHandler)
    listenLifecycle(typeof window !== 'undefined' ? window : null, 'pagehide', pageHideHandler)

    const armCTA = () => {
      if (clickState !== 'BLOCKED') return
      clickState = 'READY'
      cta.href = resp.clickUrl
      cta.style.pointerEvents = 'auto'
    }
    armCTA() // live from the first frame, not on a gate
    // The CTA is armed as soon as the ad exists. It is NOT gated on the
    // impression or on a dwell floor any more.
    //
    // What this costs, stated plainly: a click can now be reported for an ad
    // whose impression was never committed, so `clicks <= impressions` stops
    // being an invariant of the funnel, and the 1s anti-misclick floor that used
    // to absorb a stray tap is gone. Terminal events carry
    // `ctaGatedByImpression: false` so reporting can tell these clicks apart
    // instead of quietly mixing them with gated ones.
    //
    // Which is what the comment SAID, while nothing ever assigned the field. The
    // allowlist published it, the types declared it, and every terminal event
    // omitted it - so the one flag that warns a partner their clicks-per-
    // impression ratio is not an invariant was silently absent, and reporting
    // mixed these clicks in exactly as the comment promised it would not.
    ctx.ctaGatedByImpression = false
    // Reveal the close button on a visible countdown. Only foreground time
    // counts, for the same reason the old dwell floor did: an ad "shown" in a
    // background tab has not been shown.
    let closeArmed = false
    const unlockClose = () => {
      closeArmed = true
      close.textContent = '×'
      // Back to the disc. While the control was locked it rendered as a labelled
      // pill, and leaving that attribute on would give the × a pill's width.
      close.removeAttribute('data-state')
      close.style.pointerEvents = 'auto'
      close.style.cursor = 'pointer'
      close.style.color = '#ddd'
    }
    // A REWARDED VIDEO MAY NOT BE DISMISSIBLE MID-ROLL.
    //
    // `closeAfterSecs` is format-agnostic, so on a 30-second rewarded master the
    // × armed at five seconds and the player could wave the ad away a sixth of
    // the way in. The partner photographed exactly that. For rewarded video the
    // close control is gated on the creative PHASE - the end card - instead of
    // becoming an exit after a wall-clock delay.
    //
    // VIDEO ONLY, deliberately. An interstitial keeps its five-second escape: an
    // interstitial video nobody can dismiss until it ends is a trap for the
    // player and a policy problem for the publisher. The locked video slot is an
    // evidence countdown, not an exit countdown: it reaches zero only as the
    // same credible playback that earns the reward advances. A rewarded IMAGE
    // is its own end card from the first frame, so gating it the same way would
    // arm the × instantly - strictly worse than the timer it replaced.
    const closeGatedOnEndcard = ctx.format === 'rewarded' && isVideoCreative
    const wantedRewardMs = Number(this.cfg.videoRewardMs)
    const videoRewardGateMs = Number.isFinite(wantedRewardMs) && wantedRewardMs >= 0
      ? wantedRewardMs
      : 30000
    const paintVideoRewardCountdown = (advancingMs = 0) => {
      if (!closeGatedOnEndcard || closeArmed || rewardEarned) return
      const measured = Number(advancingMs)
      const credibleMs = Number.isFinite(measured) && measured > 0 ? measured : 0
      const seconds = Math.ceil(Math.max(0, videoRewardGateMs - credibleMs) / 1000)
      close.textContent = `Watch ${seconds}s`
    }
    if (closeGatedOnEndcard) {
      close.setAttribute('data-state', 'locked')
      paintVideoRewardCountdown()
      // Trap door, not a countdown. Every known way a video dies already calls
      // `_finish` - `vast_deadline`, `vast_stalled`, `vast_never_advanced` - but
      // a creative that buffers forever without tripping any of them would leave
      // the player sealed inside an ad with no exit at all. The ceiling is far
      // enough past the reward gate that a healthy show reaches its end card
      // first and this never fires.
      afterVisibleMs(videoRewardGateMs + 15000, unlockClose)
    } else if (closeAfterSecs <= 0) unlockClose()
    else {
      // Deferred until the ad is ACTIVATED, not merely rendered. The countdown
      // used to start the moment a preload was built, and its only visibility
      // test was `document.hidden` - which says nothing about whether this show
      // has been handed to the player. A preload that sat for its TTL therefore
      // opened already dismissible, and the advertiser paid for an ad the player
      // could wave away before seeing a frame.
      // Measured, not counted down. Decrementing once per tick and skipping the
      // tick when hidden LOOKS equivalent, but it samples visibility only at the
      // instant the tick fires: a player who flicks in and out around the tick
      // boundaries burns whole seconds of countdown for a fraction of that in
      // actual screen time. The unlock now reads the same foreground clock the
      // reward and the impression read.
      const closeAt = closeAfterSecs * 1000
      whenActive(() => {
        const paint = setInterval(() => {
          if (ctx.completed || closeArmed) { clearInterval(paint); return }
          const left = Math.ceil((closeAt - visibleMs()) / 1000)
          close.textContent = String(Math.max(1, left))
        }, 250)
        pushTimer(paint)
      })
      afterVisibleMs(closeAt, unlockClose)
    }

    const qualify = () => {
      // A creative can finish loading AFTER the ad was closed or failed. Without
      // this check that late signal still posted an impression and charged for an
      // ad nobody was looking at.
      if (qualified || ctx.completed) return
      qualified = true
      // Close is on its own countdown now and no longer waits for the impression:
      // the player's way out must not depend on our billing round-trip.
      // The beacon is now in flight and the player can already close: mark the
      // state PENDING rather than pre-seeding a verdict. Reporting `false` here
      // would call a still-unanswered impression "degraded" for the whole RTT.
      ctx.impressionState = 'pending'
      const ctrl = new AbortController()
      // NOT registered against the show. `_finish` clears the show's timers, and
      // this deadline is the only thing that ever ends a hung impression beacon
      // - cancelling it on close left the request in flight with nothing to
      // abort it, so `impressionState` stayed 'pending' forever.
      const to = setTimeout(() => ctrl.abort(), this.cfg.requestTimeoutMs)
      // A timeout/error is DEGRADED, not confirmed. We still let the ad be
      // clickable (so the player is not stuck), but we never claim the server
      // committed the impression when it did not.
      const settle = (ok) => {
        clearTimeout(to)
        ctx.impressionState = ok ? 'confirmed' : 'degraded'
        ctx.impressionConfirmed = ok
        // A player who taps Install before the beacon comes back closes the ad
        // with `impressionState: 'pending'`, and that was the last word a
        // publisher ever heard on it. Sending a second `ad_state` would fix the
        // reporting and break something worse - a terminal that arrives twice
        // makes every host's fallback and resume logic run twice. So the verdict
        // arrives on its own event, and the show terminal stays terminal.
        this._emit('w2a_impression', {
          requestId: ctx.requestId,
          format: ctx.format,
          placement: ctx.placement,
          state: ctx.state || 'closed',
          impressionState: ctx.impressionState,
          impressionConfirmed: ok,
        })
      }
      fetch(this.cfg.backend + '/v1/impression', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        // A CTA tap navigates the top-level document, which can tear this page
        // down mid-flight. Without keepalive the browser cancels the request and
        // the advertiser is never billed for an ad that was seen AND clicked -
        // the most valuable impression there is.
        keepalive: true,
        body: JSON.stringify({
          requestId: ctx.requestId, impressionToken: resp.impressionToken, shownMs: Math.round(visibleMs()),
          freqKey: this.sessionId,
        }),
      }).then(async (r) => {
        if (!r || !r.ok) return settle(false)
        // 200 is NOT enough. The server answers {deduped:true} when it found no
        // reservation to commit (swept by TTL, or lost to a restart) - nothing
        // was logged and nothing was charged. An honest SDK cannot send a
        // duplicate (qualify() is one-shot), so every `deduped` it sees means
        // "not committed". Treating it as success was over-claiming a commit.
        let body = {}
        try { body = (await r.json()) || {} } catch (e) { /* empty/невалидный body -> ниже */ }
        settle(body.deduped !== true)
      }, () => settle(false))
    }

    // наполняем card по формату + подключаем триггер qualify
    let videoStarted = false
    // How this show will be scored, decided by the branch that actually renders
    // rather than by the type the response asked for. A `vast` creative with no
    // vastUrl renders as a text card, and scoring it as a video meant the player
    // waited for an `ended` event that nothing would ever fire.
    let rewardPath = 'dwell'
    if (c.type === 'vast' && c.vastUrl) {
      rewardPath = 'video'
      // 'contain', не 'cover': ad-креативы обычно вертикальные (9:16), и обрезка
      // съедает как раз брендинг и финальный CTA-кадр.
      // No explicit size and no ratio branching: `.w2a-media` scales the video
      // down by its OWN intrinsic dimensions until it fits the card on both
      // axes. 16:9, 9:16, 1:1 and 4:5 all land correctly, and a rotation just
      // re-resolves the same rule - no `loadedmetadata` measuring, no listener.
      // SOUND. A video ad with no audio is half an ad, and we were hard-coding
      // `muted = true` and shipping silence to everyone.
      //
      // The browser rule that matters is NOT the portal's `allow="autoplay"`.
      // That permission gates autoplay - starting with NO user gesture. With a
      // real gesture inside OUR OWN frame, unmuted play() is allowed even where
      // the portal granted us nothing. And we have exactly such a gesture: a tap
      // on the game canvas is inside our frame, and `tryShowReady()` runs
      // synchronously inside it. (Activation propagates to ancestors and to
      // same-origin descendants only - so a tap on the portal's own chrome
      // gives us nothing, but a tap on the game gives us everything.)
      //
      // So: ask for sound, never assume we got it, and make silence recoverable
      // in one tap. Same ladder Google's IMA prescribes.
      const wantAudio = this.cfg.audio !== 'muted'
      backdrop.setAttribute('data-kind', 'video')
      const vid = el('video', null, { className: 'w2a-media' })
      vid.muted = !wantAudio
      // No `autoplay` attribute: we call play() ourselves, at a moment we choose
      // for the gesture. Leaving the attribute on lets the browser start the
      // element on its own schedule, which is exactly how an unmuted element
      // ends up starting outside the gesture and getting refused.
      vid.playsInline = true; vid.setAttribute('playsinline', '')
      card.appendChild(vid)
      ctx.audio = wantAudio ? 'requested' : 'muted_by_config'

      // --- independent video clocks ---------------------------------------
      // requestTimeoutMs bounds the ad request before this renderer exists.
      // These four clocks start only once the ad is activated:
      //   start     - waits for credible media-time advance, not `playing`
      //   stall     - resets on each credible advance
      //   billable  - one stretch of credible advancing playback
      //   reward    - 30 seconds of credible advancing playback
      // maxVideoMs is the legacy absolute wall deadline for the whole visible
      // show. It is a total, never an allowance added to the creative duration.
      const cfgMs = (value, fallback) => {
        const n = Number(value)
        return Number.isFinite(n) && n >= 0 ? n : fallback
      }
      const videoRewardMs = cfgMs(this.cfg.videoRewardMs, 30000)
      const videoStartTimeoutMs = cfgMs(this.cfg.videoStartTimeoutMs, 10000)
      const videoStallTimeoutMs = cfgMs(this.cfg.videoStallTimeoutMs, 10000)
      const videoBillableMs = cfgMs(this.cfg.billableMs, 1000)
      const fullRewardRatio = 0.98
      const declaredDurationMs = cfgMs(c.durationMs, 0)
      const metadataDurationMs = () => {
        const d = Number(vid.duration) * 1000
        return Number.isFinite(d) && d > 0 ? d : 0
      }
      const videoDurationMs = () => {
        const d = metadataDurationMs()
        if (d > 0) return d
        if (declaredDurationMs > 0) return declaredDurationMs
        const t = Number(vid.currentTime) * 1000
        return Number.isFinite(t) && t > 0 ? t : null
      }
      const gatedDurationMs = () => Math.max(
        declaredDurationMs,
        metadataDurationMs(),
        ctx.format === 'rewarded' ? videoRewardMs : 0,
      )
      const absoluteVideoMs = () => Math.max(
        cfgMs(this.cfg.maxVideoMs, 10000),
        videoStartTimeoutMs + gatedDurationMs() + videoStallTimeoutMs,
      )
      // Metadata can reveal a longer film than the response declared. Keep one
      // absolute timer and re-arm it from the original activation boundary when
      // better duration evidence arrives. A stream with no declared or metadata
      // duration cannot move the backstop with its advancing currentTime.
      let absoluteStartedAt = null
      let absoluteTimer = null
      // Wall time the show has spent waiting behind a store page. It is SUBTRACTED
      // from the absolute deadline: this deadline is a watchdog against a film
      // that never finishes, not a limit on how long a player may spend deciding
      // whether to install. Without this a player who tapped Install at second 25
      // of a 30-second creative came back to `vast_deadline` - the ad killed
      // itself for the crime of being clicked.
      let absoluteClickPausedAt = null
      const armAbsoluteDeadline = () => {
        if (absoluteStartedAt === null || absoluteClickPausedAt !== null || ctx.completed) return
        if (absoluteTimer !== null) { dropTimer(absoluteTimer); absoluteTimer = null }
        const left = absoluteVideoMs() - (Date.now() - absoluteStartedAt)
        if (left <= 0) { this._finish(ctx, { state: 'failed', reason: 'vast_deadline' }); return }
        const handle = setTimeout(() => {
          if (absoluteTimer === handle) absoluteTimer = null
          dropTimer(handle)
          armAbsoluteDeadline()
        }, left)
        absoluteTimer = pushTimer(handle)
      }
      whenActive(() => {
        absoluteStartedAt = Date.now()
        armAbsoluteDeadline()
      })
      teardown.pauseVideoDeadline = () => {
        if (absoluteStartedAt === null || absoluteClickPausedAt !== null) return
        absoluteClickPausedAt = Date.now()
        if (absoluteTimer !== null) { dropTimer(absoluteTimer); absoluteTimer = null }
      }
      teardown.resumeVideoDeadline = () => {
        if (absoluteClickPausedAt === null) return
        // Push the start forward by exactly the time spent away, so the deadline
        // measures film time rather than errand time.
        if (absoluteStartedAt !== null) absoluteStartedAt += Date.now() - absoluteClickPausedAt
        absoluteClickPausedAt = null
        armAbsoluteDeadline()
      }

      // --- reward and billing evidence ------------------------------------
      let hasAdvanced = false
      let lastAttentionMs = 0
      let lastAdvanceVisibleMs = null
      let rewardEligible = false
      let playbackEnded = false
      // Rewarded video always excludes hidden-tab playback, even when a host has
      // disabled the dwell-format visibility guard for a misreporting webview.
      //
      // A click-suspended show counts as hidden here too, and this ONE line is
      // what keeps the suspension honest for video. Every reward and billing
      // decision downstream reads its evidence through this predicate, so a film
      // that keeps rolling behind the Play Store - which an Android WebView will
      // happily do, since `WebView.onPause()` does not pause JavaScript or media
      // - accrues neither coverage nor attention while the player is not there.
      // Guarding the grant conditions instead would have meant finding all of
      // them, and missing one is a reward paid for an ad nobody watched.
      const videoIsHidden = () => clickSuspended ||
        (typeof document !== 'undefined' && document.hidden === true)
      const observeVideoProgress = () => {
        const progress = evidence.verdict(videoDurationMs())
        if (progress.attentionMs > lastAttentionMs) {
          hasAdvanced = true
          lastAttentionMs = progress.attentionMs
          lastAdvanceVisibleMs = visibleMs()
        }
        // Both measurements must clear the gate. Attention alone can be bought
        // by replaying one short stretch; coverage alone can be bought by fast
        // playback. Their minimum is credible advancing playback of new film.
        const advancingMs = Math.min(progress.coverageMs, progress.attentionMs)
        paintVideoRewardCountdown(advancingMs)
        if (hasAdvanced && advancingMs >= videoBillableMs) qualify()
        if (ctx.format === 'rewarded' && !rewardEligible && hasAdvanced && advancingMs >= videoRewardMs) {
          rewardEligible = true
          recordVideoEvidence(progress)
          const full = progress.coverageRatio != null && progress.attentionRatio != null &&
            progress.coverageRatio >= fullRewardRatio && progress.attentionRatio >= fullRewardRatio
          grantReward({ rewardBasis: 'watched_video', rewardQuality: full ? 'full' : 'threshold' })
        }
        return progress
      }
      // One observation of the element, taken on `timeupdate` and on every event
      // that ENDS a playback epoch. Closing the epoch matters as much as opening
      // it: an unclosed segment is simply never counted, so a video that ends
      // between two timeupdates would lose its tail.
      const sampleVideo = (playing = vid.paused !== true) => {
        evidence.sample({
          mediaSec: vid.currentTime,
          wallMs: now(),
          rate: Number.isFinite(Number(vid.playbackRate)) ? Number(vid.playbackRate) : 1,
          playing,
          // `visSince !== null` is exactly "the ad is activated AND on screen" -
          // a preloaded overlay sits in the DOM with the clock stopped, so it
          // cannot bank attention before the game has shown it.
          visible: visSince !== null && !videoIsHidden(),
        })
        return observeVideoProgress()
      }
      // Which events merely OBSERVE playback, and which END it.
      //
      // Reading `vid.paused` is not enough to tell them apart, and that was the
      // hole: a buffering video reports `paused === false`, so a stall left the
      // epoch open, and the seek that followed was measured against the wall
      // clock of the stall. Thirty seconds of buffering bought a thirty-second
      // jump, which scored as a full watch.
      //
      // A stall or a pause still gets its tail credited - the player really did
      // watch up to that frame - and then the epoch is closed. A SEEK gets
      // nothing: `currentTime` has already moved by the time the event fires, so
      // sampling it would credit the jump we are trying to refuse.
      const endEpoch = (creditTail) => {
        if (creditTail) sampleVideo(true)
        evidence.break()
      }
      // Close the epoch and credit the tail while the ad is STILL counted as on
      // screen. The click suspension calls this before it raises its flag,
      // because `sampleVideo` stamps each sample with `visible: !videoIsHidden()`
      // and the flag makes that false. On a 60-second master a player whose last
      // `timeupdate` landed at 29.4s, who then watched through 30.0s and tapped
      // Install before the next one, would otherwise have that 0.6s discarded -
      // and 0.6s is exactly the width of the reward gate they just crossed.
      teardown.creditVideoTail = () => { try { endEpoch(true) } catch { /* nothing open to close */ } }
      teardown.resumeVideoEvidence = () => { try { sampleVideo() } catch { /* the next media event can retry */ } }
      for (const evt of ['timeupdate', 'playing', 'ratechange']) {
        vid.addEventListener(evt, () => sampleVideo())
      }
      // `waiting` and `pause` only. Both mean playback actually STOPPED, which
      // is the whole question. `suspend` and `stalled` are network events - the
      // browser stopped fetching, or data is slow - and the film usually keeps
      // rolling from the buffer straight through them. Treating them as stops
      // cost a real Chrome playthrough 4.5 percentage points of coverage, since
      // every spurious break loses the stretch between it and the next
      // timeupdate. An honest 30-second watch does not have 4.5% to spare
      // against a 90% threshold.
      for (const evt of ['pause', 'waiting']) {
        vid.addEventListener(evt, () => endEpoch(true))
      }
      for (const evt of ['seeking', 'seeked', 'emptied', 'error', 'abort']) {
        vid.addEventListener(evt, () => endEpoch(false))
      }
      // A backgrounded tab used to cost the player the reward twice over: the
      // media kept advancing in some browsers while none of it counted, so an
      // honest two-second glance at a notification left a permanent hole in the
      // coverage that nothing could refill. Pausing on hide means the film waits
      // for the player instead.
      // Registered so teardown can silence the film. Detaching the element is
      // not enough: it keeps its media resource and can keep playing audio.
      teardown.stopMedia = () => {
        try { vid.pause() } catch { /* already stopped */ }
        try { vid.removeAttribute('src'); vid.src = ''; if (vid.load) vid.load() } catch { /* nothing to release */ }
      }
      let pausedByHide = false
      // Assigned once the VAST media is chosen; the first play must go through
      // the audio ladder, so the resume path has to be able to reach it.
      let startPlayback = null
      onVisibilityChange = () => {
        // Runs BEFORE `_visHandler` flips the visibility state, so on the way
        // out the tail is still credited as on-screen, and on the way back in
        // the epoch is closed rather than bridged across the hidden stretch.
        endEpoch(true)
        if (videoIsHidden()) {
          if (!vid.paused) { pausedByHide = true; try { vid.pause() } catch { /* nothing to pause */ } }
          return
        }
        // Only an ad that is ON SCREEN may be resumed, and only one that had
        // actually started. Without the activation check this branch played a
        // PRELOADED video: a preloaded overlay is `display:none` with the film
        // never started, so `paused` is true, and the WebKit clause below read
        // that as "it got auto-paused, resume it". One tab switch then spent the
        // film and its impression on an ad the game had not shown yet, and the
        // reward became unwinnable before the player ever saw it.
        if (!ctx.visible) return
        if (vid.ended === true) return
        // `pausedByHide` covers both the film we paused on the way out and the
        // one we declined to start because the tab was already hidden when the
        // ad was built. The second clause is the WebKit case: it pauses a
        // backgrounded video ITSELF, sometimes before `visibilitychange` reaches
        // us, so the flag is never set and the ad would come back frozen.
        if (!pausedByHide && !(videoStarted && vid.paused)) return
        // A film that has never started needs the FIRST-play path, not the
        // resume path: only the first one runs the audio ladder that asks for
        // sound, catches the policy refusal and falls back to muted. Resuming
        // through the bare `play()` meant an ad deferred because the tab was
        // hidden came back silent, or not at all.
        if (!videoStarted && startPlayback) { pausedByHide = false; startPlayback(); return }
        resumePlayback()
      }
      // Resuming is best-effort and must SAY so rather than assume. There is no
      // gesture here, so `play()` can be refused - and the flag used to be
      // cleared before anyone knew whether it had been, with the rejection
      // swallowed. That left the ad paused forever with no route back: the
      // tap-to-unmute path returns immediately once the audio question is
      // settled, so it never resumed anything. Now the flag survives a refusal
      // and a tap anywhere on the ad tries again.
      const resumePlayback = () => {
        try {
          const p = vid.play()
          if (p && p.then) p.then(() => { pausedByHide = false }, () => { pausedByHide = true })
          else pausedByHide = false
        } catch { pausedByHide = true }
      }
      backdrop.addEventListener('pointerdown', () => {
        if (pausedByHide && vid.paused && vid.ended !== true && !videoIsHidden()) resumePlayback()
      }, { capture: true, passive: true })
      const settleVideoReward = () => {
        const v = evidence.verdict(videoDurationMs())
        recordVideoEvidence(v)
        // A browser does not promise a sample at media time zero. On the exact
        // 30-second master, real Chrome can naturally end with 99% credible
        // evidence while the raw accumulator is a few hundred milliseconds shy
        // of 30000. Natural end is not sufficient by itself: require the media
        // duration to reach the gate and both evidence ratios to meet the same
        // full-watch floor used for reporting. Seek, fast-rate and hidden plays
        // remain below that floor and earn nothing.
        const fullNaturalWatch = v.endedSeen === true && vid.ended === true &&
          v.durationMs != null && v.durationMs >= videoRewardMs &&
          v.coverageRatio != null && v.coverageRatio >= fullRewardRatio &&
          v.attentionRatio != null && v.attentionRatio >= fullRewardRatio
        if (!rewardEarned && ctx.format === 'rewarded' && fullNaturalWatch) {
          rewardEligible = true
          grantReward({ rewardBasis: 'watched_video', rewardQuality: 'full' })
        }
        if (!rewardEarned && ctx.format === 'rewarded') ctx.rewardQuality = 'not_earned'
        return v
      }
      // Read the evidence one last time on the way out, whatever the exit was.
      // Two things depend on it. A player who closes early would otherwise leave
      // a terminal event with no reward fields at all - "not rewarded" would be
      // indistinguishable from "not a rewarded ad". And a video whose `ended`
      // fires in the same tick as the close would lose a reward that was fully
      // earned, because `_finish` sets `completed` and the gate refuses to pay a
      // finished ad. Registered against THIS show rather than on the instance:
      // two preloaded video ads both render before either is shown, and a single
      // instance slot meant the second silently replaced the first, so the first
      // ad's evidence was gone by the time it needed it.
      teardown.rewardSnapshot = () => {
        endEpoch(true)
        if (vid.ended === true) evidence.end()
        settleVideoReward()
      }

      // Recovering from silence. Two ways in, because neither alone is enough:
      // a corner button most players never look for, and the next tap anywhere.
      //
      // The tap listener is CAPTURE + PASSIVE and calls neither preventDefault
      // nor stopPropagation. That is not politeness - the CTA is a real <a> doing
      // top-level navigation and the close button dismisses the ad, and both live
      // in this same overlay. Swallowing or re-targeting the tap would break the
      // click-out, which is the thing we are paid for. Passive makes
      // preventDefault impossible even by mistake.
      //
      // The close control is excluded: the first tap of a rewarded ad is very
      // often ×, and half a second of audio blaring during teardown reads as a
      // broken ad rather than a working one.
      const unmute = (ev) => {
        if (ctx.audio === 'audible' || !vid.muted) return
        if (ev && ev.isTrusted === false) return          // synthetic taps buy nothing
        if (ev && ev.target && ev.target.closest && ev.target.closest('[data-w2a="close"]')) return
        // Synchronously, inside the trusted event: on iOS, unmuting OUTSIDE a
        // gesture does not merely fail, WebKit pauses playback.
        vid.muted = false
        ctx.audio = 'audible'
        soundBtn.style.display = 'none'
        const p = vid.play()
        if (p && p.catch) p.catch(() => { vid.muted = true; ctx.audio = 'muted_by_policy'; soundBtn.style.display = 'block' })
      }
      const offerUnmute = () => {
        soundBtn.style.display = 'block'
        soundBtn.addEventListener('click', unmute)
        backdrop.addEventListener('pointerdown', unmute, { capture: true, passive: true })
      }
      // A video is only "ready" once the browser holds decodable data for it -
      // not when the VAST XML parsed. `loadedmetadata` alone is not enough: it
      // means dimensions are known, not that a frame can be presented.
      vid.addEventListener('loadeddata', () => { if (vid.videoWidth > 0 && vid.readyState >= 2) loaded() })
      vid.addEventListener('error', () => loadFailed('vast_media_error'), { once: true })
      // Abortable, and registered on the show. A preload superseded or expired
      // mid-fetch used to leave this request running: the response then attached
      // a source to a video that had already been detached, downloading a whole
      // creative for an ad the game will never see.
      const creativeAbort = new AbortController()
      teardown.abortCreative = () => { try { creativeAbort.abort() } catch { /* already settled */ } }
      let completeTrackers = []
      let completionTracked = false
      const fireCompletionTrackers = () => {
        if (completionTracked) return
        completionTracked = true
        for (const tracker of completeTrackers) {
          try {
            const p = fetch(src(tracker), {
              method: 'GET', mode: 'no-cors', credentials: 'omit',
              keepalive: true, cache: 'no-store',
            })
            if (p && p.catch) p.catch(() => {})
          } catch { /* a tracker cannot break the player's terminal */ }
        }
      }
      fetch(src(c.vastUrl), { signal: creativeAbort.signal }).then((r) => {
        if (!r || !r.ok) throw new Error('vast_http')
        return r.text()
      }).then((xml) => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml')
        completeTrackers = [...doc.querySelectorAll('Tracking[event="complete"]')]
          .map((node) => String(node.textContent || '').trim())
          .filter(Boolean)
        const murl = pickMediaFile(doc.querySelectorAll('MediaFile'), viewportRatio())
        // A VAST document with no playable MediaFile is a BROKEN creative, not a
        // finished view. Qualifying here billed the advertiser for an ad nobody saw.
        if (!murl) { loadFailed('vast_no_media'); return }
        // play() сразу после присвоения src может не стартовать (данных ещё нет),
        // поэтому пробуем и повторяем по мере готовности медиа. Playback starts
        // ONLY once the ad is on screen - a preloaded video must not play to an
        // empty room (and burn its one impression) before the game asked for it.
        //
        // There are three entry points here (immediate, loadeddata, canplay) and
        // they must NOT each be allowed to decide the audio question. On iOS,
        // flipping `muted` on a PLAYING element outside a gesture does not merely
        // fail - WebKit pauses playback. One shot, latched.
        let audioSettled = false
        const tryPlay = () => whenActive(() => {
          // An ad can be BUILT while the tab is already in the background: the
          // request round trip takes up to `requestTimeoutMs`, and a player
          // interrupted during it comes back to a film that has been running to
          // an empty room. No `visibilitychange` fires in that case - the tab was
          // hidden before we existed - so the pause-on-hide path never sees it,
          // and unlike a mid-show hide the burnt stretch could never be given
          // back. Defer to the same resume path instead.
          if (videoIsHidden()) { pausedByHide = true; return }
          const p = vid.play()
          if (!p || !p.catch) return
          p.catch((err) => {
            // NotAllowedError is the ONLY rejection that means "the policy said
            // no". AbortError (a competing load) and NotSupportedError (a broken
            // or empty src) are real failures, and answering those by muting
            // just makes a broken creative fail quietly - the exact outcome that
            // is worse than a muted one.
            if (!err || err.name !== 'NotAllowedError') return
            if (audioSettled || vid.muted) return
            audioSettled = true
            vid.muted = true
            ctx.audio = 'muted_by_policy'
            offerUnmute()
            const again = vid.play()
            if (again && again.catch) again.catch(() => {})
          })
        })
        startPlayback = tryPlay
        vid.addEventListener('loadeddata', tryPlay, { once: true })
        vid.addEventListener('canplay', tryPlay, { once: true })
        vid.src = src(murl)
        tryPlay()
      }).catch(() => loadFailed('vast_fetch_failed'))
      vid.addEventListener('ended', () => {
        // An `ended` event is scriptable, and the element can still dispatch one
        // after the show has already closed. VAST complete means the media
        // element itself reached its natural end during this active show.
        if (ctx.completed || vid.ended !== true) return
        // `paused` is already true here, so the tail has to be credited
        // explicitly or the last stretch before the end is silently lost.
        endEpoch(true)
        evidence.end()
        playbackEnded = true
        // The absolute deadline is only a watchdog for media that never
        // finishes. Once natural `ended` has been observed, leaving it armed
        // turns a valid end card into `vast_deadline` a few seconds later.
        absoluteStartedAt = null
        if (absoluteTimer !== null) { dropTimer(absoluteTimer); absoluteTimer = null }
        // Completion tracking is independent from the publisher reward latch.
        // A close after 30 seconds can keep its reward without pretending the
        // VAST player emitted a natural completion, while a real ended fires
        // every non-empty complete tracker exactly once.
        fireCompletionTrackers()
        settleVideoReward()
        backdrop.setAttribute('data-phase', 'endcard')
        // The end card IS the exit for a rewarded video: this is the moment the
        // locked slot becomes a real ×. Calling it here rather than from a CSS
        // phase watcher keeps the one place that decides "the film is over" in
        // charge of both the layout and the way out.
        if (closeGatedOnEndcard) unlockClose()
      })
      // Metadata changes presentation only. Billing and watchdog cancellation
      // require credible advancing media samples below.
      vid.addEventListener('loadedmetadata', () => {
        const b = ratioBucket(vid.videoWidth, vid.videoHeight)
        if (b) backdrop.setAttribute('data-ratio', b)
        armAbsoluteDeadline()
      })
      // VAST treats the end card as the companion shown once the video stops. Ours
      // is baked into the last seconds of the film, so there is no second asset to
      // swap in - the phase flip is what brings the headline back and enlarges the
      // CTA over the frozen final frame.
      vid.addEventListener('playing', () => {
        videoStarted = true
        // Report what the player ACTUALLY got, not what we asked for. This is
        // the field that answers "do your ads have sound?" with evidence
        // instead of an opinion, per placement and per device.
        if (ctx.audio !== 'muted_by_config') ctx.audio = vid.muted ? 'muted_by_policy' : 'audible'
      }, { once: true })

      // `playing` is an intention, not evidence: a browser can fire it and then
      // leave currentTime at zero. Only a credible evidence step cancels start.
      afterVisibleMs(videoStartTimeoutMs, () => {
        // timeupdate is deliberately low-frequency and can be delayed behind the
        // watchdog callback. Read the media clock at the decision boundary before
        // declaring a film inert.
        sampleVideo()
        if (!hasAdvanced) this._finish(ctx, { state: 'failed', reason: 'vast_never_advanced' })
      })
      // One resettable watchdog, not one timer per timeupdate. It compares the
      // foreground clock with the last credible media advance, so a hidden tab
      // pauses the budget and a seek cannot reset it.
      whenActive(() => {
        const periodMs = Math.max(10, Math.min(250, Math.max(10, videoStallTimeoutMs / 4)))
        const stallTimer = setInterval(() => {
          if (ctx.completed) { clearInterval(stallTimer); return }
          if (playbackEnded || vid.ended === true) { clearInterval(stallTimer); return }
          // A genuine advance can precede its delayed timeupdate event. Sampling
          // here keeps the watchdog tied to media state rather than event-loop
          // scheduling.
          sampleVideo()
          if (!hasAdvanced || lastAdvanceVisibleMs === null) return
          if (visibleMs() - lastAdvanceVisibleMs >= videoStallTimeoutMs) {
            clearInterval(stallTimer)
            this._finish(ctx, { state: 'failed', reason: 'vast_stalled' })
          }
        }, periodMs)
        pushTimer(stallTimer)
      })
      // Absolute is deliberately wall time. Foreground clocks stop for hidden
      // tabs, but a server reservation and a host promise do not. The timer above
      // remains a terminal backstop and is re-derived from actual metadata.
    } else if (c.type === 'playable' && c.url) {
      backdrop.setAttribute('data-kind', 'playable')
      const ifr = el('iframe', null, { className: 'w2a-frame' })
      // Honour a declared shape; never invent one. Guessing a ratio here would
      // hand a 16:9 playable a 9:16 viewport and the creative would lay itself
      // out for a screen it never got - broken in a way that still renders, so
      // nothing would ever report it.
      const pw = Number(c.width), ph = Number(c.height)
      if (pw > 0 && ph > 0) {
        ifr.setAttribute('data-w2a-ar', `${pw}x${ph}`)
        ifr.style.setProperty('--w2a-ar', String(pw / ph))
        ctx.playableSizing = 'declared'
      } else {
        // Not a fallback ratio - an explicit contract: an undeclared playable is
        // treated as responsive and gets the whole slot. Recorded so a creative
        // that SHOULD have declared a shape is visible in reporting.
        ctx.playableSizing = 'responsive'
      }
      ifr.setAttribute('sandbox', 'allow-scripts') // без top-nav/popups: CTA у нас
      ifr.src = src(c.url)
      card.appendChild(ifr)
      // Impression = the playable actually rendered (iframe load), per the
      // qualified-impression rule. COMPLETION is a different thing: it gates the
      // reward, not the billing, and it must survive the anti-spoof check.
      // Per-show, with the instance field kept only as a convenience mirror of
      // whichever show is live. Two playables coexist as preloads by design, and
      // a single flag meant one creative's completion was read as the other's -
      // and it was never cleared on teardown, so it also leaked into the show
      // after that.
      const playableMsg = (e) => {
        if (e.source !== ifr.contentWindow) return // only our playable iframe (anti-spoof)
        if (!e.data || e.data.w2a !== 'playable') return
        // A cooperative playable tells us when it is genuinely initialised. The
        // iframe `load` event does NOT mean that: browsers fire it even when the
        // document inside failed, so it is only a weak fallback signal.
        // Accept both names. The shipped creative posts `load_complete`; this
        // listener only knew `ready`, so the strong readiness proof was never
        // taken and every playable fell back to the weak iframe-load signal.
        if (e.data.type === 'ready' || e.data.type === 'load_complete') {
          ctx.readinessProof = 'strong'; loaded()
        }
        if (e.data.type === 'complete') {
          // `complete` no longer pays. It arrives from third-party creative code
          // running in the iframe, so it proves only that the creative CHOSE to
          // send it - a creative can post it at t=0, and one that forgets to post
          // it at all used to leave an honest player permanently unrewardable
          // behind a button reading "Finish the ad to claim". Neither direction
          // is acceptable, and there is no message protocol that fixes it: a
          // nonce or a heartbeat is handed to the same untrusted code. So the
          // playable pays on visible dwell, and this signal is reported instead
          // of trusted - a partner can still see which creatives integrate.
          ctx.playableCompleteSeen = true
          // Hand the screen back. The creative's own comment says `complete`
          // "signals SDK to reveal the parent-owned CTA", and the iframe is
          // sandboxed without top navigation so it CANNOT link to a store
          // itself. Without this the playable ends with no way to install.
          backdrop.setAttribute('data-phase', 'endcard')
        }
        // The creative asks the parent to perform the click-out, because only
        // the parent can navigate the top-level document.
        if (e.data.type === 'cta') cta.click()
      }
      teardown.playableMsg = playableMsg
      window.addEventListener('message', playableMsg)
      ifr.addEventListener('load', () => {
        // Weak proof: accepted so a non-cooperative playable still works, but
        // labelled honestly so reporting does not claim more than we verified.
        if (!ctx.readinessProof) ctx.readinessProof = 'weak'
        loaded()
        afterVisibleMs(this.cfg.billableMs, qualify)
      }, { once: true })
      // A playable that never loaded is an error, not a finished view.
      afterVisibleMs(this.cfg.maxPlayableMs, () => {
        if (!qualified) this._finish(ctx, { state: 'failed', reason: 'playable_never_loaded' })
      })
    } else if (c.type === 'image' && c.url) {
      // A bare timer billed for an image that may have 404'd. Qualify only once
      // the image has actually LOADED; a load error fails to the fallback.
      // 'contain' via `.w2a-media`, never 'cover'. Cropping an ad creative eats
      // the branding and the end-card CTA at the edges - the parts the
      // advertiser is paying for - and it does it silently.
      backdrop.setAttribute('data-kind', 'image')
      // A still has no video phase, so it IS the end card: host copy and the
      // larger CTA belong on screen from the first frame.
      backdrop.setAttribute('data-phase', 'endcard')
      const img = el('img', null, { className: 'w2a-media', alt: c.headline || 'ad' })
      img.addEventListener('load', () => {
        const b = ratioBucket(img.naturalWidth, img.naturalHeight)
        if (b) backdrop.setAttribute('data-ratio', b)
        // decode() is the difference between "bytes arrived" and "this can be
        // painted on the next frame without stalling". Preload exists precisely
        // to pay that cost before the player is waiting.
        const done = () => { ctx.readinessProof = 'strong'; loaded() }
        if (typeof img.decode === 'function') img.decode().then(done, () => loadFailed('image_decode_failed'))
        else done()
        afterVisibleMs(this.cfg.billableMs, qualify)
      }, { once: true })
      img.addEventListener('error', () => loadFailed('image_load_failed'), { once: true })
      card.appendChild(img)
      img.src = src(c.url)
    } else {
      card.appendChild(el('div', { color: '#fff', fontSize: '30px', fontWeight: '800' }, { textContent: c.headline || 'Toon Blocks' }))
      ctx.readinessProof = 'strong' // nothing to fetch: a text card is ready as built
      loaded()
      afterVisibleMs(this.cfg.billableMs, qualify)
    }

    const closedEvent = (extra = {}) => ({
      state: 'closed',
      ...(ctx.format === 'rewarded' && rewardPath === 'video' && !rewardEarned
        ? { reason: 'closed_before_reward' }
        : {}),
      ...extra,
    })

    // клик по CTA: навигация синхронно (уже user-gesture), бэк логирует и 302.
    // Клик принимается ТОЛЬКО в состоянии READY и только как настоящий ввод.
    // isTrusted отсекает программный .click()/dispatchEvent (но не автоматизацию
    // браузера и не враждебный код на той же странице - это ограничение честное).
    cta.addEventListener('click', (e) => {
      if (clickState !== 'READY') { e.preventDefault(); return }
      if (!e.isTrusted && !this.cfg.allowSyntheticClicks) { e.preventDefault(); return }
      clickState = 'CLICKED'                 // one-shot: повторный тап уже не пройдёт
      cta.style.pointerEvents = 'none'
      if (!e.isTrusted) ctx.synthetic = true  // синтетика помечается явно
      // NOTHING HEAVY BELOW THIS LINE. Whatever runs here runs BEFORE the browser
      // performs the navigation this anchor is about to do, on the same thread.
      // The old code called `_finish` from here: reward snapshot, timer sweep,
      // listener removal, overlay detach, `document.exitFullscreen()` and a
      // synchronous publisher callback, all in front of the player's trip to the
      // store. Suspension is a flag, one timer and one event.
      // Gated on the RETURN VALUE. Announcing a suspension that did not happen
      // is worse than announcing nothing: the contract for `clickPhase:
      // 'suspended'` is "the ad is still on screen, stay paused", so a host that
      // believes it re-pauses a game with no ad in front of it.
      //
      // SUSPEND ONLY WHERE THE DOCUMENT SURVIVES THE CLICK. A `_top` navigation
      // replaces this document; nothing in it comes back, so there is no ad to
      // return to and no timer left alive to end the wait. Pretending otherwise
      // produced the worst of both worlds: the player still lost the ad, and the
      // show was recorded as `failed / click_left_page` - a successful click
      // filed as an error, which is a lie told to our own reporting. Here the
      // click is what it has always been, the end of the show, and it says so.
      if (!clickPreservesDocument()) {
        this._finish(ctx, closedEvent({ clicked: true, ...(e.isTrusted ? {} : { synthetic: true }) }))
        return
      }
      if (!suspendForClick()) return
      this._emit('w2a_click', { ...ctx, state: 'opened', clicked: true, suspended: true, clickPhase: 'suspended' })
    })

    // rewarded lifecycle (интервал очищается в _finish, иначе stale-эмит rewarded)
    // REWARD IS EARNED BY WATCHING, NOT BY WAITING.
    //
    // The gate per format:
    //   video    - 30 seconds of credible advancing coverage AND attention
    //   playable - visible dwell. Its `complete` comes from untrusted creative
    //              code, so it is reported and not trusted (see the handler).
    //   image    - has nothing to complete, so visible dwell is the only honest
    //              signal and rewardSecs governs it
    //
    // The countdown itself is now DERIVED from accumulated visible milliseconds
    // rather than decremented once per callback. Counting callbacks measures the
    // event loop, not time: a throttled background tab fires the interval at
    // roughly 1Hz, so the old loop happily counted down to zero while the ad was
    // not on screen at all, and paid an image reward to a player who had switched
    // away. Reading the clock instead means throttling can only DELAY a payout.
    if (ctx.format === 'rewarded') {
      // A publisher who passes `rewardSecs: undefined` - which any config spread
      // from JSON does when the key is absent - used to fall through `|| 1` to a
      // ONE-second reward instead of the five-second default. Failing open on a
      // payout threshold is the wrong direction, so an unusable value takes the
      // default rather than the floor.
      const wanted = Number(this.cfg.rewardSecs)
      const floorMs = Math.max(1000, (Number.isFinite(wanted) && wanted > 0 ? wanted : 5) * 1000)
      // Which branch actually RENDERED, not which type the response asked for.
      // A `vast` creative with no usable media falls through to the text card,
      // and deciding by `c.type` then left that rewarded ad waiting forever for
      // an `ended` that could never come.
      const byDwell = rewardPath !== 'video'
      // Grant on the dwell floor. Called from the poll AND from teardown, because
      // the poll runs every 250ms and a player who taps Install or × inside that
      // gap had already earned the reward.
      const grantDwell = () => {
        if (rewardEarned || !byDwell) return false
        if (!creativeRendered) return false
        if (visibleMs() < floorMs) return false
        grantReward({
          rewardBasis: 'visible_dwell',
          // Never `full`: dwell is a policy, not proof that anything was
          // watched, and a partner must be able to tell the two apart.
          rewardQuality: 'dwell_only',
          rewardVisibleMs: Math.round(visibleMs()),
        })
        return true
      }
      if (byDwell) teardown.rewardSnapshot = grantDwell
      whenActive(() => {
        if (!byDwell) {
          // The locked close slot is the one video clock. The reward control
          // returns when paintEarned has a distinct state to announce.
          rewardBtn.style.display = 'none'
          return
        }
        rewardBtn.textContent = `Reward in ${Math.ceil(floorMs / 1000)}s…`
        const t = setInterval(() => {
          if (rewardEarned || ctx.completed) { clearInterval(t); return }
          const leftMs = floorMs - visibleMs()
          if (leftMs > 0) { rewardBtn.textContent = `Reward in ${Math.ceil(leftMs / 1000)}s…`; return }
          clearInterval(t)
          // A creative that never arrived is not something the player watched,
          // however long the overlay sat on screen.
          if (!grantDwell()) rewardBtn.textContent = 'Ad did not load'
        }, 250)
        pushTimer(t)
      })
    }
    // `pointerEvents: none` is presentation, not a guard: a host stylesheet, a
    // synthetic event or an accessibility tool can still deliver the click. The
    // countdown is enforced here.
    close.addEventListener('click', () => { if (closeArmed) this._finish(ctx, closedEvent()) })
  }

  /**
   * Make a prepared (hidden) ad visible. This is the LOOM_VISIBLE boundary and
   * it is deliberately synchronous: it is called from inside the game's click
   * handler, so it must not await anything or the user gesture is lost.
   */
  _activate(ctx) {
    if (ctx.visible || ctx.completed) return
    // Ownership is committed BEFORE the game is told anything. `w2a_pause` is a
    // publisher callback that runs synchronously, and a perfectly reasonable one
    // - pause the game, then show the next ready ad - re-entered this method
    // while `this.active` was still null. The SDK read as idle, accepted the
    // second show, and the player got two overlays stacked on top of each other
    // with the first one orphaned behind it. Nothing between these assignments
    // and the emit paints, so the game still pauses before a frame is drawn.
    if (ctx.overlay) ctx.overlay.style.display = 'flex'
    this.overlay = ctx.overlay
    this.active = ctx
    ctx.visible = true
    ctx.impStart = Date.now()
    if (ctx._startVisible) ctx._startVisible()
    ctx.paused = true
    // `opened` rather than nothing: the ad IS on screen at this point, and the
    // published type says every payload carries a state.
    this._emit('w2a_pause', { ...ctx, state: 'opened' })
    if (ctx.completed || this.active !== ctx) return
    // ORDER IS LOAD-BEARING. The queue holds the unmuted `video.play()` call,
    // and `requestFullscreen()` CONSUMES transient activation per the Fullscreen
    // spec ("consume user activation given pendingDoc's relevant global object").
    // Running fullscreen first spent the game's gesture on a cosmetic upgrade and
    // left the audible-playback request - the one the partner actually tested -
    // to be refused with NotAllowedError and fall back to muted.
    //
    // So: media first, screen second. Both still run inside the same gesture and
    // before any await; the only thing that changes is which one gets the
    // activation if there is not enough for both.
    const queued = ctx._onActivate || []
    ctx._onActivate = []
    for (const fn of queued) { try { fn() } catch (e) { /* one broken timer must not kill the show */ } }
    // Best-effort, and now explicitly the LOWER priority of the two: it must
    // never decide whether the ad shows, and it must never cost us the audio.
    this._enterFullscreen(ctx)
    // `opened` is emitted LAST, after the coverage verdict exists. Emitting an
    // event consumes no activation, so this costs the ordering above nothing -
    // but emitting it first meant the one event every publisher is guaranteed to
    // see carried no coverage at all, and the device-check row for it could never
    // be filled. The partner reported "full screen - failed" and our own check
    // for it was silent.
    //
    // The synchronous verdicts (unnecessary / unavailable / no_activation /
    // inherited) are final here. `requested` still resolves to entered or denied
    // asynchronously; `closed` carries that settled value.
    this._state({ ...ctx, state: 'opened' })
  }

  /**
   * What surface can this SDK actually deliver, here, right now? Callable
   * before any ad runs, so a publisher can fix their iframe attributes rather
   * than discover the limit from a QA sheet that says "FAILED".
   */
  capabilities() {
    const framed = isFramed()
    const fs = fullscreenAllowed()
    return {
      framed,
      fullscreenAllowed: fs,
      // What we would achieve for an ad shown right now.
      coverage: !framed ? 'window' : (fs ? 'screen_if_gesture' : 'document'),
      viewport: typeof window !== 'undefined' ? [window.innerWidth, window.innerHeight] : null,
    }
  }

  _watchFullscreen(ctx) {
    if (ctx._fsWatch || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
    ctx._fsWatch = () => {
      if (!document.fullscreenElement && ctx.fullscreenOwned) {
        ctx.fullscreenOwned = false
        ctx.fullscreen = 'exited_by_user'
        ctx.presentation = 'document'
      }
    }
    document.addEventListener('fullscreenchange', ctx._fsWatch)
  }

  _fullscreenEntered(ctx) {
    // A later show may cover the same root by the time a cancelled request is
    // fulfilled. Hand SDK ownership to that visible show instead of dropping
    // fullscreen under it.
    const successor = ctx.completed && this.active !== ctx ? this.active : null
    if (successor && !successor.completed && successor.visible && successor.overlay) {
      ctx.fullscreenOwned = false
      successor.fullscreen = 'entered'
      successor.presentation = 'screen'
      successor.fullscreenOwned = true
      this._watchFullscreen(successor)
      return
    }
    ctx.fullscreen = 'entered'
    ctx.presentation = 'screen'
    ctx.fullscreenOwned = true
    if (ctx.completed) this._exitFullscreen(ctx)
    else this._watchFullscreen(ctx)
  }

  _trackFullscreen(ctx, pending) {
    if (!pending || typeof pending.then !== 'function') return
    ctx._fsPending = pending
    pending.then(() => {
      if (ctx._fsPending !== pending) return
      ctx._fsPending = null
      this._fullscreenEntered(ctx)
    }, () => {
      if (ctx._fsPending !== pending) return
      ctx._fsPending = null
      if (!ctx.completed) ctx.fullscreen = 'denied'
    })
  }

  /**
   * Fullscreen is a property of a show, not a state of it: it never changes
   * whether the ad appears, only how much of the screen it covers, and the
   * outcome is recorded on ctx so every event carries the truth.
   */
  _enterFullscreen(ctx) {
    ctx.framed = isFramed()
    ctx.presentation = 'document'
    // The game can already own the root fullscreen before the ad opens. Its body
    // and our overlay remain inside that fullscreen subtree, so report the
    // inherited screen presentation before evaluating browser chrome.
    if (foreignFullscreen() && !fullscreenBlocksOverlay()) {
      ctx.fullscreen = 'inherited'; ctx.presentation = 'screen'; return
    }
    // Being unframed used to end the story here: `position:fixed` already covers
    // the document viewport, so there was nothing left to escape. That is true of
    // a desktop tab and false of a phone, where the browser's own toolbar sits
    // OUTSIDE the layout viewport and takes 60-130 CSS px that fullscreen hands
    // back. The partner asked for precisely that - the ad should open without the
    // address bar above it - and the ads that were photographed had it, because
    // they were opened at the top level rather than inside a game frame.
    //
    // So the question is not "are we framed" but "is there browser chrome to
    // reclaim", and that one is measurable instead of inferred.
    if (!ctx.framed && !browserChromeVisible()) {
      ctx.fullscreen = 'unnecessary'; ctx.presentation = 'window'; return
    }
    if (!fullscreenAllowed()) { ctx.fullscreen = 'unavailable'; return } // no delegation, or iPhone
    if (foreignFullscreen()) { ctx.fullscreen = 'inherited'; ctx.presentation = 'screen'; return }
    // `_show` awaits the ad request before it paints, so the tap that started the
    // ad is often no longer spendable by the time we get here. Reporting
    // `no_activation` and stopping was truthful and useless: the ad then ran with
    // the toolbar up for its whole life. The first touch that lands ON the ad is
    // a fresh activation, so ask again then - once, and never after the user has
    // deliberately left fullscreen, which would be fighting them.
    if (!hasActivation()) { ctx.fullscreen = 'no_activation'; this._armFullscreenRetry(ctx); return }
    const root = document.documentElement
    if (!root || typeof root.requestFullscreen !== 'function') { ctx.fullscreen = 'unavailable'; return }
    ctx.fullscreen = 'requested'
    // documentElement, never the backdrop. The Fullscreen UA stylesheet forces
    // `position:fixed !important; inset:0 !important` and an opaque ::backdrop
    // onto any fullscreened element EXCEPT :root - so fullscreening a
    // sub-element would black out everything outside the top layer, including
    // the game we are supposed to be sitting on top of.
    try {
      const p = root.requestFullscreen()
      if (p && p.then) this._trackFullscreen(ctx, p)
      this._watchFullscreen(ctx)
    } catch {
      ctx._fsPending = null
      if (!ctx.completed) ctx.fullscreen = 'denied'
    }
  }

  /**
   * One retry, spent on the first touch that lands on the ad.
   *
   * Bounded on purpose. It fires at most once (`once:true`), only from the
   * `no_activation` state, and it re-checks that state at fire time - so a user
   * who pressed Escape between arming and touching is not dragged back into
   * fullscreen by their own tap. It listens in the CAPTURE phase so it sees the
   * touch even if the creative's iframe would otherwise own it, and it never
   * calls preventDefault: the tap must still do whatever it was going to do.
   */
  _armFullscreenRetry(ctx) {
    const root = typeof document !== 'undefined' && document.documentElement
    if (!ctx.overlay || !root || typeof root.requestFullscreen !== 'function') return
    ctx._fsRetry = () => {
      ctx._fsRetry = null
      if (ctx.completed || ctx.fullscreen !== 'no_activation') return
      if (foreignFullscreen()) { ctx.fullscreen = 'inherited'; ctx.presentation = 'screen'; return }
      ctx.fullscreen = 'requested'
      try {
        const p = root.requestFullscreen()
        if (p && p.then) this._trackFullscreen(ctx, p)
      } catch {
        ctx._fsPending = null
        if (!ctx.completed) ctx.fullscreen = 'denied'
      }
    }
    ctx.overlay.addEventListener('pointerdown', ctx._fsRetry, { once: true, capture: true })
  }

  _exitFullscreen(ctx) {
    if (ctx._fsWatch) { document.removeEventListener('fullscreenchange', ctx._fsWatch); ctx._fsWatch = null }
    if (ctx._fsRetry) {
      // Removed explicitly rather than left to `once`, which only fires on a tap
      // that may never come: the overlay is detached on teardown, and a listener
      // holding this closure would hold the whole ad context with it.
      if (ctx.overlay) ctx.overlay.removeEventListener('pointerdown', ctx._fsRetry, { capture: true })
      ctx._fsRetry = null
    }
    // Only undo what WE did. Exiting a fullscreen the game owns would drop the
    // player out of their own game when our ad closes.
    if (!ctx.fullscreenOwned) return
    ctx.fullscreenOwned = false
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}) } catch { /* nothing to undo */ }
  }

  _finish(ctx, ev) {
    // Per-show terminal guard. Without it a late callback (an aborted fetch, a
    // stale timer, a second error path) could run _finish AGAIN - emitting a
    // second terminal to the host and, worse, tearing down a LATER ad that had
    // already opened. Mode B has had this via `terminalEmitted`; Mode A did not.
    if (ctx.completed) return
    const teardown = showTeardown.get(ctx)
    // The snapshot runs BEFORE `completed` on purpose - the gate refuses to pay
    // an ad that is already finished, and a video whose `ended` lands in this
    // same tick has genuinely earned its reward. But it emits `rewarded` to
    // publisher listeners synchronously, and a listener that closes the ad from
    // inside that callback used to re-enter here with `completed` still false:
    // the inner call tore everything down and emitted a terminal, then this one
    // resumed and emitted a SECOND terminal for the same show. Worse, if the
    // host started its next ad from the first terminal, the outer teardown then
    // cleared THAT ad's timers. So re-entry is refused for the whole window in
    // which `completed` is not yet true.
    if (teardown) {
      if (teardown.finishing) return
      teardown.finishing = true
      const snap = teardown.rewardSnapshot
      teardown.rewardSnapshot = null
      if (snap) { try { snap() } catch { /* evidence is worth less than a clean teardown */ } }
    }
    // The close may land between the last timeupdate and the exact 30-second
    // boundary. rewardSnapshot closes that final playback epoch before this
    // terminal is emitted; if it latches the reward, the pre-snapshot reason is
    // no longer true and must not survive into the public event.
    const settlement = showSettlements.get(ctx)
    const rewarded = settlement ? settlement.rewarded === true : ctx.rewardEarned === true
    if (ev && ev.reason === 'closed_before_reward' && rewarded) {
      ev = { ...ev }
      delete ev.reason
    }
    ctx.completed = true
    // `suspended` is NOT kept on ctx, and this is why. ctx is spread into every
    // publisher event, so a flag stored there rides out on whatever is emitted
    // next - and the reward grant that the tail credit can trigger is emitted
    // from inside the suspension itself, which put `suspended: true` on an
    // `ad_state` 'rewarded'. The published type says the flag only ever appears
    // on `w2a_click`, so that made the declaration a lie. It is passed
    // explicitly to the two `w2a_click` emits instead, and lives nowhere else.
    // Hand back budget this show reserved and never spent. Guarded on `!qualified`
    // inside the closure: releasing after `qualify()` has posted the impression
    // would void an in-flight commit and lose billing on a clicked ad.
    if (teardown && teardown.releaseUnbilled) {
      const releaseUnbilled = teardown.releaseUnbilled
      teardown.releaseUnbilled = null      // once, whatever else reaches _finish
      try { releaseUnbilled() } catch { /* best-effort: never block a terminal */ }
    }
    // чистим все таймеры показа: иначе билборд/rewarded могут выстрелить после close
    // Only THIS show's timers. Clearing the instance-wide list cancelled the
    // close countdown of any ad that was still preloaded, so the next ad opened
    // with a × that never armed and no way out but the CTA.
    if (teardown && teardown.timers) {
      for (const t of teardown.timers) { clearTimeout(t); clearInterval(t) }
      const mine = new Set(teardown.timers)
      this._timers = this._timers.filter((t) => !mine.has(t))
      teardown.timers.length = 0
    }
    // Only THIS show's listeners. Removing whatever happened to be on the
    // instance meant finishing one ad deafened another that was still preloaded.
    if (teardown) {
      if (teardown.playableMsg) { window.removeEventListener('message', teardown.playableMsg); teardown.playableMsg = null }
      if (teardown.visHandler) {
        if (typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', teardown.visHandler)
        teardown.visHandler = null
      }
      // The page-lifecycle listeners of the click suspension. They live on
      // `window` and `document`, not on the overlay, so detaching the ad does
      // not take them with it: a show that left its `pageshow` handler behind
      // would hold this entire context alive and could try to resume an ad that
      // is already gone.
      if (teardown.lifecycle) {
        for (const [target, type, handler] of teardown.lifecycle) {
          try { target.removeEventListener(type, handler, true) } catch { /* already detached */ }
        }
        teardown.lifecycle.length = 0
      }
      teardown.suspendForClick = null
      teardown.resumeFromClick = null
      if (teardown.abortCreative) { teardown.abortCreative(); teardown.abortCreative = null }
    }
    this._exitFullscreen(ctx)
    // Stop the media BEFORE detaching it. Removing a playing <video> from the
    // document does not stop it - the element keeps its media resource and, on
    // several browsers, keeps playing its audio. Closing an ad and still hearing
    // it is the kind of defect a player reports as the app being broken.
    if (teardown && teardown.stopMedia) {
      try { teardown.stopMedia() } catch { /* nothing left to stop */ }
      teardown.stopMedia = null
    }
    if (ctx.overlay) { ctx.overlay.remove(); if (this.overlay === ctx.overlay) this.overlay = null }
    // Release the slot BEFORE the terminal is announced. Hosts commonly start the
    // next ad from inside the terminal callback; with `active` still set that
    // show was rejected as `busy` and silently lost.
    if (this.active === ctx) this.active = null
    const terminal = publicEventDto({
      ...ctx, ...ev,
      ...(settlement ? { rewardEarned: settlement.rewarded === true } : {}),
    })
    settleShow(ctx, terminal)
    // Resume BEFORE the terminal, not after. A mediation host starts its OWN
    // fallback ad from inside the terminal callback and pauses the game to do
    // it. Emitting resume afterwards un-paused the game underneath the fallback
    // ad that had just started. Resume now means "our ad is gone"; whatever the
    // host does next owns the pause state from here on.
    // `paused: false` on the RESUME, which is the whole point of the event. It
    // used to forward `ctx` unchanged, so a resume told the host the game was
    // still paused - the exact opposite of what it was announcing.
    // Carries the TERMINAL state, not an absent one. The published type declares
    // `state` on every event a listener receives, and a pause/resume payload
    // that omitted it made the declaration a lie: a TypeScript publisher reading
    // `e.state` in a resume handler got `undefined` at runtime. The resume is
    // also the moment the host learns how the ad ended, so the terminal fields
    // belong on it.
    if (ctx.paused) this._emit('w2a_resume', { ...terminal, paused: false })
    this._state(terminal)
  }

  _state(s) {
    if (!STATES.includes(s.state)) return
    // `quiet: true` turns the developer warning off for a host that routes our
    // events somewhere of its own. Off by default is the wrong default here -
    // see explainSilence.
    if (!this.cfg || this.cfg.quiet !== true) explainSilence(s, this._explained || (this._explained = new Set()))
    this._emit('ad_state', s)
  }
}

/**
 * Say WHY nothing appeared, to the developer, in the console.
 *
 * There was not one `console` call in this entire file. When an ad does not
 * fill, the SDK renders nothing - which is correct - and it also said nothing,
 * anywhere, to anyone who had not wired an `ad_state` listener. That is every
 * integration on its first run.
 *
 * The cost was measured rather than imagined: a partner's engineer dropped the
 * SDK into a real game, tested it on a laptop, got fourteen `unsupported_device`
 * no-fills across a day, saw a blank screen every time, and reported "the ad
 * does not start". Nothing was broken. He had simply been given no way to find
 * that out, and the report cost both sides a day.
 *
 * ONCE PER REASON per page, not per request. A game that never fills would
 * otherwise print a line per impression, and a log that scrolls is a log nobody
 * reads. One line per distinct reason tells a developer what is happening and
 * stays quiet afterwards, including in production.
 */
const SILENT_STATES = { no_fill: 1, unsupported: 1, failed: 1 }
const WHY = {
  unsupported_device: 'this device is not eligible - the demand here is mobile-only, so a desktop browser draws no bid at all',
  no_bid: 'no campaign bid for this request - genre, country, budget or frequency cap',
  rate_limited: 'the ad server is rate-limiting this publisher',
  creative_error: 'the creative failed to render; this one IS a bug on our side - please send the requestId',
  timeout: 'the ad server did not answer in time',
}
function explainSilence(s, explained) {
  if (!SILENT_STATES[s.state]) return
  const key = s.state + ':' + (s.reason || '')
  if (explained.has(key)) return
  explained.add(key)
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  console.warn(
    `[W2A] no ad was shown (${s.state}): ${WHY[s.reason] || s.reason || 'no reason given'}`
    + (s.detail ? ` · ${s.detail}` : '')
    + ` · requestId ${s.requestId || 'n/a'}`
    + ' · shown once per reason; W2A.on("ad_state", fn) reports every one'
  )
}

// Why there was no ad, as reported by the SERVER. The client cannot tell an
// unsupported device from a plain no-bid (it does not know campaign targeting),
// so the backend labels it and we pass the label through unchanged. A mediation
// host treats these differently: unsupported is a property of the player and is
// worth remembering, a no-bid is transient and worth retrying.
function noFillReason(resp) {
  const r = resp && resp.reason
  if (r === 'unsupported_device' || r === 'rate_limited') return r
  return 'no_bid'
}

// Normalized device signals. The backend re-derives and never trusts these
// blindly, but sending them means an unrecognised client is reported as
// 'unknown' instead of being defaulted into a campaign it does not belong in.
function detectDevice() {
  try {
    const ua = navigator.userAgent || ''
    const uad = navigator.userAgentData
    let os = 'unknown'
    if (/Android/i.test(ua)) os = 'android'
    else if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = 'ios'
    else if (/Windows/i.test(ua)) os = 'windows'
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macos'
    else if (/Linux|X11/i.test(ua)) os = 'linux'
    let device_type = 'unknown'
    if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device_type = 'tablet'
    else if (uad && typeof uad.mobile === 'boolean') device_type = uad.mobile ? 'mobile' : 'desktop'
    else if (/Mobi|iPhone|iPod/i.test(ua)) device_type = 'mobile'
    else if (os === 'windows' || os === 'macos' || os === 'linux') device_type = 'desktop'
    // A phone OS cannot be running on a desktop, and the backend refuses
    // `desktop` outright - so when Client Hints and the UA string disagree,
    // that pair is not a device, it is a wrong answer that costs a fill.
    // Seen on the stand: six requests logged as `desktop_device: os=android
    // device=desktop`, and the local Home Makeover acceptance reproduced it -
    // an Android UA arrives while userAgentData still reports the host as
    // desktop (embedded WebViews, UA overrides, hardened browsers). The UA
    // string named the OS, so trust it over the hint it contradicts and fall
    // back to the tablet/mobile split the UA itself already carries.
    if ((os === 'android' || os === 'ios') && device_type === 'desktop') {
      device_type = /Mobi|iPhone|iPod/i.test(ua) ? 'mobile' : 'tablet'
    }
    return { os, device_type }
  } catch (e) { return { os: 'unknown', device_type: 'unknown' } }
}

/** Region subtag of the browser locale ('en-GB' -> 'GB'), or null. A locale is
 *  a preference, not a location, so this is only ever sent as a hint. */
function localeRegion() {
  try {
    const l = (navigator.languages && navigator.languages[0]) || navigator.language || ''
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})$/.exec(String(l))
    return m ? m[1].toUpperCase() : null
  } catch (e) { return null }
}

// Monotonic: wall-clock jumps (NTP, sleep) must not grant visible-time billing
// or rewards. _nowFn is a TEST seam; production always uses performance.now.
let _nowFn = null
function now() {
  if (_nowFn) return _nowFn()
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
}

function cryptoId() {
  const c = globalThis.crypto
  if (c && c.randomUUID) return c.randomUUID()
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export const W2A = new W2ASDK()
if (typeof window !== 'undefined') window.W2A = W2A
