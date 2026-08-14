# @w2a/sdk

W2A web-to-app ad SDK for **web games** (Portal Tag runtime). Shows genre-matched
interstitial / rewarded ads (image · VAST video · playable HTML5) and drives a
qualified impression + clickout to the app store.

The serving endpoint, generic MMP postback contract, and AppsFlyer field mapping
are documented in [INTEGRATION.md](INTEGRATION.md).

## Release status

**Release status: prepared, not yet published on the CDN.** Version 0.3.0
supersedes 0.2.3. Successful gesture-safe claims now expose one correlated
terminal `AdResult`, and `showAd()` returns the same result for direct shows.
The legacy `showInterstitial()` and `showRewarded()` setup timing is unchanged.
The bundled integrations use `claim.result` as terminal authority and do not
start a partner ad over `busy` or `fullscreen_conflict`. At the
2026-08-14T19:14:33Z check, the immutable 0.3.0 tag was present and the exact
CDN URL below returned 57,735 bytes of JavaScript whose SHA-256 and SRI match
`release.json`. The scoped registry probe for `@w2a/sdk` returned HTTP 404, so
this release procedure did not publish it through npm.

## Install / include

CDN (IIFE, global `W2A`). Pin a version and use Subresource Integrity so a
compromised CDN can't inject code:
```html
<script src="https://cdn.jsdelivr.net/gh/voldcs/w2a-sdk-public@0.3.1/dist/w2a-sdk.min.js"
        integrity="sha384-XNEV+QYc4LNxjnpuGqYjTFdno4ZfKrFZjbO+TU8VMOnOBsHAydFdqVAGtkuz261H"
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
  creativeFormat: 'vast',        // rewarded demand currently uses VAST
})

const TERMINAL = new Set(['closed', 'failed', 'no_fill', 'unsupported'])
const OWNERSHIP_BLOCKERS = new Set(['busy', 'fullscreen_conflict'])
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

// Progress events are for diagnostics. Terminal ownership comes from the
// correlated result returned by each successful claim below.
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
  const claim = sdk.tryShowReady('interstitial', placement)
  if (claim.started) {
    void Promise.resolve(claim.result)
      .then(() => {
        adOpportunityBusy = false
        void prepareInterstitial()
      }, () => {}) // an invalid rejection keeps provider ownership fail-closed
    return
  }
  if (OWNERSHIP_BLOCKERS.has(claim.reason)) {
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
  const placement = 'continue'
  const claim = sdk.tryShowReady('rewarded', placement)
  if (claim.started) {
    const finishW2AShow = (result) => {
      try {
        // Credit from result.rewarded only. Do not also credit the rewarded event.
        if (result && result.rewarded === true) grantReward()
      } finally {
        adOpportunityBusy = false
        void prepareRewarded()
      }
    }
    void Promise.resolve(claim.result)
      .then(finishW2AShow, () => {}) // an invalid rejection keeps ownership
    return
  }
  if (OWNERSHIP_BLOCKERS.has(claim.reason)) {
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
committed bundles byte-for-byte. Version 0.3.0, demo/preview grade. Release
hashes and the canonical core commit are recorded in `release.json`.
