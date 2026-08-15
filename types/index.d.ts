// Type definitions for @w2a/sdk (Portal Tag runtime, Mode A)

/** A renderable creative type. `auto` is a POLICY, not a type: it asks the
 *  server to pick from the routes a campaign actually has. */
export type RenderableCreativeFormat = 'image' | 'vast' | 'playable'
export type CreativeFormat = RenderableCreativeFormat | 'auto'
export type AdFormat = 'interstitial' | 'rewarded'
export type AdState = 'loading' | 'opened' | 'closed' | 'rewarded' | 'failed' | 'no_fill' | 'unsupported'
export type W2AAudioMode = 'auto' | 'muted'
export type W2ACreativeFit = 'auto' | 'contain' | 'cover'
/**
 * `ad_state` carries the lifecycle; a show emits exactly ONE terminal
 * (`closed` / `failed` / `no_fill` / `unsupported`), which is what makes
 * fallback and resume logic safe to run on it.
 *
 * `w2a_impression` exists because of that guarantee. A player who taps Install
 * before the impression beacon is answered closes the ad while
 * `impressionState` is still `'pending'`, and that would otherwise be the last
 * word a publisher ever heard on it. The verdict arrives here instead of as a
 * second terminal. Best-effort: a click-out navigates the page, so the event
 * may never fire - server-side reporting remains authoritative.
 */
/**
 * `w2a_click` is NOT a terminal.
 *
 * A tap on Install used to end the show; the player came back from the store to
 * no ad at all, which made Install a skip button. The show now SUSPENDS and
 * waits, so the click needs an event of its own: `clickPhase: 'suspended'` when
 * the player leaves, `'returned'` when they come back. The eventual terminal
 * still carries `clicked: true`.
 *
 * A host must NOT resume its game on this event - the ad is still on screen.
 * `w2a_resume` remains the one signal that the ad is gone.
 */
export type W2AEvent =
  'ad_state' | 'w2a_pause' | 'w2a_resume' | 'w2a_impression' | 'w2a_click'

export interface W2AConfig {
  /** W2A ad-server base URL; '' = same origin */
  backend?: string
  publisherId?: string
  gameId?: string
  /** publisher price floor in CPM units */
  floorCpm?: number
  /** Requested creative policy. An explicit type is exact: a campaign that has
   *  no route for it does not substitute another, it drops out of the auction.
   *
   *  LEAVE IT UNSET unless you need one exact type. Absence is resolved per ad
   *  format - `auto` for rewarded, `image` for interstitial - and `auto` lets
   *  the server pick from the routes a campaign really has. Setting `image`
   *  globally is the one thing to avoid: no campaign has a rewarded image
   *  route, so it makes every rewarded request a permanent no-fill. */
  creativeFormat?: CreativeFormat
  /** milliseconds before a qualified impression. Video counts credible
   *  advancing playback; dwell formats count visible time after load. */
  billableMs?: number
  /** foreground seconds an image, text or playable ad must be on screen before
   *  it pays. Video uses videoRewardMs and advancing media evidence instead. */
  rewardSecs?: number
  /** count only foreground time towards dwell. Default true; turn it off only
   *  for webviews that misreport `document.hidden`, and expect
   *  `visibilityEnforced: false`. Rewarded video always excludes hidden time. */
  requireVisible?: boolean
  /** seconds before the close control is offered */
  closeAfterSecs?: number
  requestTimeoutMs?: number
  /** maximum time to prepare a creative after its ad decision. Default 6000. */
  creativeLoadTimeoutMs?: number
  /** advancing video milliseconds required for a rewarded video. Default 30000. */
  videoRewardMs?: number
  /** visible time allowed before media time first advances. Default 10000. */
  videoStartTimeoutMs?: number
  /** visible time allowed without another credible media advance. Default 10000. */
  videoStallTimeoutMs?: number
  /** Legacy absolute wall-clock deadline for one visible VAST show. The SDK
   *  raises values that are shorter than startup + creative/reward + stall;
   *  this value is a total and is never added to the creative duration. */
  maxVideoMs?: number
  maxPlayableMs?: number
  /** @deprecated Accepted for source compatibility and ignored. The CTA is
   *  available immediately; genuine-input and one-shot checks still apply. */
  antiMisclickMs?: number
  /** request audible video and fall back to muted, or always keep it muted */
  audio?: W2AAudioMode
  /** media fit policy. `cover` is honored only for crop-safe creatives. */
  creativeFit?: W2ACreativeFit
  /** whether the supplied creative may be cropped. Default true. */
  cropSafe?: boolean
  /** suppress once-per-reason developer warnings */
  quiet?: boolean
  /** coarse consent override (e.g. from a GameDistribution mediation adapter) */
  consentState?: string
  /** how long a preload()'d decision stays valid before it expires (ms) */
  preloadTtlMs?: number
  /** How long a clicked-out show waits for the player to come back from the
   *  store before it gives up and reports `click_return_timeout`. Clamped to
   *  60000 ms: a suspended show holds the `active` slot, so it cannot wait
   *  indefinitely without refusing the game's next ad as busy. */
  clickReturnTimeoutMs?: number
  /** Declare that a tap on Install leaves THIS document running - set it only
   *  from a native host that intercepts the store URL and opens it itself, so
   *  the WebView survives. It cannot be detected from inside the page: such a
   *  WebView usually never marks its document hidden, and `window.open` is no
   *  probe either, because one with multiple windows disabled can return an
   *  object and then drop the request silently.
   *
   *  Without it, a click that targets `_top` replaces this document and the SDK
   *  ends the show, which is what actually happens. A framed ad opens the store
   *  in a separate context and suspends without needing this flag.
   *
   *  A host that sets it MUST also call `resumeActive(requestId)` from its own
   *  resume callback; in that embedding no browser signal reports the return. */
  clickPreservesDocument?: boolean
}

