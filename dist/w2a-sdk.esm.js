/* w2a-src-sha256:9fd2693c4d0647aa66c1fbd87a7a6a63f6111c47fbcf15bf3d36a671a5f8e36e */

// src/index.js
var STATES = ["loading", "opened", "closed", "rewarded", "failed", "no_fill", "unsupported"];
var MAX_CLICK_SUSPEND_MS = 6e4;
function el(tag, style, props) {
  const e = document.createElement(tag);
  if (style) Object.assign(e.style, style);
  if (props) Object.assign(e, props);
  return e;
}
var LAYOUT_CSS = `
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
 background:linear-gradient(180deg,#35d17e 0%,#12a55b 100%);color:#fff;
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
/* Locked: a rewarded video's close slot carries the REASON it is not an exit
   yet, instead of a countdown to one. Same corner and the same safe-area
   anchors as the armed disc, so nothing jumps when it turns back into a \xD7 at
   the end card. Both orientations get this for free - the anchors are the
   orientation-aware part, and they are unchanged. */
.w2a-backdrop button[data-w2a="close"][data-state="locked"]{
 width:auto;min-width:50px;padding:0 16px;border-radius:999px;font-size:14px;
 font-weight:600;white-space:nowrap;color:#ddd}
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
`;
function pickMediaFile(nodes, slotRatio) {
  const cands = [];
  for (const n of nodes || []) {
    const url = (n.textContent || "").trim();
    if (!url) continue;
    const w = Number(n.getAttribute("width")), h = Number(n.getAttribute("height"));
    cands.push({
      url,
      // A file that declares no size is still playable, so it stays in as a
      // last resort instead of being dropped - it just never beats a sized one.
      ratio: w > 0 && h > 0 ? w / h : null,
      bitrate: Number(n.getAttribute("bitrate")) || 0
    });
  }
  if (!cands.length) return null;
  const dist = (c) => c.ratio == null ? Infinity : Math.abs(Math.log(c.ratio / slotRatio));
  cands.sort((a, b) => dist(a) - dist(b) || a.bitrate - b.bitrate);
  return cands[0].url;
}
function ratioBucket(w, h) {
  if (!(w > 0 && h > 0)) return null;
  const r = w / h;
  const buckets = [["16x9", 16 / 9], ["1x1", 1], ["4x5", 4 / 5], ["9x16", 9 / 16]];
  let best = null, bestD = Infinity;
  for (const [name, br] of buckets) {
    const d = Math.abs(Math.log(r / br));
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return bestD < 0.06 ? best : null;
}
function viewportRatio() {
  const w = typeof window !== "undefined" && window.innerWidth || 0;
  const h = typeof window !== "undefined" && window.innerHeight || 0;
  return w > 0 && h > 0 ? w / h : 1;
}
function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
function fullscreenAllowed() {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}
function foreignFullscreen() {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}
function fullscreenBlocksOverlay() {
  if (typeof document === "undefined") return false;
  const element = document.fullscreenElement;
  return !!(element && element !== document.documentElement);
}
function hasActivation() {
  const ua = typeof navigator !== "undefined" && navigator.userActivation;
  return !!(ua && ua.isActive);
}
function browserChromeVisible() {
  try {
    if (typeof window === "undefined" || typeof screen === "undefined") return false;
    const coarse = typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0 || !!(window.matchMedia && window.matchMedia("(pointer:coarse)").matches);
    if (!coarse) return false;
    const sh = screen.height || 0, sw = screen.width || 0;
    const vh = window.innerHeight || 0, vw = window.innerWidth || 0;
    if (!(sh > 0 && sw > 0 && vh > 0 && vw > 0)) return false;
    const screenH = vh >= vw ? Math.max(sh, sw) : Math.min(sh, sw);
    return vh < screenH * 0.94;
  } catch (e) {
    return false;
  }
}
function injectLayoutCss(doc) {
  if (!doc || doc.getElementById("w2a-layout-css")) return;
  const s = doc.createElement("style");
  s.id = "w2a-layout-css";
  s.textContent = LAYOUT_CSS;
  (doc.head || doc.documentElement).appendChild(s);
}
var PUBLIC_STRING_FIELDS = Object.freeze([
  "state",
  "requestId",
  "format",
  "placement",
  "reason",
  "detail",
  "campaignId",
  "tier",
  "impressionState",
  "readinessProof",
  "audio",
  "playableSizing",
  "fullscreen",
  "presentation",
  "clickPhase",
  // A reward is money the PUBLISHER pays its own player, so the evidence behind
  // it has to travel with the event. `dwell_only` next to `full` is the whole
  // point: a mediation partner can tell a watched video from a waited-out one.
  "rewardBasis",
  "rewardQuality"
]);
var PUBLIC_NUMBER_FIELDS = Object.freeze([
  "priceCpm",
  "rewardCoverageRatio",
  "rewardAttentionRatio",
  "rewardDurationMs",
  "rewardVisibleMs",
  "rewardSeeks",
  "rewardRejectedJumps",
  "rewardMaxRate"
]);
var PUBLIC_BOOLEAN_FIELDS = Object.freeze([
  "preloaded",
  "matched",
  "impressionConfirmed",
  "clicked",
  "visibilityEnforced",
  "synthetic",
  "framed",
  "ctaGatedByImpression",
  "completed",
  "paused",
  "suspended",
  "rewardEarned",
  "rewardEndedSeen",
  "playableCompleteSeen",
  "rewardVisibilityEnforced"
]);
function publicEventDto(data) {
  const out = {};
  for (const key of PUBLIC_STRING_FIELDS) {
    if (typeof data[key] === "string") out[key] = data[key];
  }
  for (const key of PUBLIC_NUMBER_FIELDS) {
    if (Number.isFinite(data[key])) out[key] = data[key];
  }
  for (const key of PUBLIC_BOOLEAN_FIELDS) {
    if (typeof data[key] === "boolean") out[key] = data[key];
  }
  return Object.freeze(out);
}
var showTeardown = /* @__PURE__ */ new WeakMap();
function createRewardEvidence(opts = {}) {
  const optNum = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  const minStepMs = optNum(opts.minStepMs, 500);
  const tolerance = optNum(opts.tolerance, 1.25);
  const maxRate = optNum(opts.maxRate, 1.05);
  const requiredRatio = optNum(opts.requiredRatio, 0.9);
  const fullRatio = optNum(opts.fullRatio, 0.98);
  const covered = [];
  let attentionMs = 0;
  let anchor = null;
  let ended = false;
  let seeks = 0, rejectedJumps = 0, rateViolations = 0, maxRateSeen = 0;
  const atLeast = (a, b) => a >= b - 1e-9;
  function merge(startMs, endMs) {
    if (!(endMs > startMs)) return;
    let lo = startMs, hi = endMs;
    const keep = [];
    for (const iv of covered) {
      if (iv[1] < lo || iv[0] > hi) {
        keep.push(iv);
        continue;
      }
      lo = Math.min(lo, iv[0]);
      hi = Math.max(hi, iv[1]);
    }
    keep.push([lo, hi]);
    keep.sort((a, b) => a[0] - b[0]);
    covered.length = 0;
    for (const iv of keep) covered.push(iv);
  }
  const coveredMs = () => covered.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0);
  return {
    /**
     * One observation of the player. Call it on `timeupdate` and on every event
     * that ends a playback epoch (pause, seeking, waiting, ratechange, hide,
     * ended) - an epoch that is not closed leaves its final segment uncounted.
     */
    sample(s) {
      const mediaMs = Number(s && s.mediaSec) * 1e3;
      const wallMs = Number(s && s.wallMs);
      const rate = Number(s && s.rate);
      if (!Number.isFinite(mediaMs) || !Number.isFinite(wallMs)) {
        anchor = null;
        return;
      }
      if (Number.isFinite(rate) && rate > maxRateSeen) maxRateSeen = rate;
      if (!s.playing || !s.visible || !(rate > 0)) {
        anchor = null;
        return;
      }
      if (rate > maxRate) {
        rateViolations++;
        anchor = null;
        return;
      }
      if (anchor === null) {
        anchor = { mediaMs, wallMs };
        return;
      }
      const dw = wallMs - anchor.wallMs;
      const dm = mediaMs - anchor.mediaMs;
      if (dw < 0) {
        anchor = { mediaMs, wallMs };
        return;
      }
      if (dm <= 0) {
        if (dm < 0) seeks++;
        anchor = { mediaMs, wallMs };
        return;
      }
      if (dm > Math.max(minStepMs, tolerance * dw)) {
        rejectedJumps++;
        seeks++;
        anchor = { mediaMs, wallMs };
        return;
      }
      merge(anchor.mediaMs, mediaMs);
      attentionMs += Math.min(dm, dw);
      anchor = { mediaMs, wallMs };
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
    break() {
      anchor = null;
    },
    /** The creative reached its natural end. */
    end() {
      ended = true;
    },
    /**
     * @param durationMs total media length, from metadata or from the terminal
     *        currentTime. An unusable duration cannot be scored: there is no
     *        denominator, so the verdict is "not earned by watching" and the
     *        caller falls back to its dwell policy rather than inventing one.
     */
    verdict(durationMs) {
      const d = Number(durationMs);
      const usable = Number.isFinite(d) && d > 0;
      const cov = usable ? covered.reduce((sum, iv) => sum + Math.max(0, Math.min(iv[1], d) - Math.max(iv[0], 0)), 0) : coveredMs();
      const att = Math.min(attentionMs, usable ? d : Infinity);
      const coverageRatio = usable ? cov / d : null;
      const attentionRatio = usable ? att / d : null;
      const earned = ended && usable && atLeast(coverageRatio, requiredRatio) && atLeast(attentionRatio, requiredRatio);
      const full = earned && atLeast(coverageRatio, fullRatio) && atLeast(attentionRatio, fullRatio);
      const round = (v) => v === null ? null : Math.round(v * 1e3) / 1e3;
      return {
        earned,
        quality: earned ? full ? "full" : "threshold" : "not_earned",
        endedSeen: ended,
        durationMs: usable ? Math.round(d) : null,
        coverageMs: Math.round(cov),
        attentionMs: Math.round(att),
        coverageRatio: round(coverageRatio),
        attentionRatio: round(attentionRatio),
        seeks,
        rejectedJumps,
        rateViolations,
        maxRate: Math.round(maxRateSeen * 100) / 100
      };
    }
  };
}
var W2ASDK = class {
  constructor() {
    this.cfg = null;
    this.sessionId = cryptoId();
    this.listeners = {
      ad_state: /* @__PURE__ */ new Set(),
      w2a_pause: /* @__PURE__ */ new Set(),
      w2a_resume: /* @__PURE__ */ new Set(),
      w2a_impression: /* @__PURE__ */ new Set(),
      w2a_click: /* @__PURE__ */ new Set()
    };
    this.active = null;
    this.overlay = null;
    this._timers = [];
  }
  init(cfg) {
    this.cfg = Object.assign(
      {
        backend: "",
        publisherId: "demo-pub",
        gameId: "block-blitz",
        cell: "matched",
        siteId: "demo",
        creativeFormat: "image",
        billableMs: 1e3,
        rewardSecs: 5,
        requestTimeoutMs: 4e3,
        // Video has separate clocks. maxVideoMs is retained as the legacy total
        // deadline from activation, never as an allowance added to the film.
        videoRewardMs: 3e4,
        videoStartTimeoutMs: 1e4,
        videoStallTimeoutMs: 1e4,
        maxVideoMs: 1e4,
        maxPlayableMs: 2e4,
        requireVisible: true,
        preloadTtlMs: 3e4,
        // How long a show waits for a player who left for the store. Clamped to
        // MAX_CLICK_SUSPEND_MS, and cut shorter still by the server's own
        // reservation lease while the impression is unbilled - see the ceiling
        // arithmetic in the CTA path. A show cannot wait forever: it owns the
        // `active` slot, and a game whose next ad is refused as `busy` because a
        // player wandered off yesterday is worse than a lost impression.
        clickReturnTimeoutMs: MAX_CLICK_SUSPEND_MS,
        // 'auto' asks for sound and falls back to muted if the browser refuses.
        // 'muted' is for publishers whose own game audio must keep playing.
        audio: "auto"
      },
      // Present-but-undefined keys are DROPPED rather than allowed to overwrite
      // a default. `{ ...base, billableMs: maybeFromRemoteJson }` is the ordinary
      // way to assemble a config, every field is optional in the published type,
      // and `Object.assign` copies an explicit `undefined` over the default just
      // as happily as a number. `billableMs: undefined` then made the billing
      // deadline `NaN`, so the ad rendered, opened and stayed clickable while
      // nothing was ever billed and nothing reported - a silent total loss of
      // impression revenue for that publisher. `requestTimeoutMs: undefined`
      // aborts every ad request instead.
      cfg && Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== void 0))
    );
    this._explained = /* @__PURE__ */ new Set();
    return this;
  }
  on(evt, cb) {
    this.listeners[evt]?.add(cb);
    return () => this.listeners[evt]?.delete(cb);
  }
  _emit(evt, data) {
    const payload = publicEventDto(data || {});
    for (const cb of [...this.listeners[evt] || []]) {
      try {
        cb(payload);
      } catch (e) {
      }
    }
  }
  // consent: read (don't enforce in demo) TCF / GPP / US-privacy signals if a
  // publisher CMP is present; pass state to the backend which records it.
  _readConsent() {
    try {
      if (this.cfg && this.cfg.consentState) return this.cfg.consentState;
      if (typeof window.__tcfapi === "function") return "tcf_present";
      if (typeof window.__gpp === "function") return "gpp_present";
      const m = document.cookie.match(/(?:^|;\s*)usprivacy=([^;]+)/);
      if (m) return "usp:" + decodeURIComponent(m[1]);
    } catch (e) {
    }
    return "unknown";
  }
  /** test seam: override the monotonic clock (null restores the real one) */
  __setNow(fn) {
    _nowFn = fn || null;
  }
  showInterstitial(placement) {
    return this._show("interstitial", placement);
  }
  showRewarded(placement) {
    return this._show("rewarded", placement);
  }
  /**
   * Correlated host escape hatch for a show whose lifecycle went silent.
   * Refuse a stale requestId so one watchdog can never tear down a later ad.
   */
  cancelActive(requestId, reason = "host_cancelled") {
    const ctx = this.active;
    if (!ctx || ctx.completed || !requestId || ctx.requestId !== requestId) return false;
    const safeReason = typeof reason === "string" && reason ? reason.slice(0, 64) : "host_cancelled";
    this._finish(ctx, { state: "failed", reason: safeReason });
    return true;
  }
  /**
   * Tell a suspended show that the player is back.
   *
   * The browser signals - `visibilitychange`, `pageshow`, `focus` - cover an
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
    const ctx = this.active;
    if (!ctx || ctx.completed || !requestId || ctx.requestId !== requestId) return false;
    const teardown = showTeardown.get(ctx);
    return !!(teardown && teardown.resumeFromClick && teardown.resumeFromClick());
  }
  async _show(format, placement) {
    if (!this.cfg) throw new Error("W2A.init was not called");
    if (this.active) {
      this._state({ requestId: cryptoId(), state: "failed", reason: "busy", format, placement });
      return;
    }
    const claim = this.tryShowReady(format, placement);
    if (claim.started) return;
    const ctx = { requestId: cryptoId(), format, placement };
    this.active = ctx;
    this._state({ ...ctx, state: "loading" });
    if (ctx.completed || this.active !== ctx) return;
    const r = await this._requestAd(ctx.requestId, format, placement);
    if (ctx.completed || this.active !== ctx) {
      if (r && r.resp) this._release(ctx.requestId, r.resp);
      return;
    }
    if (r.error) {
      this._finish(ctx, { state: "failed", reason: r.error });
      return;
    }
    const resp = r.resp;
    if (!resp || resp.no_fill || !resp.creative) {
      const reason = noFillReason(resp);
      this._finish(ctx, {
        state: reason === "unsupported_device" ? "unsupported" : "no_fill",
        reason,
        ...resp && resp.detail ? { detail: String(resp.detail) } : {}
      });
      return;
    }
    try {
      this._render(ctx, resp);
    } catch (e) {
      this._finish(ctx, { state: "failed", reason: "creative_error" });
    }
  }
  // Shared /v1/request payload (used by _show and preload).
  _requestBody(requestId, format, placement) {
    return JSON.stringify({
      publisherId: this.cfg.publisherId,
      gameId: this.cfg.gameId,
      placement,
      format,
      // format = ad format (interstitial/rewarded)
      creativeFormat: this.cfg.creativeFormat || "image",
      // image | vast | playable
      sessionId: this.sessionId,
      cell: this.cfg.cell,
      siteId: this.cfg.siteId,
      requestId,
      // Publisher price floor. It was accepted by the backend but the SDK never
      // sent it, so a publisher could not actually set one - and a test could
      // not force a real no-fill decision through the real auction.
      ...this.cfg.floorCpm != null ? { floorCpm: this.cfg.floorCpm } : {},
      // Internal harness capability. The server verifies the signature and
      // derives traffic class; there is deliberately no client-set class flag.
      ...this.cfg.diagnosticCapability ? { diagnosticCapability: this.cfg.diagnosticCapability } : {},
      consent_state: this._readConsent(),
      lang: navigator.language,
      ua: navigator.userAgent,
      // Country is a HINT, and it is labelled as one. A browser cannot prove
      // where it is; the region subtag of the locale is the cheapest honest
      // guess. Real geo is an IP lookup on the server - see geo_source, which
      // exists so reporting can never mistake this for a verified country.
      ...localeRegion() ? { geo: localeRegion(), geo_source: "client_hint" } : {},
      // Real detection by default. `deviceOverride` exists ONLY so an automated
      // harness on a desktop can exercise mobile-targeted creatives; it is opt-in,
      // named for what it is, and never set by a real integration.
      ...this.cfg.deviceOverride || detectDevice()
    });
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
    const ctrl = new AbortController();
    let timedOut = false;
    const abortTimer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, this.cfg.requestTimeoutMs);
    let r;
    try {
      r = await fetch(this.cfg.backend + "/v1/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: this._requestBody(requestId, format, placement)
      });
    } catch (e) {
      clearTimeout(abortTimer);
      return { error: timedOut ? "timeout" : "network_error" };
    }
    clearTimeout(abortTimer);
    if (!r || !r.ok) return { error: "http_error", status: r ? r.status : 0 };
    try {
      const resp = await r.json();
      if (!resp || typeof resp !== "object") return { error: "bad_response" };
      return { resp };
    } catch (e) {
      return { error: "bad_response" };
    }
  }
  // Prefetch the ad decision WITHOUT rendering, so a later showInterstitial/
  // showRewarded renders synchronously inside a user gesture. Needed when a
  // mediation adapter must pass back to a PARTNER ad on no_fill (partner ad
  // calls require user activation). Returns { filled }. The cached decision is
  // consumed by the next matching _show, or expires after preloadTtlMs.
  async preload(format, placement) {
    if (!this.cfg) throw new Error("W2A.init was not called");
    const key = format + "|" + placement;
    this._preloads = this._preloads || {};
    this._preloadSeq = this._preloadSeq || {};
    const gen = this._preloadSeq[key] = (this._preloadSeq[key] || 0) + 1;
    this._discardPreload(key, "superseded");
    const requestId = cryptoId();
    const rec = { key, gen, format, placement, requestId, state: "requesting", ts: Date.now() };
    this._preloads[key] = rec;
    const settle = (state, reason) => {
      if (this._preloads[key] === rec) {
        rec.state = state;
        rec.reason = reason;
      }
      return { filled: !!rec.resp, ready: state === "ready", reason };
    };
    const r = await this._requestAd(requestId, format, placement);
    if (this._preloadSeq[key] !== gen) {
      this._release(requestId, r.resp);
      return { filled: false, ready: false, reason: "superseded" };
    }
    if (r.error) return settle("failed", r.error);
    const resp = r.resp;
    if (!resp || resp.no_fill || !resp.creative) return settle("failed", noFillReason(resp));
    rec.resp = resp;
    rec.state = "loading";
    let creativeShowBudgetMs = Math.max(0, Number(this.cfg.billableMs) || 0);
    if (resp.creative.type === "vast") {
      creativeShowBudgetMs += Math.max(0, Number(this.cfg.videoStartTimeoutMs) || 0);
    } else if (resp.creative.type === "playable") {
      creativeShowBudgetMs = Math.max(0, Number(this.cfg.maxPlayableMs) || 0);
    }
    const showBudgetMs = creativeShowBudgetMs + (this.cfg.requestTimeoutMs || 4e3) + 2e3;
    const ttlBound = Date.now() + (this.cfg.preloadTtlMs || 3e4);
    const leaseBound = resp.reservationExpiresAt ? resp.reservationExpiresAt - showBudgetMs : Infinity;
    rec.readyUntil = Math.min(ttlBound, leaseBound);
    if (rec.readyUntil <= Date.now()) {
      this._discardPreload(key, "lease_too_short");
      return { filled: true, ready: false, reason: "lease_too_short" };
    }
    const ctx = { requestId, format, placement, preloaded: true };
    rec.ctx = ctx;
    const loadMs = this.cfg.creativeLoadTimeoutMs || 6e3;
    const outcome = await new Promise((resolve) => {
      let done = false;
      const finish = (o) => {
        if (!done) {
          done = true;
          clearTimeout(to);
          resolve(o);
        }
      };
      const to = setTimeout(() => finish({ ok: false, reason: "creative_timeout" }), loadMs);
      try {
        this._render(ctx, resp, {
          hidden: true,
          onLoaded: () => finish({ ok: true }),
          onLoadError: (reason) => finish({ ok: false, reason })
        });
      } catch (e) {
        finish({ ok: false, reason: "creative_error" });
      }
    });
    if (this._preloads[key] !== rec) {
      this._release(requestId, resp);
      return { filled: true, ready: false, reason: "superseded" };
    }
    if (!outcome.ok) {
      this._discardPreload(key, outcome.reason);
      return { filled: true, ready: false, reason: outcome.reason };
    }
    if (Date.now() > rec.readyUntil) {
      this._discardPreload(key, "preload_expired");
      return { filled: true, ready: false, reason: "preload_expired" };
    }
    rec.state = "ready";
    rec.expiryTimer = setTimeout(() => this._discardPreload(key, "preload_expired"), Math.max(0, rec.readyUntil - Date.now()));
    return { filled: true, ready: true, requestId, readinessProof: ctx.readinessProof };
  }
  /** Advisory only. The correctness gate is tryShowReady(), which claims atomically. */
  isReady(format, placement, minValidityMs = 0) {
    const rec = this._preloads && this._preloads[format + "|" + placement];
    const headroom = Math.max(0, Number(minValidityMs) || 0);
    return !!(rec && rec.state === "ready" && Date.now() + headroom <= rec.readyUntil);
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
    if (!this.cfg) return { started: false, reason: "not_initialised" };
    const key = format + "|" + placement;
    const rec = this._preloads && this._preloads[key];
    if (!rec) return { started: false, reason: "no_preload" };
    if (rec.state === "failed") {
      delete this._preloads[key];
      return { started: false, reason: rec.reason || "not_ready", requestId: rec.requestId };
    }
    if (rec.state !== "ready") return { started: false, reason: "not_ready", requestId: rec.requestId };
    if (Date.now() > rec.readyUntil) {
      this._discardPreload(key, "preload_expired");
      return { started: false, reason: "preload_expired" };
    }
    if (this.active) return { started: false, reason: "busy" };
    if (fullscreenBlocksOverlay()) return { started: false, reason: "fullscreen_conflict" };
    rec.state = "claimed";
    delete this._preloads[key];
    if (rec.expiryTimer) {
      clearTimeout(rec.expiryTimer);
      rec.expiryTimer = null;
    }
    this._activate(rec.ctx);
    return { started: true, requestId: rec.requestId };
  }
  /** Tear down a preloaded (never shown) ad and hand its reservation back. */
  _discardPreload(key, reason) {
    const rec = this._preloads && this._preloads[key];
    if (!rec || rec.state === "claimed") return;
    delete this._preloads[key];
    if (rec.expiryTimer) {
      clearTimeout(rec.expiryTimer);
      rec.expiryTimer = null;
    }
    if (rec.ctx) {
      rec.ctx.completed = true;
      if (rec.ctx.overlay) rec.ctx.overlay.remove();
    }
    const teardown = rec.ctx && showTeardown.get(rec.ctx);
    if (teardown) {
      if (teardown.playableMsg) {
        window.removeEventListener("message", teardown.playableMsg);
        teardown.playableMsg = null;
      }
      if (teardown.visHandler) {
        if (typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", teardown.visHandler);
        teardown.visHandler = null;
      }
      if (teardown.lifecycle) {
        for (const [target, type, handler] of teardown.lifecycle) {
          try {
            target.removeEventListener(type, handler, true);
          } catch {
          }
        }
        teardown.lifecycle.length = 0;
      }
      teardown.suspendForClick = null;
      teardown.resumeFromClick = null;
      teardown.rewardSnapshot = null;
      if (teardown.abortCreative) {
        teardown.abortCreative();
        teardown.abortCreative = null;
      }
      if (teardown.stopMedia) {
        try {
          teardown.stopMedia();
        } catch {
        }
        teardown.stopMedia = null;
      }
      if (teardown.timers) {
        for (const t of teardown.timers) {
          clearTimeout(t);
          clearInterval(t);
        }
        const mine = new Set(teardown.timers);
        this._timers = this._timers.filter((t) => !mine.has(t));
        teardown.timers.length = 0;
      }
    }
    rec.state = "released";
    rec.reason = reason;
    this._release(rec.requestId, rec.resp);
  }
  /**
   * Give a reservation back. Best-effort and fire-and-forget: the server sweeps
   * on TTL anyway, this just returns the budget sooner. The release capability
   * comes from the server with the bid - a bare requestId would let anyone who
   * saw an id (logs, reporting, the dashboard) cancel someone else's ad.
   */
  _release(requestId, resp) {
    const token = resp && resp.releaseToken;
    if (!token || !requestId || typeof fetch !== "function") return;
    try {
      fetch(this.cfg.backend + "/v1/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ requestId, releaseToken: token })
      }).catch(() => {
      });
    } catch (e) {
    }
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
    const hidden = !!opts.hidden;
    const win = resp && resp.decision && resp.decision.win;
    if (win) {
      ctx.campaignId = win.campaignId;
      ctx.tier = win.tier;
      ctx.priceCpm = win.priceCpm;
      if (typeof win.matched === "boolean") ctx.matched = win.matched;
    }
    const onLoaded = opts.onLoaded || (() => {
    });
    const onLoadError = opts.onLoadError || (() => {
    });
    let settledLoad = false;
    let creativeRendered = false;
    const loaded = () => {
      if (!settledLoad) {
        settledLoad = true;
        creativeRendered = true;
        onLoaded();
      }
    };
    const loadFailed = (reason) => {
      if (settledLoad) return;
      settledLoad = true;
      if (hidden) onLoadError(reason);
      else this._finish(ctx, { state: "failed", reason });
    };
    ctx._onActivate = [];
    const whenActive = (fn) => {
      if (ctx.visible) fn();
      else ctx._onActivate.push(fn);
    };
    if (!hidden) {
      ctx.paused = true;
      this._emit("w2a_pause", { ...ctx, state: "opened" });
      if (ctx.completed || this.active !== ctx) {
        this._release(ctx.requestId, resp);
        return;
      }
    }
    injectLayoutCss(document);
    const backdrop = el("div", null, { className: "w2a-backdrop" });
    backdrop.setAttribute("data-open", "true");
    backdrop.setAttribute("data-phase", "video");
    backdrop.setAttribute("data-fit", this.cfg.creativeFit || "auto");
    backdrop.setAttribute("data-crop-safe", this.cfg.cropSafe === false ? "false" : "true");
    if (this.cfg.debugOverlay === true) backdrop.setAttribute("data-debug", "true");
    const stage = el("div", null, { className: "w2a-stage" });
    const cardWrap = el("div", null, { className: "w2a-cardwrap" });
    const c = resp.creative;
    const src = (u) => new URL(u, this.cfg.backend || location.origin).href;
    const card = el("div", null, { className: "w2a-card" });
    const side = el("div", null, { className: "w2a-side" });
    const title = el("div", null, { className: "w2a-headline", textContent: c.headline || "Toon Blocks" });
    const sub = el("div", null, { className: "w2a-subtitle", textContent: c.sub || "Block puzzle \xB7 Free" });
    const cta = el("a", null, { className: "w2a-cta", textContent: "Install" });
    cta.setAttribute("data-w2a", "cta");
    cta.target = "_top";
    const rewardBtn = el("button", {
      background: "transparent",
      border: "1px solid #4b5163",
      color: "#c7ccdd",
      padding: "10px 18px",
      borderRadius: "10px",
      fontSize: "14px",
      marginTop: "4px",
      cursor: "pointer",
      display: ctx.format === "rewarded" ? "block" : "none"
    }, { textContent: ctx.format === "rewarded" ? "Watch to earn reward" : "" });
    rewardBtn.setAttribute("data-w2a", "reward");
    let rewardEarned = false;
    const paintEarned = () => {
      rewardBtn.textContent = "Reward earned - close";
      rewardBtn.style.display = "block";
      rewardBtn.style.borderColor = "#4ade80";
      rewardBtn.style.color = "#4ade80";
      rewardBtn.onclick = () => this._finish(ctx, { state: "closed" });
    };
    const evidence = createRewardEvidence();
    if (ctx.format === "rewarded") ctx.rewardEarned = false;
    const grantReward = (report) => {
      if (ctx.format !== "rewarded" || rewardEarned || ctx.completed) return;
      rewardEarned = true;
      Object.assign(ctx, report, { rewardEarned: true });
      paintEarned();
      if (closeGatedOnEndcard) unlockClose();
      this._state({ ...ctx, state: "rewarded" });
    };
    const recordVideoEvidence = (v) => {
      if (ctx.format !== "rewarded") return;
      ctx.rewardEndedSeen = v.endedSeen;
      ctx.rewardDurationMs = v.durationMs;
      ctx.rewardCoverageRatio = v.coverageRatio;
      ctx.rewardAttentionRatio = v.attentionRatio;
      ctx.rewardSeeks = v.seeks;
      ctx.rewardRejectedJumps = v.rejectedJumps;
      ctx.rewardMaxRate = v.maxRate;
    };
    const closeAfterSecs = Math.max(0, Number(this.cfg.closeAfterSecs ?? 5));
    const close = el("button", {
      // The countdown is not a button yet: taps must not land on it, or a fast
      // double-tap on the ad would close it before it was ever seen.
      pointerEvents: "none",
      cursor: "default",
      color: "#bbb"
    }, { textContent: closeAfterSecs > 0 ? String(closeAfterSecs) : "\xD7" });
    close.setAttribute("data-w2a", "close");
    const soundBtn = el("button", { display: "none" }, { textContent: "Tap for sound" });
    soundBtn.setAttribute("data-w2a", "sound");
    soundBtn.setAttribute("aria-label", "Turn sound on");
    const showMeta = this.cfg.debugOverlay === true;
    const meta = el(
      "div",
      {
        color: "#565c72",
        fontSize: "11px",
        wordBreak: "break-all",
        maxWidth: "90vw",
        textAlign: "center",
        display: showMeta ? "block" : "none"
      },
      { className: "w2a-meta", textContent: `req ${ctx.requestId.slice(0, 12)} \xB7 ${ctx.format} \xB7 ${ctx.placement}` }
    );
    cardWrap.appendChild(card);
    const app = resp.app || {};
    const icon = el("img", null, { className: "w2a-app-icon", alt: "" });
    icon.hidden = true;
    if (app.iconUrl) {
      icon.src = src(app.iconUrl);
      icon.hidden = false;
      icon.fetchPriority = "high";
      icon.decoding = "async";
      icon.addEventListener("error", () => {
        icon.hidden = true;
      }, { once: true });
    }
    if (app.name) title.textContent = app.name;
    if (app.shortDescription) sub.textContent = app.shortDescription;
    const facts = el("div", null, { className: "w2a-store-facts" });
    for (const f of [
      app.rating && app.rating.display,
      app.price && app.price.display,
      app.downloads && app.downloads.display
    ].filter(Boolean)) {
      facts.appendChild(el("span", null, { textContent: String(f) }));
    }
    facts.hidden = facts.children.length === 0;
    const storeName = el("div", null, { className: "w2a-store-name", textContent: app.storeName || "" });
    storeName.hidden = !app.storeName;
    const listing = el("div", null, { className: "w2a-listing" });
    listing.append(title, sub, facts, storeName);
    side.append(icon, listing, cta, rewardBtn, meta);
    stage.append(cardWrap, side);
    const adLabel = el("div", null, { className: "w2a-ad-label", textContent: "Advertisement" });
    adLabel.setAttribute("data-w2a", "ad-label");
    backdrop.append(adLabel, close, soundBtn, stage);
    if (hidden) backdrop.style.display = "none";
    document.body.appendChild(backdrop);
    ctx.overlay = backdrop;
    if (!hidden) {
      this.overlay = backdrop;
      ctx.visible = true;
      this._enterFullscreen(ctx);
      this._state({ ...ctx, state: "opened" });
      if (ctx.completed || this.active !== ctx) {
        this._release(ctx.requestId, resp);
        return;
      }
    }
    ctx.impStart = ctx.impStart || Date.now();
    let clickState = "BLOCKED";
    let clickSuspended = false;
    let qualified = false;
    let visAccum = 0;
    const requireVisible = this.cfg.requireVisible !== false;
    const isVideoCreative = c.type === "vast" && !!c.vastUrl;
    const isHidden = () => clickSuspended || (requireVisible || isVideoCreative) && typeof document !== "undefined" && document.hidden === true;
    ctx.visibilityEnforced = requireVisible || isVideoCreative;
    if (ctx.format === "rewarded") {
      ctx.rewardVisibilityEnforced = isVideoCreative ? true : requireVisible;
    }
    let visSince = hidden || isHidden() ? null : now();
    ctx._startVisible = () => {
      if (visSince === null && !isHidden()) visSince = now();
    };
    const visibleMs = () => visAccum + (visSince !== null ? now() - visSince : 0);
    const visibleDeadlines = [];
    const afterVisibleMs = (ms, fn) => whenActive(() => {
      let fired = false;
      let timer = null;
      let lastLeft = Infinity;
      const arm = () => {
        if (fired || ctx.completed) return;
        if (timer) {
          dropTimer(timer);
          timer = null;
        }
        const left = ms - visibleMs();
        if (left <= 0) {
          fired = true;
          fn();
          return;
        }
        if (visSince === null) {
          lastLeft = Infinity;
          return;
        }
        if (left >= lastLeft) {
          fired = true;
          fn();
          return;
        }
        lastLeft = left;
        timer = pushTimer(setTimeout(() => {
          timer = null;
          arm();
        }, left));
      };
      visibleDeadlines.push(arm);
      arm();
    });
    let onVisibilityChange = null;
    const teardown = {
      visHandler: null,
      playableMsg: null,
      rewardSnapshot: null,
      timers: [],
      // Every listener this show puts on `window` or `document` beyond the
      // visibility one, as [target, type, handler]. They come off together in
      // `_finish`; a show that leaves a `pageshow` handler behind holds its whole
      // context alive and can resume an ad that no longer exists.
      lifecycle: []
    };
    showTeardown.set(ctx, teardown);
    teardown.releaseUnbilled = () => {
      if (!qualified) this._release(ctx.requestId, resp);
    };
    const pushTimer = (t) => {
      teardown.timers.push(t);
      this._timers.push(t);
      return t;
    };
    const dropTimer = (t) => {
      clearTimeout(t);
      clearInterval(t);
      let i = teardown.timers.indexOf(t);
      if (i >= 0) teardown.timers.splice(i, 1);
      i = this._timers.indexOf(t);
      if (i >= 0) this._timers.splice(i, 1);
    };
    const visHandler = () => {
      if (onVisibilityChange) {
        try {
          onVisibilityChange();
        } catch {
        }
      }
      if (isHidden()) {
        if (visSince !== null) {
          visAccum += now() - visSince;
          visSince = null;
        }
      } else if (ctx.visible && visSince === null) visSince = now();
      for (const arm of visibleDeadlines) {
        try {
          arm();
        } catch {
        }
      }
    };
    let clickDeadlineAt = null;
    let clickTimer = null;
    const clearClickTimer = () => {
      if (clickTimer === null) return;
      dropTimer(clickTimer);
      clickTimer = null;
    };
    let clickLastLeft = Infinity;
    const armClickTimer = () => {
      clearClickTimer();
      const left = Math.max(0, clickDeadlineAt - now());
      const handle = setTimeout(() => {
        if (clickTimer !== handle) return;
        clickTimer = null;
        if (!clickSuspended || ctx.completed) return;
        const stillOwed = clickDeadlineAt - now();
        if (stillOwed > 0 && stillOwed < clickLastLeft) {
          clickLastLeft = stillOwed;
          armClickTimer();
          return;
        }
        this._finish(ctx, { state: "failed", reason: "click_return_timeout", clicked: true });
      }, left);
      clickLastLeft = left;
      clickTimer = pushTimer(handle);
    };
    const resumeFromClick = (hostConfirmed) => {
      if (!clickSuspended || ctx.completed) return false;
      if (!hostConfirmed && typeof document !== "undefined" && document.hidden === true) return false;
      if (now() >= clickDeadlineAt) {
        this._finish(ctx, { state: "failed", reason: "click_return_timeout", clicked: true });
        return false;
      }
      clearClickTimer();
      clickSuspended = false;
      if (teardown.resumeVideoDeadline) teardown.resumeVideoDeadline();
      visHandler();
      this._emit("w2a_click", { ...ctx, state: "opened", clicked: true, suspended: false, clickPhase: "returned" });
      return true;
    };
    const suspendForClick = () => {
      if (clickSuspended || ctx.completed) return false;
      if (teardown.creditVideoTail) teardown.creditVideoTail();
      if (ctx.completed) return false;
      clickSuspended = true;
      ctx.clicked = true;
      const wanted = Number(this.cfg.clickReturnTimeoutMs);
      const ceiling = Number.isFinite(wanted) && wanted >= 0 ? wanted : MAX_CLICK_SUSPEND_MS;
      clickDeadlineAt = now() + Math.min(MAX_CLICK_SUSPEND_MS, ceiling);
      if (teardown.pauseVideoDeadline) teardown.pauseVideoDeadline();
      visHandler();
      armClickTimer();
      return true;
    };
    teardown.suspendForClick = suspendForClick;
    teardown.resumeFromClick = () => resumeFromClick(true);
    const visibilityHandler = () => {
      if (clickSuspended && typeof document !== "undefined" && document.hidden !== true) {
        resumeFromClick(false);
        return;
      }
      visHandler();
    };
    teardown.visHandler = visibilityHandler;
    if (typeof document.addEventListener === "function") document.addEventListener("visibilitychange", visibilityHandler);
    const listenLifecycle = (target, type, handler) => {
      if (!target || typeof target.addEventListener !== "function") return;
      target.addEventListener(type, handler, true);
      teardown.lifecycle.push([target, type, handler]);
    };
    const returnHandler = () => {
      if (clickSuspended) resumeFromClick(false);
    };
    const pageHideHandler = (event) => {
      visHandler();
      if (!clickSuspended || event.persisted === true || ctx.completed) return;
      this._finish(ctx, { state: "failed", reason: "click_left_page", clicked: true });
    };
    listenLifecycle(typeof window !== "undefined" ? window : null, "pageshow", returnHandler);
    listenLifecycle(typeof document !== "undefined" ? document : null, "resume", returnHandler);
    listenLifecycle(typeof window !== "undefined" ? window : null, "pagehide", pageHideHandler);
    const armCTA = () => {
      if (clickState !== "BLOCKED") return;
      clickState = "READY";
      cta.href = resp.clickUrl;
      cta.style.pointerEvents = "auto";
    };
    armCTA();
    ctx.ctaGatedByImpression = false;
    let closeArmed = false;
    const unlockClose = () => {
      closeArmed = true;
      close.textContent = "\xD7";
      close.removeAttribute("data-state");
      close.style.pointerEvents = "auto";
      close.style.cursor = "pointer";
      close.style.color = "#ddd";
    };
    const closeGatedOnEndcard = ctx.format === "rewarded" && isVideoCreative;
    if (closeGatedOnEndcard) {
      const wantedRewardMs = Number(this.cfg.videoRewardMs);
      const rewardMs = Number.isFinite(wantedRewardMs) && wantedRewardMs >= 0 ? wantedRewardMs : 3e4;
      close.textContent = `Watch ${Math.ceil(rewardMs / 1e3)}s`;
      close.setAttribute("data-state", "locked");
      afterVisibleMs(rewardMs + 15e3, unlockClose);
    } else if (closeAfterSecs <= 0) unlockClose();
    else {
      const closeAt = closeAfterSecs * 1e3;
      whenActive(() => {
        const paint = setInterval(() => {
          if (ctx.completed || closeArmed) {
            clearInterval(paint);
            return;
          }
          const left = Math.ceil((closeAt - visibleMs()) / 1e3);
          close.textContent = String(Math.max(1, left));
        }, 250);
        pushTimer(paint);
      });
      afterVisibleMs(closeAt, unlockClose);
    }
    const qualify = () => {
      if (qualified || ctx.completed) return;
      qualified = true;
      ctx.impressionState = "pending";
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), this.cfg.requestTimeoutMs);
      const settle = (ok) => {
        clearTimeout(to);
        ctx.impressionState = ok ? "confirmed" : "degraded";
        ctx.impressionConfirmed = ok;
        this._emit("w2a_impression", {
          requestId: ctx.requestId,
          format: ctx.format,
          placement: ctx.placement,
          state: ctx.state || "closed",
          impressionState: ctx.impressionState,
          impressionConfirmed: ok
        });
      };
      fetch(this.cfg.backend + "/v1/impression", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        // A CTA tap navigates the top-level document, which can tear this page
        // down mid-flight. Without keepalive the browser cancels the request and
        // the advertiser is never billed for an ad that was seen AND clicked -
        // the most valuable impression there is.
        keepalive: true,
        body: JSON.stringify({
          requestId: ctx.requestId,
          impressionToken: resp.impressionToken,
          shownMs: Math.round(visibleMs()),
          freqKey: this.sessionId
        })
      }).then(async (r) => {
        if (!r || !r.ok) return settle(false);
        let body = {};
        try {
          body = await r.json() || {};
        } catch (e) {
        }
        settle(body.deduped !== true);
      }, () => settle(false));
    };
    let videoStarted = false;
    let rewardPath = "dwell";
    if (c.type === "vast" && c.vastUrl) {
      rewardPath = "video";
      const wantAudio = this.cfg.audio !== "muted";
      backdrop.setAttribute("data-kind", "video");
      const vid = el("video", null, { className: "w2a-media" });
      vid.muted = !wantAudio;
      vid.playsInline = true;
      vid.setAttribute("playsinline", "");
      card.appendChild(vid);
      ctx.audio = wantAudio ? "requested" : "muted_by_config";
      const cfgMs = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };
      const videoRewardMs = cfgMs(this.cfg.videoRewardMs, 3e4);
      const videoStartTimeoutMs = cfgMs(this.cfg.videoStartTimeoutMs, 1e4);
      const videoStallTimeoutMs = cfgMs(this.cfg.videoStallTimeoutMs, 1e4);
      const videoBillableMs = cfgMs(this.cfg.billableMs, 1e3);
      const fullRewardRatio = 0.98;
      const declaredDurationMs = cfgMs(c.durationMs, 0);
      const metadataDurationMs = () => {
        const d = Number(vid.duration) * 1e3;
        return Number.isFinite(d) && d > 0 ? d : 0;
      };
      const videoDurationMs = () => {
        const d = metadataDurationMs();
        if (d > 0) return d;
        if (declaredDurationMs > 0) return declaredDurationMs;
        const t = Number(vid.currentTime) * 1e3;
        return Number.isFinite(t) && t > 0 ? t : null;
      };
      const gatedDurationMs = () => Math.max(
        declaredDurationMs,
        metadataDurationMs(),
        ctx.format === "rewarded" ? videoRewardMs : 0
      );
      const absoluteVideoMs = () => Math.max(
        cfgMs(this.cfg.maxVideoMs, 1e4),
        videoStartTimeoutMs + gatedDurationMs() + videoStallTimeoutMs
      );
      let absoluteStartedAt = null;
      let absoluteTimer = null;
      let absoluteClickPausedAt = null;
      const armAbsoluteDeadline = () => {
        if (absoluteStartedAt === null || absoluteClickPausedAt !== null || ctx.completed) return;
        if (absoluteTimer !== null) {
          dropTimer(absoluteTimer);
          absoluteTimer = null;
        }
        const left = absoluteVideoMs() - (Date.now() - absoluteStartedAt);
        if (left <= 0) {
          this._finish(ctx, { state: "failed", reason: "vast_deadline" });
          return;
        }
        const handle = setTimeout(() => {
          if (absoluteTimer === handle) absoluteTimer = null;
          dropTimer(handle);
          armAbsoluteDeadline();
        }, left);
        absoluteTimer = pushTimer(handle);
      };
      whenActive(() => {
        absoluteStartedAt = Date.now();
        armAbsoluteDeadline();
      });
      teardown.pauseVideoDeadline = () => {
        if (absoluteStartedAt === null || absoluteClickPausedAt !== null) return;
        absoluteClickPausedAt = Date.now();
        if (absoluteTimer !== null) {
          dropTimer(absoluteTimer);
          absoluteTimer = null;
        }
      };
      teardown.resumeVideoDeadline = () => {
        if (absoluteClickPausedAt === null) return;
        if (absoluteStartedAt !== null) absoluteStartedAt += Date.now() - absoluteClickPausedAt;
        absoluteClickPausedAt = null;
        armAbsoluteDeadline();
      };
      let hasAdvanced = false;
      let lastAttentionMs = 0;
      let lastAdvanceVisibleMs = null;
      let rewardEligible = false;
      let playbackEnded = false;
      const videoIsHidden = () => clickSuspended || typeof document !== "undefined" && document.hidden === true;
      const observeVideoProgress = () => {
        const progress = evidence.verdict(videoDurationMs());
        if (progress.attentionMs > lastAttentionMs) {
          hasAdvanced = true;
          lastAttentionMs = progress.attentionMs;
          lastAdvanceVisibleMs = visibleMs();
        }
        const advancingMs = Math.min(progress.coverageMs, progress.attentionMs);
        if (hasAdvanced && advancingMs >= videoBillableMs) qualify();
        if (ctx.format === "rewarded" && !rewardEligible && hasAdvanced && advancingMs >= videoRewardMs) {
          rewardEligible = true;
          recordVideoEvidence(progress);
          const full = progress.coverageRatio != null && progress.attentionRatio != null && progress.coverageRatio >= fullRewardRatio && progress.attentionRatio >= fullRewardRatio;
          grantReward({ rewardBasis: "watched_video", rewardQuality: full ? "full" : "threshold" });
        }
        return progress;
      };
      const sampleVideo = (playing = vid.paused !== true) => {
        evidence.sample({
          mediaSec: vid.currentTime,
          wallMs: now(),
          rate: Number.isFinite(Number(vid.playbackRate)) ? Number(vid.playbackRate) : 1,
          playing,
          // `visSince !== null` is exactly "the ad is activated AND on screen" -
          // a preloaded overlay sits in the DOM with the clock stopped, so it
          // cannot bank attention before the game has shown it.
          visible: visSince !== null && !videoIsHidden()
        });
        return observeVideoProgress();
      };
      const endEpoch = (creditTail) => {
        if (creditTail) sampleVideo(true);
        evidence.break();
      };
      teardown.creditVideoTail = () => {
        try {
          endEpoch(true);
        } catch {
        }
      };
      for (const evt of ["timeupdate", "playing", "ratechange"]) {
        vid.addEventListener(evt, () => sampleVideo());
      }
      for (const evt of ["pause", "waiting"]) {
        vid.addEventListener(evt, () => endEpoch(true));
      }
      for (const evt of ["seeking", "seeked", "emptied", "error", "abort"]) {
        vid.addEventListener(evt, () => endEpoch(false));
      }
      teardown.stopMedia = () => {
        try {
          vid.pause();
        } catch {
        }
        try {
          vid.removeAttribute("src");
          vid.src = "";
          if (vid.load) vid.load();
        } catch {
        }
      };
      let pausedByHide = false;
      let startPlayback = null;
      onVisibilityChange = () => {
        endEpoch(true);
        if (videoIsHidden()) {
          if (!vid.paused) {
            pausedByHide = true;
            try {
              vid.pause();
            } catch {
            }
          }
          return;
        }
        if (!ctx.visible) return;
        if (vid.ended === true) return;
        if (!pausedByHide && !(videoStarted && vid.paused)) return;
        if (!videoStarted && startPlayback) {
          pausedByHide = false;
          startPlayback();
          return;
        }
        resumePlayback();
      };
      const resumePlayback = () => {
        try {
          const p = vid.play();
          if (p && p.then) p.then(() => {
            pausedByHide = false;
          }, () => {
            pausedByHide = true;
          });
          else pausedByHide = false;
        } catch {
          pausedByHide = true;
        }
      };
      backdrop.addEventListener("pointerdown", () => {
        if (pausedByHide && vid.paused && vid.ended !== true && !videoIsHidden()) resumePlayback();
      }, { capture: true, passive: true });
      const settleVideoReward = () => {
        const v = evidence.verdict(videoDurationMs());
        recordVideoEvidence(v);
        const fullNaturalWatch = v.endedSeen === true && vid.ended === true && v.durationMs != null && v.durationMs >= videoRewardMs && v.coverageRatio != null && v.coverageRatio >= fullRewardRatio && v.attentionRatio != null && v.attentionRatio >= fullRewardRatio;
        if (!rewardEarned && ctx.format === "rewarded" && fullNaturalWatch) {
          rewardEligible = true;
          grantReward({ rewardBasis: "watched_video", rewardQuality: "full" });
        }
        if (!rewardEarned && ctx.format === "rewarded") ctx.rewardQuality = "not_earned";
        return v;
      };
      teardown.rewardSnapshot = () => {
        endEpoch(true);
        if (vid.ended === true) evidence.end();
        settleVideoReward();
      };
      const unmute = (ev) => {
        if (ctx.audio === "audible" || !vid.muted) return;
        if (ev && ev.isTrusted === false) return;
        if (ev && ev.target && ev.target.closest && ev.target.closest('[data-w2a="close"]')) return;
        vid.muted = false;
        ctx.audio = "audible";
        soundBtn.style.display = "none";
        const p = vid.play();
        if (p && p.catch) p.catch(() => {
          vid.muted = true;
          ctx.audio = "muted_by_policy";
          soundBtn.style.display = "block";
        });
      };
      const offerUnmute = () => {
        soundBtn.style.display = "block";
        soundBtn.addEventListener("click", unmute);
        backdrop.addEventListener("pointerdown", unmute, { capture: true, passive: true });
      };
      vid.addEventListener("loadeddata", () => {
        if (vid.videoWidth > 0 && vid.readyState >= 2) loaded();
      });
      vid.addEventListener("error", () => loadFailed("vast_media_error"), { once: true });
      const creativeAbort = new AbortController();
      teardown.abortCreative = () => {
        try {
          creativeAbort.abort();
        } catch {
        }
      };
      let completeTrackers = [];
      let completionTracked = false;
      const fireCompletionTrackers = () => {
        if (completionTracked) return;
        completionTracked = true;
        for (const tracker of completeTrackers) {
          try {
            const p = fetch(src(tracker), {
              method: "GET",
              mode: "no-cors",
              credentials: "omit",
              keepalive: true,
              cache: "no-store"
            });
            if (p && p.catch) p.catch(() => {
            });
          } catch {
          }
        }
      };
      fetch(src(c.vastUrl), { signal: creativeAbort.signal }).then((r) => {
        if (!r || !r.ok) throw new Error("vast_http");
        return r.text();
      }).then((xml) => {
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        completeTrackers = [...doc.querySelectorAll('Tracking[event="complete"]')].map((node) => String(node.textContent || "").trim()).filter(Boolean);
        const murl = pickMediaFile(doc.querySelectorAll("MediaFile"), viewportRatio());
        if (!murl) {
          loadFailed("vast_no_media");
          return;
        }
        let audioSettled = false;
        const tryPlay = () => whenActive(() => {
          if (videoIsHidden()) {
            pausedByHide = true;
            return;
          }
          const p = vid.play();
          if (!p || !p.catch) return;
          p.catch((err) => {
            if (!err || err.name !== "NotAllowedError") return;
            if (audioSettled || vid.muted) return;
            audioSettled = true;
            vid.muted = true;
            ctx.audio = "muted_by_policy";
            offerUnmute();
            const again = vid.play();
            if (again && again.catch) again.catch(() => {
            });
          });
        });
        startPlayback = tryPlay;
        vid.addEventListener("loadeddata", tryPlay, { once: true });
        vid.addEventListener("canplay", tryPlay, { once: true });
        vid.src = src(murl);
        tryPlay();
      }).catch(() => loadFailed("vast_fetch_failed"));
      vid.addEventListener("ended", () => {
        if (ctx.completed || vid.ended !== true) return;
        endEpoch(true);
        evidence.end();
        playbackEnded = true;
        fireCompletionTrackers();
        settleVideoReward();
        backdrop.setAttribute("data-phase", "endcard");
        if (closeGatedOnEndcard) unlockClose();
      });
      vid.addEventListener("loadedmetadata", () => {
        const b = ratioBucket(vid.videoWidth, vid.videoHeight);
        if (b) backdrop.setAttribute("data-ratio", b);
        armAbsoluteDeadline();
      });
      vid.addEventListener("playing", () => {
        videoStarted = true;
        if (ctx.audio !== "muted_by_config") ctx.audio = vid.muted ? "muted_by_policy" : "audible";
      }, { once: true });
      afterVisibleMs(videoStartTimeoutMs, () => {
        sampleVideo();
        if (!hasAdvanced) this._finish(ctx, { state: "failed", reason: "vast_never_advanced" });
      });
      whenActive(() => {
        const periodMs = Math.max(10, Math.min(250, Math.max(10, videoStallTimeoutMs / 4)));
        const stallTimer = setInterval(() => {
          if (ctx.completed) {
            clearInterval(stallTimer);
            return;
          }
          if (playbackEnded || vid.ended === true) {
            clearInterval(stallTimer);
            return;
          }
          if (!hasAdvanced || lastAdvanceVisibleMs === null) return;
          sampleVideo();
          if (visibleMs() - lastAdvanceVisibleMs >= videoStallTimeoutMs) {
            clearInterval(stallTimer);
            this._finish(ctx, { state: "failed", reason: "vast_stalled" });
          }
        }, periodMs);
        pushTimer(stallTimer);
      });
    } else if (c.type === "playable" && c.url) {
      backdrop.setAttribute("data-kind", "playable");
      const ifr = el("iframe", null, { className: "w2a-frame" });
      const pw = Number(c.width), ph = Number(c.height);
      if (pw > 0 && ph > 0) {
        ifr.setAttribute("data-w2a-ar", `${pw}x${ph}`);
        ifr.style.setProperty("--w2a-ar", String(pw / ph));
        ctx.playableSizing = "declared";
      } else {
        ctx.playableSizing = "responsive";
      }
      ifr.setAttribute("sandbox", "allow-scripts");
      ifr.src = src(c.url);
      card.appendChild(ifr);
      const playableMsg = (e) => {
        if (e.source !== ifr.contentWindow) return;
        if (!e.data || e.data.w2a !== "playable") return;
        if (e.data.type === "ready" || e.data.type === "load_complete") {
          ctx.readinessProof = "strong";
          loaded();
        }
        if (e.data.type === "complete") {
          ctx.playableCompleteSeen = true;
          backdrop.setAttribute("data-phase", "endcard");
        }
        if (e.data.type === "cta") cta.click();
      };
      teardown.playableMsg = playableMsg;
      window.addEventListener("message", playableMsg);
      ifr.addEventListener("load", () => {
        if (!ctx.readinessProof) ctx.readinessProof = "weak";
        loaded();
        afterVisibleMs(this.cfg.billableMs, qualify);
      }, { once: true });
      afterVisibleMs(this.cfg.maxPlayableMs, () => {
        if (!qualified) this._finish(ctx, { state: "failed", reason: "playable_never_loaded" });
      });
    } else if (c.type === "image" && c.url) {
      backdrop.setAttribute("data-kind", "image");
      backdrop.setAttribute("data-phase", "endcard");
      const img = el("img", null, { className: "w2a-media", alt: c.headline || "ad" });
      img.addEventListener("load", () => {
        const b = ratioBucket(img.naturalWidth, img.naturalHeight);
        if (b) backdrop.setAttribute("data-ratio", b);
        const done = () => {
          ctx.readinessProof = "strong";
          loaded();
        };
        if (typeof img.decode === "function") img.decode().then(done, () => loadFailed("image_decode_failed"));
        else done();
        afterVisibleMs(this.cfg.billableMs, qualify);
      }, { once: true });
      img.addEventListener("error", () => loadFailed("image_load_failed"), { once: true });
      card.appendChild(img);
      img.src = src(c.url);
    } else {
      card.appendChild(el("div", { color: "#fff", fontSize: "30px", fontWeight: "800" }, { textContent: c.headline || "Toon Blocks" }));
      ctx.readinessProof = "strong";
      loaded();
      afterVisibleMs(this.cfg.billableMs, qualify);
    }
    const closedEvent = (extra = {}) => ({
      state: "closed",
      ...ctx.format === "rewarded" && rewardPath === "video" && !rewardEarned ? { reason: "closed_before_reward" } : {},
      ...extra
    });
    cta.addEventListener("click", (e) => {
      if (clickState !== "READY") {
        e.preventDefault();
        return;
      }
      if (!e.isTrusted && !this.cfg.allowSyntheticClicks) {
        e.preventDefault();
        return;
      }
      clickState = "CLICKED";
      cta.style.pointerEvents = "none";
      if (!e.isTrusted) ctx.synthetic = true;
      if (!suspendForClick()) return;
      this._emit("w2a_click", { ...ctx, state: "opened", clicked: true, suspended: true, clickPhase: "suspended" });
    });
    if (ctx.format === "rewarded") {
      const wanted = Number(this.cfg.rewardSecs);
      const floorMs = Math.max(1e3, (Number.isFinite(wanted) && wanted > 0 ? wanted : 5) * 1e3);
      const byDwell = rewardPath !== "video";
      const grantDwell = () => {
        if (rewardEarned || !byDwell) return false;
        if (!creativeRendered) return false;
        if (visibleMs() < floorMs) return false;
        grantReward({
          rewardBasis: "visible_dwell",
          // Never `full`: dwell is a policy, not proof that anything was
          // watched, and a partner must be able to tell the two apart.
          rewardQuality: "dwell_only",
          rewardVisibleMs: Math.round(visibleMs())
        });
        return true;
      };
      if (byDwell) teardown.rewardSnapshot = grantDwell;
      whenActive(() => {
        if (!byDwell) {
          const configured = Number(this.cfg.videoRewardMs);
          const seconds = Math.ceil((Number.isFinite(configured) && configured >= 0 ? configured : 3e4) / 1e3);
          rewardBtn.textContent = `Watch ${seconds} seconds to earn reward`;
          if (closeGatedOnEndcard) rewardBtn.style.display = "none";
          return;
        }
        rewardBtn.textContent = `Reward in ${Math.ceil(floorMs / 1e3)}s\u2026`;
        const t = setInterval(() => {
          if (rewardEarned || ctx.completed) {
            clearInterval(t);
            return;
          }
          const leftMs = floorMs - visibleMs();
          if (leftMs > 0) {
            rewardBtn.textContent = `Reward in ${Math.ceil(leftMs / 1e3)}s\u2026`;
            return;
          }
          clearInterval(t);
          if (!grantDwell()) rewardBtn.textContent = "Ad did not load";
        }, 250);
        pushTimer(t);
      });
    }
    close.addEventListener("click", () => {
      if (closeArmed) this._finish(ctx, closedEvent());
    });
  }
  /**
   * Make a prepared (hidden) ad visible. This is the LOOM_VISIBLE boundary and
   * it is deliberately synchronous: it is called from inside the game's click
   * handler, so it must not await anything or the user gesture is lost.
   */
  _activate(ctx) {
    if (ctx.visible || ctx.completed) return;
    if (ctx.overlay) ctx.overlay.style.display = "flex";
    this.overlay = ctx.overlay;
    this.active = ctx;
    ctx.visible = true;
    ctx.impStart = Date.now();
    if (ctx._startVisible) ctx._startVisible();
    ctx.paused = true;
    this._emit("w2a_pause", { ...ctx, state: "opened" });
    if (ctx.completed || this.active !== ctx) return;
    const queued = ctx._onActivate || [];
    ctx._onActivate = [];
    for (const fn of queued) {
      try {
        fn();
      } catch (e) {
      }
    }
    this._enterFullscreen(ctx);
    this._state({ ...ctx, state: "opened" });
  }
  /**
   * What surface can this SDK actually deliver, here, right now? Callable
   * before any ad runs, so a publisher can fix their iframe attributes rather
   * than discover the limit from a QA sheet that says "FAILED".
   */
  capabilities() {
    const framed = isFramed();
    const fs = fullscreenAllowed();
    return {
      framed,
      fullscreenAllowed: fs,
      // What we would achieve for an ad shown right now.
      coverage: !framed ? "window" : fs ? "screen_if_gesture" : "document",
      viewport: typeof window !== "undefined" ? [window.innerWidth, window.innerHeight] : null
    };
  }
  _watchFullscreen(ctx) {
    if (ctx._fsWatch || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    ctx._fsWatch = () => {
      if (!document.fullscreenElement && ctx.fullscreenOwned) {
        ctx.fullscreenOwned = false;
        ctx.fullscreen = "exited_by_user";
        ctx.presentation = "document";
      }
    };
    document.addEventListener("fullscreenchange", ctx._fsWatch);
  }
  _fullscreenEntered(ctx) {
    const successor = ctx.completed && this.active !== ctx ? this.active : null;
    if (successor && !successor.completed && successor.visible && successor.overlay) {
      ctx.fullscreenOwned = false;
      successor.fullscreen = "entered";
      successor.presentation = "screen";
      successor.fullscreenOwned = true;
      this._watchFullscreen(successor);
      return;
    }
    ctx.fullscreen = "entered";
    ctx.presentation = "screen";
    ctx.fullscreenOwned = true;
    if (ctx.completed) this._exitFullscreen(ctx);
    else this._watchFullscreen(ctx);
  }
  _trackFullscreen(ctx, pending) {
    if (!pending || typeof pending.then !== "function") return;
    ctx._fsPending = pending;
    pending.then(() => {
      if (ctx._fsPending !== pending) return;
      ctx._fsPending = null;
      this._fullscreenEntered(ctx);
    }, () => {
      if (ctx._fsPending !== pending) return;
      ctx._fsPending = null;
      if (!ctx.completed) ctx.fullscreen = "denied";
    });
  }
  /**
   * Fullscreen is a property of a show, not a state of it: it never changes
   * whether the ad appears, only how much of the screen it covers, and the
   * outcome is recorded on ctx so every event carries the truth.
   */
  _enterFullscreen(ctx) {
    ctx.framed = isFramed();
    ctx.presentation = "document";
    if (foreignFullscreen() && !fullscreenBlocksOverlay()) {
      ctx.fullscreen = "inherited";
      ctx.presentation = "screen";
      return;
    }
    if (!ctx.framed && !browserChromeVisible()) {
      ctx.fullscreen = "unnecessary";
      ctx.presentation = "window";
      return;
    }
    if (!fullscreenAllowed()) {
      ctx.fullscreen = "unavailable";
      return;
    }
    if (foreignFullscreen()) {
      ctx.fullscreen = "inherited";
      ctx.presentation = "screen";
      return;
    }
    if (!hasActivation()) {
      ctx.fullscreen = "no_activation";
      this._armFullscreenRetry(ctx);
      return;
    }
    const root = document.documentElement;
    if (!root || typeof root.requestFullscreen !== "function") {
      ctx.fullscreen = "unavailable";
      return;
    }
    ctx.fullscreen = "requested";
    try {
      const p = root.requestFullscreen();
      if (p && p.then) this._trackFullscreen(ctx, p);
      this._watchFullscreen(ctx);
    } catch {
      ctx._fsPending = null;
      if (!ctx.completed) ctx.fullscreen = "denied";
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
    const root = typeof document !== "undefined" && document.documentElement;
    if (!ctx.overlay || !root || typeof root.requestFullscreen !== "function") return;
    ctx._fsRetry = () => {
      ctx._fsRetry = null;
      if (ctx.completed || ctx.fullscreen !== "no_activation") return;
      if (foreignFullscreen()) {
        ctx.fullscreen = "inherited";
        ctx.presentation = "screen";
        return;
      }
      ctx.fullscreen = "requested";
      try {
        const p = root.requestFullscreen();
        if (p && p.then) this._trackFullscreen(ctx, p);
      } catch {
        ctx._fsPending = null;
        if (!ctx.completed) ctx.fullscreen = "denied";
      }
    };
    ctx.overlay.addEventListener("pointerdown", ctx._fsRetry, { once: true, capture: true });
  }
  _exitFullscreen(ctx) {
    if (ctx._fsWatch) {
      document.removeEventListener("fullscreenchange", ctx._fsWatch);
      ctx._fsWatch = null;
    }
    if (ctx._fsRetry) {
      if (ctx.overlay) ctx.overlay.removeEventListener("pointerdown", ctx._fsRetry, { capture: true });
      ctx._fsRetry = null;
    }
    if (!ctx.fullscreenOwned) return;
    ctx.fullscreenOwned = false;
    try {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {
      });
    } catch {
    }
  }
  _finish(ctx, ev) {
    if (ctx.completed) return;
    const teardown = showTeardown.get(ctx);
    if (teardown) {
      if (teardown.finishing) return;
      teardown.finishing = true;
      const snap = teardown.rewardSnapshot;
      teardown.rewardSnapshot = null;
      if (snap) {
        try {
          snap();
        } catch {
        }
      }
    }
    if (ev && ev.reason === "closed_before_reward" && ctx.rewardEarned === true) {
      ev = { ...ev };
      delete ev.reason;
    }
    ctx.completed = true;
    if (teardown && teardown.releaseUnbilled) {
      const releaseUnbilled = teardown.releaseUnbilled;
      teardown.releaseUnbilled = null;
      try {
        releaseUnbilled();
      } catch {
      }
    }
    if (teardown && teardown.timers) {
      for (const t of teardown.timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      const mine = new Set(teardown.timers);
      this._timers = this._timers.filter((t) => !mine.has(t));
      teardown.timers.length = 0;
    }
    if (teardown) {
      if (teardown.playableMsg) {
        window.removeEventListener("message", teardown.playableMsg);
        teardown.playableMsg = null;
      }
      if (teardown.visHandler) {
        if (typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", teardown.visHandler);
        teardown.visHandler = null;
      }
      if (teardown.lifecycle) {
        for (const [target, type, handler] of teardown.lifecycle) {
          try {
            target.removeEventListener(type, handler, true);
          } catch {
          }
        }
        teardown.lifecycle.length = 0;
      }
      teardown.suspendForClick = null;
      teardown.resumeFromClick = null;
      if (teardown.abortCreative) {
        teardown.abortCreative();
        teardown.abortCreative = null;
      }
    }
    this._exitFullscreen(ctx);
    if (teardown && teardown.stopMedia) {
      try {
        teardown.stopMedia();
      } catch {
      }
      teardown.stopMedia = null;
    }
    if (ctx.overlay) {
      ctx.overlay.remove();
      if (this.overlay === ctx.overlay) this.overlay = null;
    }
    if (this.active === ctx) this.active = null;
    if (ctx.paused) this._emit("w2a_resume", { ...ctx, ...ev, paused: false });
    this._state({ ...ctx, ...ev });
  }
  _state(s) {
    if (!STATES.includes(s.state)) return;
    if (!this.cfg || this.cfg.quiet !== true) explainSilence(s, this._explained || (this._explained = /* @__PURE__ */ new Set()));
    this._emit("ad_state", s);
  }
};
var SILENT_STATES = { no_fill: 1, unsupported: 1, failed: 1 };
var WHY = {
  unsupported_device: "this device is not eligible - the demand here is mobile-only, so a desktop browser draws no bid at all",
  no_bid: "no campaign bid for this request - genre, country, budget or frequency cap",
  rate_limited: "the ad server is rate-limiting this publisher",
  creative_error: "the creative failed to render; this one IS a bug on our side - please send the requestId",
  timeout: "the ad server did not answer in time"
};
function explainSilence(s, explained) {
  if (!SILENT_STATES[s.state]) return;
  const key = s.state + ":" + (s.reason || "");
  if (explained.has(key)) return;
  explained.add(key);
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  console.warn(
    `[W2A] no ad was shown (${s.state}): ${WHY[s.reason] || s.reason || "no reason given"}` + (s.detail ? ` \xB7 ${s.detail}` : "") + ` \xB7 requestId ${s.requestId || "n/a"} \xB7 shown once per reason; W2A.on("ad_state", fn) reports every one`
  );
}
function noFillReason(resp) {
  const r = resp && resp.reason;
  if (r === "unsupported_device" || r === "rate_limited") return r;
  return "no_bid";
}
function detectDevice() {
  try {
    const ua = navigator.userAgent || "";
    const uad = navigator.userAgentData;
    let os = "unknown";
    if (/Android/i.test(ua)) os = "android";
    else if (/iPhone|iPad|iPod/i.test(ua) || /Macintosh/.test(ua) && navigator.maxTouchPoints > 1) os = "ios";
    else if (/Windows/i.test(ua)) os = "windows";
    else if (/Mac OS X|Macintosh/i.test(ua)) os = "macos";
    else if (/Linux|X11/i.test(ua)) os = "linux";
    let device_type = "unknown";
    if (/iPad/i.test(ua) || /Android/i.test(ua) && !/Mobile/i.test(ua)) device_type = "tablet";
    else if (uad && typeof uad.mobile === "boolean") device_type = uad.mobile ? "mobile" : "desktop";
    else if (/Mobi|iPhone|iPod/i.test(ua)) device_type = "mobile";
    else if (os === "windows" || os === "macos" || os === "linux") device_type = "desktop";
    if ((os === "android" || os === "ios") && device_type === "desktop") {
      device_type = /Mobi|iPhone|iPod/i.test(ua) ? "mobile" : "tablet";
    }
    return { os, device_type };
  } catch (e) {
    return { os: "unknown", device_type: "unknown" };
  }
}
function localeRegion() {
  try {
    const l = navigator.languages && navigator.languages[0] || navigator.language || "";
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})$/.exec(String(l));
    return m ? m[1].toUpperCase() : null;
  } catch (e) {
    return null;
  }
}
var _nowFn = null;
function now() {
  if (_nowFn) return _nowFn();
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}
function cryptoId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
var W2A = new W2ASDK();
if (typeof window !== "undefined") window.W2A = W2A;
export {
  W2A,
  createRewardEvidence
};
