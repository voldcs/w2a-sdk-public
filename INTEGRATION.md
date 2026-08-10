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
of the canonical SDK source snapshot. Compare `sdkSha256` with
`release.json.sourceSha256` or with the `w2a-src-sha256` banner in the loaded
bundle. Verify the exact loaded bundle separately against its artifact SHA-256
and SRI in `release.json`.

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

## Install postbacks (generic MMP ingress)

`/postback` is a generic authenticated MMP ingress. Its presence does not mean
that an AppsFlyer delivery product is enabled or configured. At the 2026-08-07
account check, Push API was not available on the current AppsFlyer plan, and the
raw Pull API returned `subscription package missing`. The Aggregated API worked,
but it did not include the click-level join field. None of those observations
authorizes configuring AppsFlyer to send traffic to this endpoint.

When an MMP push route is provisioned and verified, its delivery contract is:

```
POST https://w2a-ads-demo.azurewebsites.net/postback
```

| Requirement | Value | If you get it wrong |
|---|---|---|
| Method | `POST` | `405`. GET is refused on purpose: a GET postback fires from a hidden `<img>` on any page, so installs would be forgeable. |
| Auth | header `X-W2A-Postback: <secret>` (or `?s=<secret>`) | `403`. The secret is provisioned out of band - it is not in this repository and must not be pasted into a shared channel. Prefer the header: a query string reaches proxy logs. |
| Click join | payload field **`af_sub1`** must carry our `click_id` | The install arrives, joins nothing, and is reported as `postback_unmatched`. It is NOT counted as an install. |
| Event | `event_name` = `install` | Anything else is recorded as `postback_ignored` and deliberately not counted. See below. |

`click_id` is handed to you by the ad response, inside `clickUrl`. It is the only
join key: without the mapped sub-parameter the postback cannot be matched to a
click, and no amount of correct configuration elsewhere recovers it.

AppsFlyer uses different labels for the same sub-parameter on different
surfaces. The attribution link parameter is `af_sub1`. Push API and Data Locker
raw data use `af_sub1`. Export and Pull CSV reports label it `Sub param 1`. Check
the exact product surface before mapping a field; do not infer a CSV header from
the attribution-link parameter name.

### Opportunity id (`af_sub4`), optional but worth configuring

Every fill also carries an **opportunity id** - a server-minted token of the form
`opp_` plus 32 hex, returned to the caller as `opportunityId` in the ad response
and sent outward on the click as `af_sub4`.

It exists so an advertiser can line an install up with the specific ad
opportunity in their own analytics, without asking us for the join. It is an
identifier only: it authorises nothing, contains no user data, and is scoped to
one opportunity. It is not the attribution key - `af_sub1` still is, and nothing
about that changes.

Two properties worth knowing:

- A replayed click publishes the **same** opportunity id. The value is stored on
  the winning request row and read back on every hit, so it survives a restart
  and a back-button replay. Our own click is still counted once.
- **Adding `af_sub4` to the click link does not put it in your postback.** It has
  to be added explicitly to the install-postback or raw-export template on the
  AppsFlyer side. Until that is done the value goes out and never comes back,
  and everything else keeps working - which is exactly why it is easy to miss.

We record what we receive: a postback with no `af_sub4` is logged as
`af_sub4=absent`, and one whose value disagrees with ours as `af_sub4=MISMATCH`.
Both still attribute normally, because the join is `af_sub1`. An echoed value is
never used to decide which opportunity an install belongs to.

For Adjust, the same token maps onto a dynamic callback parameter -
`w2a_opportunity_id` on the click link, `{dcp_w2a_opportunity_id}` in the install
callback - and the click id keeps its own separate field.

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

The source authority is `w2a-demo/sdk-pkg/src/index.js` in the
`web2app-ad-sdk` repository. That package also generates the demo and integration
copies and refuses to ship when they drift. This repository is a reviewed release
mirror, not the source authority. `release.json` binds each mirror version to the
reviewed core commit, source hash, type hash, bundle hashes and SRI.

Treat an untagged checkout as a release candidate. Before external use, complete
the gates in `RELEASE.md`, verify the immutable CDN bytes, and compare `/version`
on the stand with the canonical source marker in the bundle under test.
