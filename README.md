# @w2a/sdk

W2A web-to-app ad SDK for **web games** (Portal Tag runtime). Shows genre-matched
interstitial / rewarded ads (image · VAST video · playable HTML5) and drives a
qualified impression + clickout to the app store.

**Integrating?** The host to talk to, the install-postback contract and what our
responses mean are in [INTEGRATION.md](INTEGRATION.md). Read it before configuring
anything - the endpoint is not the one older documents give.

## Install / include

CDN (IIFE, global `W2A`). Pin a version and use Subresource Integrity so a
compromised CDN can't inject code:
```html
<script src="https://cdn.jsdelivr.net/gh/voldcs/w2a-sdk-public@0.1.3/dist/w2a-sdk.min.js"
        integrity="sha384-DEz0fmD3teaatXYvlwDAleeFodVLQQEApHEl/8tDKkgEoI1NhHMCRxlHP4t6I9uf"
        crossorigin="anonymous"></script>
```

npm (ESM):
```js
import { W2A } from '@w2a/sdk'
```

## Use

```js
const sdk = W2A.init({
  backend: 'https://w2a-ads-demo.azurewebsites.net',   // see INTEGRATION.md
  publisherId: 'your-pub-id',
  gameId: 'your-game-id',        // -> genre via the catalog
  creativeFormat: 'image',       // 'image' | 'vast' | 'playable'
})

// Subscribe before claiming a ready ad because `opened` can be synchronous.
W2A.on('ad_state', (e) => {
  // e.state: loading | opened | closed | rewarded | failed | no_fill | unsupported
  if (e.state === 'no_fill') { /* fall back to your mediation */ }
})

// Prepare shortly before the ad opportunity. A preload is single-use and has
// a short lease, so prepare again after every show or failed claim.
async function prepareInterstitial() {
  const prepared = await sdk.preload('interstitial', 'level_end')
  levelEndButton.disabled = !prepared.ready
}
void prepareInterstitial()

// Run this directly from a trusted click or pointer event. The claim is
// synchronous, preserving browser user activation for fullscreen and audio.
levelEndButton.addEventListener('click', () => {
  const claim = sdk.tryShowReady('interstitial', 'level_end')
  if (!claim.started) showPartnerInterstitial()
})

// rewarded: use one latch per show, then dispose it on the terminal
const placement = 'continue'
let requestId = null
let rewardEarned = false
const off = W2A.on('ad_state', (e) => {
  if (e.format !== 'rewarded' || e.placement !== placement) return
  if (requestId && e.requestId !== requestId) return
  requestId ||= e.requestId
  if (e.state === 'rewarded') rewardEarned = true
  if (['closed', 'failed', 'no_fill', 'unsupported'].includes(e.state)) {
    off()
    if (rewardEarned) grantReward()
  }
})

async function prepareRewarded() {
  const prepared = await sdk.preload('rewarded', 'continue')
  continueButton.disabled = !prepared.ready
}
void prepareRewarded()
continueButton.addEventListener('click', () => {
  const claim = sdk.tryShowReady('rewarded', 'continue')
  if (!claim.started) showPartnerRewarded()
})
```

`showInterstitial()` and `showRewarded()` remain available for hosts that do not
need an in-gesture partner fallback. Mediation integrations should use
`preload()` plus `tryShowReady()` so either W2A or the partner starts inside the
same user gesture.

## Rewarded video timing

Rewarded VAST video defaults to `videoRewardMs: 30000`. The gate counts credible
advancing playback, not time since the overlay opened. Paused, buffering,
seeking, over-speed and hidden-tab stretches do not buy the reward. Eligibility
latches at the threshold and remains earned until the terminal event.
An exact-duration 30-second creative can naturally end between browser samples;
the SDK accepts that boundary only when both credible coverage and attention are
at least 98%. A natural `ended` event alone never earns the publisher reward.

Billing is independent: `billableMs` defaults to one second of the same credible
playback. Closing before the reward keeps any qualified impression and emits a
terminal with `rewardEarned: false` and `reason: 'closed_before_reward'`. A VAST
`complete` tracker fires only on the media element's natural `ended` event.

The video clocks are separate:

- `requestTimeoutMs` bounds the ad request.
- `videoStartTimeoutMs` bounds the wait for the first genuine media advance.
- `videoStallTimeoutMs` resets on every genuine advance.
- `videoRewardMs` is the rewarded playback gate.
- `maxVideoMs` is a legacy absolute total. The SDK raises a value that is too
  short for startup plus the declared creative or reward duration plus stall.

`rewardSecs` applies only to image, text and playable dwell rewards.

## Unity WebGL
See `home-makeover-integration/` for the InstantGamesBridge shim
(`w2a-bridge-shim.js`) that routes Unity bridge ad calls to this SDK with
platform passback.

## States
`loading -> opened -> closed` (interstitial) ·
`loading -> opened -> rewarded -> closed` (rewarded) ·
`loading -> no_fill | failed | unsupported` (terminal). Every show emits at most
one terminal; `rewarded` is a non-terminal eligibility latch.

## Build
```
npm run build   # -> dist/w2a-sdk.esm.js + dist/w2a-sdk.min.js
```

Version 0.1.3 · demo/preview grade. Release hashes and the canonical core commit
are recorded in `release.json`.
