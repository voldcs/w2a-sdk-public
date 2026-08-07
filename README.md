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
<script src="https://cdn.jsdelivr.net/gh/voldcs/w2a-sdk-public@0.1.2/dist/w2a-sdk.min.js"
        integrity="sha384-hjIGMxdPXn5EpkW8GQQYQbZGtXyQiRPOracEw/YA+ZidgTAAV+nFy8omWwM4ONY0"
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

// rewarded (reward only on the 'rewarded' state):
let rewarded = false
W2A.on('ad_state', (e) => {
  if (e.format !== 'rewarded') return
  if (e.state === 'rewarded') rewarded = true
  if (e.state === 'closed' && rewarded) grantReward()
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

## Unity WebGL
See `home-makeover-integration/` for the InstantGamesBridge shim
(`w2a-bridge-shim.js`) that routes Unity bridge ad calls to this SDK with
platform passback.

## States
`loading -> opened -> closed` (interstitial) ·
`loading -> opened -> rewarded -> closed` (rewarded) ·
`loading -> no_fill | failed | unsupported` (terminal). Callbacks are exactly-once.

## Build
```
npm run build   # -> dist/w2a-sdk.esm.js + dist/w2a-sdk.min.js
```

Version 0.1.2 · demo/preview grade. Release hashes and the canonical core commit
are recorded in `release.json`.