/** How a reward was arrived at. `visible_dwell` is a policy, not proof. */
export type RewardBasis = 'watched_video' | 'visible_dwell'
/** `full` >= 98% watched, `threshold` cleared the advancing-playback gate with
 *  less than a full view, and `dwell_only` means nothing was watched. */
export type RewardQuality = 'full' | 'threshold' | 'dwell_only' | 'not_earned'

/**
 * Everything the SDK publishes. These are the exact fields that survive the
 * runtime allowlist, so this interface is the contract rather than a summary of
 * it: a field missing here is a field a TypeScript publisher cannot read.
 */
export interface AdStateEvent {
  requestId: string
  /** active show that refused this attempted call with `busy` */
  blockingRequestId?: string
  format: AdFormat
  placement: string
  state: AdState
  reason?: string
  /** which check refused, when `reason` alone is too coarse to act on */
  detail?: string
  campaignId?: string
  /** which of the three match tiers filled this request */
  tier?: string
  priceCpm?: number
  matched?: boolean
  preloaded?: boolean
  completed?: boolean
  paused?: boolean
  framed?: boolean

  /** 'pending' until the beacon is answered, then 'confirmed' or 'degraded' */
  impressionState?: string
  impressionConfirmed?: boolean
  /** false when the CTA was live before the impression was committed, so
   *  `clicks <= impressions` cannot be assumed */
  ctaGatedByImpression?: boolean
  clicked?: boolean
  /** Whether the show is waiting behind a store page the player clicked through
   *  to. Present ONLY on `w2a_click` - `true` on the `suspended` phase, `false`
   *  on `returned` - and absent from every `ad_state`, including the terminal.
   *  It is not carried on the show context precisely so it cannot ride out on an
   *  unrelated event. */
  suspended?: boolean
  /** which half of the click-out this `w2a_click` reports */
  clickPhase?: 'suspended' | 'returned'
  /** the click was not a trusted user event */
  synthetic?: boolean
  /** whether this format enforced foreground visibility. VAST always does;
   *  dwell formats follow `requireVisible`. */
  visibilityEnforced?: boolean

  /** what the player actually got, not what was requested */
  audio?: string
  /** 'strong' if the creative announced itself, 'weak' if only the frame loaded */
  readinessProof?: string
  playableSizing?: string
  fullscreen?: string
  presentation?: string

  // Reward evidence. Present on rewarded shows only; an interstitial carries
  // none of these rather than carrying empty ones.
  rewardEarned?: boolean
  rewardBasis?: RewardBasis
  rewardQuality?: RewardQuality
  /** true for VAST video; dwell formats follow `requireVisible` */
  rewardVisibilityEnforced?: boolean
  /** the creative reported completion; reported, never trusted, never paid on */
  playableCompleteSeen?: boolean
  /** the video reached its natural end */
  rewardEndedSeen?: boolean
  rewardDurationMs?: number
  /** share of the film actually played through, 0..1 */
  rewardCoverageRatio?: number
  /** share of the film's length spent watching it on screen, 0..1 */
  rewardAttentionRatio?: number
  /** foreground milliseconds, on the dwell path */
  rewardVisibleMs?: number
  rewardSeeks?: number
  /** media jumps the clock could not explain */
  rewardRejectedJumps?: number
  rewardMaxRate?: number
}

