// Type definitions for @w2a/sdk (Portal Tag runtime, Mode A)

export type CreativeFormat = 'image' | 'vast' | 'playable'
export type AdFormat = 'interstitial' | 'rewarded'
export type AdState = 'loading' | 'opened' | 'closed' | 'rewarded' | 'failed' | 'no_fill' | 'unsupported'
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
export type W2AEvent = 'ad_state' | 'w2a_pause' | 'w2a_resume' | 'w2a_impression'

export interface W2AConfig {
  /** W2A ad-server base URL; '' = same origin */
  backend?: string
  publisherId?: string
  gameId?: string
  /** requested creative format (bidder falls back to image) */
  creativeFormat?: CreativeFormat
  /** ms shown before an image is a qualified impression */
  billableMs?: number
  /** foreground seconds an image, text or playable ad must be on screen before
   *  it pays. A VIDEO is not governed by this: it pays at its own natural end,
   *  scored on how much of the film was actually watched. */
  rewardSecs?: number
  /** count only foreground time towards dwell and attention. Default true; turn
   *  it off only for webviews that misreport `document.hidden`, and expect
   *  `visibilityEnforced: false` on the events that result. */
  requireVisible?: boolean
  /** seconds before the close control is offered */
  closeAfterSecs?: number
  requestTimeoutMs?: number
  maxVideoMs?: number
  maxPlayableMs?: number
  /** ignore CTA taps within this window after un-gate (anti-misclick) */
  antiMisclickMs?: number
  /** coarse consent override (e.g. from a GameDistribution mediation adapter) */
  consentState?: string
  /** how long a preload()'d decision stays valid before it expires (ms) */
  preloadTtlMs?: number
}

/** How a reward was arrived at. `visible_dwell` is a policy, not proof. */
export type RewardBasis = 'watched_video' | 'visible_dwell'
/** `full` >= 98% watched, `threshold` cleared the 90% policy with less, and
 *  `dwell_only` means nothing was watched - the ad was merely on screen. */
export type RewardQuality = 'full' | 'threshold' | 'dwell_only' | 'not_earned'

/**
 * Everything the SDK publishes. These are the exact fields that survive the
 * runtime allowlist, so this interface is the contract rather than a summary of
 * it: a field missing here is a field a TypeScript publisher cannot read.
 */
export interface AdStateEvent {
  requestId: string
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
  /** the click was not a trusted user event */
  synthetic?: boolean
  /** false when `requireVisible` was switched off, so dwell was not verified */
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
  /** false when `requireVisible` was off, so attention was not enforced either */
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

/** The reward measurement, exported so a mediation layer can score its own
 *  player the same way. Pure: timestamps in, verdict out. */
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

export interface ReadyAdClaim {
  started: boolean
  reason?: string
  requestId?: string
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
  showInterstitial(placement: string): Promise<void>
  showRewarded(placement: string): Promise<void>
  /** Prefetch the ad decision and prepare its creative in a hidden overlay, so
   *  a later claim renders synchronously inside a user gesture. */
  preload(format: AdFormat, placement: string): Promise<PreloadResult>
  /** Advisory only. tryShowReady() is the atomic correctness gate. */
  isReady(format: AdFormat, placement: string): boolean
  /** Claim and start a ready ad synchronously inside the current user gesture. */
  tryShowReady(format: AdFormat, placement: string): ReadyAdClaim
  on(event: W2AEvent, cb: (e: AdStateEvent) => void): () => void
}

export const W2A: W2ASDK

declare global {
  interface Window { W2A: W2ASDK }
}
