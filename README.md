# @w2a/sdk

W2A web-to-app ad SDK for **web games** (Portal Tag runtime). Shows genre-matched
interstitial / rewarded ads (image · VAST video · playable HTML5) and drives a
qualified impression + clickout to the app store.

The serving endpoint, generic MMP postback contract, and AppsFlyer field mapping
are documented in [INTEGRATION.md](INTEGRATION.md).

## Release status

**Release status: not published.** At the 2026-08-07 pre-release check, the
repository was private, the 0.1.3 tag was absent, and jsDelivr and npm were
unavailable. The snippets below identify the intended immutable release. Do not
integrate them until the exact CDN URL returns JavaScript and its SHA-256 and SRI
match `release.json`.

## Install / include after publication

CDN (IIFE, global `W2A`). Pin a version and use Subresource Integrity so a
compromised CDN can't inject code:
```html
<script src="https://cdn.jsdelivr.net/gh/voldcs/w2a-sdk-public@0.1.3/dist/w2a-sdk.min.js"
        integrity="sha384-/H27mjD0D85KMJ1d1xyTz03f7VUAyTDZjEG+dJiVaDGClsX8YQt48kLEu+QOAO5o"
        crossorigin="anonymous"></script>
```

npm (ESM, only after registry publication):
```js
import { W2A } from '@w2a/sdk'
```

## Use

```js
const sdk = W2A.init({
  backend: 'https://w2a-ads-demo.azurewebsites.net',
  publisherId: 'your-pub-id',
  gameId: 'your-game-id',        // -> genre via the catalog
  creativeFormat: 'image',       // 'image' | 'vast' | 'playable'
})

const TERMINAL = new Set(['closed', 'failed', 'no_fill', 'unsupported'])
const READY_HEADROOM_MS = 5000

const preparations = new Map()
function prepareAd(format, placement) {
  if (typeof sdk.isReady === 'function' && sdk.isReady(format, placement, READY_HEADROOM_MS)) {
    return Promise.resolve({ filled: true, ready: true })
  }
  const key = `${format}|${placement}`
  if (preparations.has(key)) return preparations.get(key)
  let started
  try {
    started = sdk.preload(format, placement)
  } catch {
    started = { filled: false, ready: false, reason: 'preload_threw' }
  }
  const task = Promise.resolve(started)
    .catch(() => ({ filled: false, ready: false, reason: 'preload_failed' }))
    .finally(() => { if (preparations.get(key) === task) preparations.delete(key) })
  preparations.set(key, task)
  return task
}
function prepareInterstitial() {
  return prepareAd('interstitial', 'level_end')
}
// This boot request is only a first-opportunity hedge. Call this lifecycle hook
// again when a level is almost complete so an expired 30-second slot refreshes.
void prepareInterstitial()
function onLevelAlmostComplete() {
  void prepareInterstitial()
}
let adOpportunityBusy = false

// This global listener is for diagnostics only. Each show below owns its own
// correlated listener because a stale terminal must never release a new show.
W2A.on('ad_state', (e) => {
  // e.state: loading | opened | closed | rewarded | failed | no_fill | unsupported
  if (TERMINAL.has(e.state)) { /* report diagnostics; click-time passback is below */ }
})

// Call the atomic claim directly from the trusted click. If W2A is not ready,
// hand the same gesture to the platform fallback.
levelEndButton.addEventListener('click', () => {
  if (adOpportunityBusy) return
  adOpportunityBusy = true
  const placement = 'level_end'
  let requestId = null
  const off = W2A.on('ad_state', (e) => {
    if (e.format !== 'interstitial' || e.placement !== placement || !e.requestId) return
    if (requestId && e.requestId !== requestId) return
    requestId ||= e.requestId
    if (!TERMINAL.has(e.state)) return
    off()
    adOpportunityBusy = false
    void prepareInterstitial()
  })
  const claim = sdk.tryShowReady('interstitial', placement)
  if (claim.started) {
    if (!requestId) requestId = claim.requestId || null
    return
  }
  off()
  if (claim.reason === 'busy') {
    adOpportunityBusy = false
    return
  }
  let partnerShow
  try {
    // Host contract: start synchronously in this click stack and return its
    // completion Promise so the busy guard spans the partner overlay too.
    partnerShow = showPartnerInterstitial()
  } catch {
    adOpportunityBusy = false
    void prepareInterstitial()
    return
  }
  void prepareInterstitial()
  void Promise.resolve(partnerShow)
    .catch(() => {})
    .finally(() => { adOpportunityBusy = false })
})

function prepareRewarded() {
  return prepareAd('rewarded', 'continue')
}
// Call this when Continue becomes likely or visible. The click handler remains
// atomic; this async hook only makes a fresh creative ready beforehand.
void prepareRewarded()
function onContinueOpportunity() {
  void prepareRewarded()
}
continueButton.addEventListener('click', () => {
  if (adOpportunityBusy) return
  adOpportunityBusy = true
  // Every show owns a fresh listener and latch. Install the listener before the
  // claim because activation emits `opened` synchronously.
  const placement = 'continue'
  let requestId = null
  let rewardEarned = false
  const off = W2A.on('ad_state', (e) => {
    if (e.format !== 'rewarded' || e.placement !== placement) return
    if (!e.requestId) return
    if (requestId && e.requestId !== requestId) return
    requestId ||= e.requestId
    if (e.state === 'rewarded') rewardEarned = true
    if (TERMINAL.has(e.state)) {
      off()
      adOpportunityBusy = false
      void prepareRewarded()
      if (rewardEarned) grantReward()
    }
  })
  const claim = sdk.tryShowReady('rewarded', placement)
  if (claim.started && !requestId) requestId = claim.requestId || null
  if (!claim.started) {
    off()
    if (claim.reason === 'busy') {
      adOpportunityBusy = false
      return
    }
    // Host contract: start the partner SDK synchronously in this call stack and
    // return true, false, or a Promise<boolean> when its reward decision is final.
    let partnerShow
    try {
      partnerShow = showPartnerRewarded()
    } catch {
      adOpportunityBusy = false
      void prepareRewarded()
      return
    }
    // Hedge the next opportunity while the partner owns this one. The explicit
    // near-opportunity hook still refreshes it if this reservation expires.
    void prepareRewarded()
    const finishPartnerShow = (earned) => {
      try {
        if (earned === true) grantReward()
      } finally {
        adOpportunityBusy = false
        void prepareRewarded()
      }
    }
    void Promise.resolve(partnerShow)
      .then(finishPartnerShow, () => finishPartnerShow(false))
      .catch(() => {})
  }
})
```

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
Load the classic `dist/w2a-sdk.iife.js` bundle before the Unity loader. A bridge
shim can then route `InstantGamesBridge` ad calls to this SDK with platform
passback.

## States
`loading -> opened -> closed` (interstitial) ·
`loading -> opened -> rewarded -> closed` (rewarded) ·
`loading -> no_fill | failed | unsupported` (terminal). Every show emits at most
one terminal; `rewarded` is a non-terminal eligibility latch.

## Build

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

The build is pinned to official `esbuild` 0.28.1 and must reproduce all three
committed bundles byte-for-byte. Version 0.1.3, demo/preview grade. Release
hashes and the canonical core commit are recorded in `release.json`.