/** Pure video evidence summary. `earned` is the legacy ended-plus-ratio verdict.
 *  The SDK's live reward gate instead compares
 *  `min(coverageMs, attentionMs)` with `videoRewardMs`, so it can latch before
 *  natural completion while using the same evidence. An exact-duration video
 *  may also latch at natural end when both evidence ratios reach 0.98. */
export interface RewardVerdict {
  earned: boolean
  quality: RewardQuality
  endedSeen: boolean
  durationMs: number | null
  coverageMs: number
  attentionMs: number
  coverageRatio: number | null
  attentionRatio: number | null
  seeks: number
  rejectedJumps: number
  rateViolations: number
  maxRate: number
}

export interface RewardEvidence {
  sample(s: {
    mediaSec: number
    wallMs: number
    rate: number
    playing: boolean
    visible: boolean
  }): void
  /** end the current playback epoch without discarding what it earned */
  break(): void
  end(): void
  verdict(durationMs: number | null): RewardVerdict
}

export interface PreloadResult {
  filled: boolean
  ready: boolean
  reason?: string
  requestId?: string
  readinessProof?: string
}

export type AdTerminalStatus = 'closed' | 'failed' | 'no_fill' | 'unsupported'

export interface AdResult {
  requestId: string
  format: AdFormat
  placement: string
  status: AdTerminalStatus
  reason?: string
  rewarded: boolean
  blockingRequestId?: string
}

export type ShowAttempt =
  | { started: true; attemptId: string; requestId: string; result: Promise<AdResult> }
  | {
      started: false
      attemptId: string
      reason: string
      requestId?: string
      blockingRequestId?: string
    }

/** Backward-compatible name retained for existing integrations. */
export type ReadyAdClaim = ShowAttempt

export interface W2ACapabilities {
  framed: boolean
  fullscreenAllowed: boolean
  coverage: 'window' | 'screen_if_gesture' | 'document'
  viewport: [number, number] | null
}

export function createRewardEvidence(opts?: {
  minStepMs?: number
  tolerance?: number
  maxRate?: number
  requiredRatio?: number
  fullRatio?: number
}): RewardEvidence

export interface W2ASDK {
  init(cfg: W2AConfig): W2ASDK
  /** Show an ad and settle with the same terminal outcome emitted in ad_state. */
  showAd(format: AdFormat, placement: string): Promise<AdResult>
  showInterstitial(placement: string): Promise<void>
  showRewarded(placement: string): Promise<void>
  /** Prefetch the ad decision and prepare its creative in a hidden overlay, so
   *  a later claim renders synchronously inside a user gesture. */
  preload(format: AdFormat, placement: string): Promise<PreloadResult>
  /** Advisory only. Optionally require this many milliseconds of remaining
   *  claim validity. tryShowReady() is the atomic correctness gate. */
  isReady(format: AdFormat, placement: string, minValidityMs?: number): boolean
  /** Claim and start a ready ad synchronously inside the current user gesture. */
  tryShowReady(format: AdFormat, placement: string): ReadyAdClaim
  /** Tear down only the active show with this requestId. Returns false for a
   *  stale or unknown request so an old watchdog cannot cancel a newer ad. */
  cancelActive(requestId: string, reason?: string): boolean
  /** Tell a click-suspended show that the player is back, for a native host
   *  that retained its WebView while an external store Activity covered it.
   *  Browser pages do not need this - the SDK listens to `visibilitychange`,
   *  `pageshow` and `resume` itself - but an Android WebView commonly
   *  never marks its document hidden, so those signals never arrive. Correlated
   *  by requestId so a late Activity callback cannot resume a newer ad.
   *  Returns false if there is no suspended show with that id. */
  resumeActive(requestId: string): boolean
  /** Report the coverage surface available in the current browser context. */
  capabilities(): W2ACapabilities
  on(event: W2AEvent, cb: (e: AdStateEvent) => void): () => void
}

export const W2A: W2ASDK

declare global {
  interface Window { W2A: W2ASDK }
}
