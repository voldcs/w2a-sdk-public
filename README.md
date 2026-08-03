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
<script src="https://cdn.w2a.example/sdk/0.1.0/w2a-sdk.min.js"
        integrity="sha384-<hash-of-this-version>" crossorigin="anonymous"></script>
```

npm (ESM):
```js
import { W2A } from '@w2a/sdk'
```

## Use

```js
W2A.init({
  backend: 'https://w2a-ads-demo.azurewebsites.net',   // see INTEGRATION.md
  publisherId: 'your-pub-id',
  gameId: 'your-game-id',        // -> genre via the catalog
  creativeFormat: 'image',       // 'image' | 'vast' | 'playable'
})

// on a natural break (level end, game over):
W2A.on('ad_state', (e) => {
  // e.state: loading | opened | closed | rewarded | failed | no_fill | unsupported
  if (e.state === 'no_fill') { /* fall back to your mediation */ }
})
W2A.showInterstitial('level_end')

// rewarded (reward only on the 'rewarded' state):
let rewarded = false
W2A.on('ad_state', (e) => {
  if (e.format !== 'rewarded') return
  if (e.state === 'rewarded') rewarded = true
  if (e.state === 'closed' && rewarded) grantReward()
})
W2A.showRewarded('continue')
```

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

Version 0.1.0 · demo/preview grade.
