# Integration contract

Everything an integrator needs that is NOT the SDK API: which host to talk to,
how install postbacks are configured, and what our responses mean.

This file exists because the hostname alone was not the problem. A partner
following an out-of-date document configured install postbacks against a host
that had been decommissioned, and that document also omitted the auth header and
the one required field - so even correcting the hostname would not have produced
a recorded install. The contract is all of it, in one place, or it rots again.

## Endpoints

| What | Address |
|---|---|
| Ad serving and postbacks | `https://w2a-ads-demo.azurewebsites.net` |

Verify what a host is actually running before trusting it:

```bash
curl -s https://w2a-ads-demo.azurewebsites.net/version
```

It answers with the deployed commit, its subject, the build time and the SHA-256
of the SDK bundle that host is serving. If that SHA does not match the bundle you
loaded, you are testing against something else.

### Retired hosts - do not configure these

| Host | Status |
|---|---|
| `w2a-demo.onrender.com` | **Dead.** Decommissioned; answers 404 on every path. |

There is no replacement URL on Render and nothing to migrate: the service is
gone. If you find this host in any document, dashboard or config, it is stale and
it is silently dropping whatever is sent to it - a dead host does not complain.

## What is public and what is not

The game runs on the publisher's own domain and has no session with us, so the
serving surface is deliberately open:

- Open, no auth: `/v1/request`, `/v1/impression`, `/v1/release`, `/v1/fallback`,
  the creative assets, plus `/health` and `/version`.
- Behind Google Sign-In with an email allowlist: the dashboard, `/v1/events`,
  `/v1/report`. Ask for your address to be added; without it these answer
  `401 sign_in_required`.

## Install postbacks (AppsFlyer Push API)

Configure the MMP to deliver to:

```
POST https://w2a-ads-demo.azurewebsites.net/postback
```

| Requirement | Value | If you get it wrong |
|---|---|---|
| Method | `POST` | `405`. GET is refused on purpose: a GET postback fires from a hidden `<img>` on any page, so installs would be forgeable. |
| Auth | header `X-W2A-Postback: <secret>` (or `?s=<secret>`) | `403`. The secret is provisioned out of band - it is not in this repository and must not be pasted into a shared channel. Prefer the header: a query string reaches proxy logs. |
| Click join | selected field **`af_sub1`** must carry our `click_id` | The install arrives, joins nothing, and is reported as `postback_unmatched`. It is NOT counted as an install. |
| Event | `event_name` = `install` | Anything else is recorded as `postback_ignored` and deliberately not counted. See below. |

`click_id` is handed to you by the ad response, inside `clickUrl`. It is the only
join key: without `af_sub1` the postback cannot be matched to a click, and no
amount of correct configuration elsewhere recovers it.

### What our 200 means

A `200` means *received and understood*, not *counted as an install*. The body
distinguishes the cases:

| Response body | Meaning |
|---|---|
| `{ok:true, attributed:true}` | Matched a real click. Counted. |
| `{ok:true, attributed:false}` | Arrived, matched no click. Counted in `postback_unmatched`, not as an install. |
| `{ok:true, deduped:true}` | A duplicate of an install already recorded for this click. |
| `{ok:true, ignored:...}` | `event_name` was not `install`. Recorded as `postback_ignored`, not counted. |

We answer `200` in every one of these on purpose: a non-2xx makes the MMP retry
forever for a delivery we have already made a decision about.

### Reinstalls

A re-install on a device the MMP already knows, inside its re-attribution window,
is classified as a **reinstall** rather than a new install, and the ordinary
install postback is not sent at all. This is the most common reason a tester sees
"I installed it and nothing appeared" - the message was never generated.

Two consequences for testing:

- Register the test device with the MMP **before** the click, and do not reset the
  advertising identifier afterwards. An ordinary, unregistered device that has had
  the app before may record nothing at all.
- An install is created at **first launch of the app**, not when the download
  finishes. Nothing is instant: check at 2, 5 and 15 minutes, and treat 30 minutes
  with no delivery as missing rather than slow.

If a reinstall postback IS delivered to us, it now leaves a row (`postback_ignored`)
instead of vanishing, so "never sent" and "sent and dropped" can be told apart on
our side. What we still cannot see from here is a delivery that went to the wrong
host or was never generated - those are identical to us, and only the MMP's own
delivery report separates them.

## Reporting the numbers mean what they say

| Counter | Means |
|---|---|
| `postback_received` | Install-shaped postbacks that passed method, auth and body checks. |
| `postback_unmatched` | Of those, the ones that joined no click. |
| `postback_ignored` | Arrived, understood, deliberately not counted (event was not `install`). |

`postback_received` deliberately excludes `postback_ignored`: it is the number
reconciled against the MMP's delivery report, and folding in events we chose to
drop would corrupt that reconciliation.

## Where this SDK comes from

The authority for the SDK source is currently `w2a-demo/sdk-pkg/src/index.js` in
the `web2app-ads-sdk` repository, which also generates the copies the demo and the
integrations use and refuses to ship if they have drifted. This repository is a
published extract of that package.

That means there are now two copies of the SDK, and copies drift - which is
exactly the failure this document was written about. Before this is used by
anyone outside, one of two things has to be decided and done:

1. **This repository becomes the authority**, and the demo consumes it as a
   dependency; or
2. **it stays a published mirror**, and the publish step is wired into the demo's
   ship script so a mirror can never be stale.

Until then, treat the version here as a snapshot and check `/version` on the stand
for the SHA of the bundle actually being served.
