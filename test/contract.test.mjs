// Guards on the integration contract itself.
//
// These exist because of a real incident: a partner configured install postbacks
// against a host that had been decommissioned, taking the address from a document
// nobody had reason to open after the migration. Every test here is deterministic
// and offline - deliberately. A liveness probe would be the obvious check and the
// wrong one: our own /postback answers 405 to an unauthenticated GET and 403
// without the secret, so "is it up" cannot distinguish a correct endpoint from a
// broken one, while DNS, TLS and CI egress add failures that have nothing to do
// with the commit under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { promisify } from 'node:util'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const execFileAsync = promisify(execFile)

// The single canonical address, and the hosts that must never be configured again.
const CANONICAL = 'https://w2a-ads-demo.azurewebsites.net'
const RETIRED = ['w2a-demo.onrender.com']
const RELEASE_SNAPSHOT = Object.freeze({
  version: '0.2.3',
  coreCommit: '1a9750526e1c54aa7724b492412e3a6bb910e11a',
  sourceSha256: '33704d01b12681572e282511bda4852019245aa5c41587fc790d17c7f0ffe0e3',
  typesSha256: '214c60960bc84c7d4e156d99a7bcb69ad2fc9063d824553cdbadf95ae1d1474c',
  licenseSha256: '6d093b2cd97e8958606fe4d673864e4add44b3534e1fdc6d355b0f5fe70b763e',
  artifacts: {
    'dist/w2a-sdk.esm.js': 'e171bea0b8256deda7a00bbb122060bd0d1326e4b4d52294c41aa94cbae8807e',
    'dist/w2a-sdk.iife.js': '5e594f0d2ba75d4ae130b30865f0d6dcae789c054a7b038d86f9cba9b2f87451',
    'dist/w2a-sdk.min.js': 'cd979385805c738a82f80a0b44723194d35b91124c76e560edf93e3bdf7dcbe1',
  },
  minSri: 'sha384-0XL1/oS8G0OGY3LO5K5OMJBsJH7wh1yYySOmD8E4K9ZWCrBOTPMVhH/rbTgx1Vnt',
})

async function sha(algorithm, path) {
  const bytes = await readFile(path)
  return createHash(algorithm).update(bytes).digest('hex')
}

async function docs(dir = ROOT, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await docs(p, acc)
    else if (['.md', '.json', '.js', '.mjs', '.ts'].includes(extname(e.name))) acc.push(p)
  }
  return acc
}

test('no retired host is named as somewhere to send traffic', async () => {
  // INTEGRATION.md names the retired host on purpose, to say it is dead. That is
  // the one legitimate mention, and it is recognisable because it sits in the
  // "Retired hosts" table - so the check is per-line and skips lines that mark it
  // as retired, rather than exempting the whole file and losing the guard there.
  const offenders = []
  for (const f of await docs()) {
    const text = await readFile(f, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const host of RETIRED) {
        if (!line.includes(host)) continue
        if (/retired|dead|decommission|stale|do not configure|404/i.test(line)) continue
        offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim().slice(0, 100)}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    'a retired host is named without being marked retired:\n' + offenders.join('\n'))
})

test('the canonical endpoint is stated, and stated the same way everywhere', async () => {
  // Two spellings of one address is how they drift apart. Any http(s) URL for our
  // stand must be exactly the canonical one.
  const wrong = []
  for (const f of await docs()) {
    const text = await readFile(f, 'utf8')
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]*w2a[a-z0-9.-]*\.(?:azurewebsites\.net|onrender\.com)/gi)) {
      if (m[0] === CANONICAL) continue
      if (RETIRED.some((h) => m[0].includes(h))) continue // covered by the test above
      wrong.push(`${f.slice(ROOT.length + 1)}: ${m[0]}`)
    }
  }
  assert.deepEqual(wrong, [], 'non-canonical spelling of the stand address:\n' + wrong.join('\n'))

  const integration = await readFile(join(ROOT, 'INTEGRATION.md'), 'utf8')
  assert.ok(integration.includes(CANONICAL), 'INTEGRATION.md must state the canonical endpoint')
})

test('/version source identity is distinct from exact bundle integrity', async () => {
  const [integration, procedure] = await Promise.all([
    readFile(join(ROOT, 'INTEGRATION.md'), 'utf8'),
    readFile(join(ROOT, 'RELEASE.md'), 'utf8'),
  ])
  for (const text of [integration, procedure]) {
    assert.ok(text.includes('release.json.sourceSha256'))
    assert.ok(text.includes('w2a-src-sha256'))
    assert.ok(text.includes('artifact SHA-256'))
    assert.ok(text.includes('SRI'))
  }
  assert.doesNotMatch(integration, /SHA-256\s+of the SDK bundle that host is serving/)
  assert.doesNotMatch(procedure, /\/version[^\n]*identifies the SDK bundle actually served/)
})

test('the postback contract names every field an integrator must set', async () => {
  // The incident was not only a wrong hostname: the document that carried it also
  // omitted the auth header and the required join field, so correcting the host
  // alone would still have produced no recorded install. Each of these has to be
  // present or the document is an incomplete contract again.
  const t = await readFile(join(ROOT, 'INTEGRATION.md'), 'utf8')
  for (const required of ['POST', 'X-W2A-Postback', 'af_sub1', 'event_name']) {
    assert.ok(t.includes(required), `INTEGRATION.md must specify ${required}`)
  }
})

test('release metadata pins one immutable SDK version', async () => {
  const release = JSON.parse(await readFile(join(ROOT, 'release.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')

  assert.equal(pkg.version, release.version)
  assert.match(release.version, /^\d+\.\d+\.\d+$/)
  assert.equal(release.coreCommit.length, 40)
  assert.ok(release.cdnUrl.includes(`@${release.version}/`))
  assert.ok(!release.cdnUrl.includes('@main'))
  assert.ok(readme.includes(release.cdnUrl))
  assert.ok(!readme.includes('@main'))
})

test('0.2.3 metadata identifies the reviewed core snapshot and build tool', async () => {
  const release = JSON.parse(await readFile(join(ROOT, 'release.json'), 'utf8'))

  assert.equal(release.version, RELEASE_SNAPSHOT.version)
  assert.equal(release.coreCommit, RELEASE_SNAPSHOT.coreCommit)
  assert.equal(release.sourceSha256, RELEASE_SNAPSHOT.sourceSha256)
  assert.equal(release.typesSha256, RELEASE_SNAPSHOT.typesSha256)
  assert.equal(release.licenseSha256, RELEASE_SNAPSHOT.licenseSha256)
  assert.deepEqual(release.buildTool, { name: 'esbuild', version: '0.28.1' })
  assert.deepEqual(release.publication, {
    status: "not_published",
    checkedAt: null,
    githubVisibility: "public",
    tag: "0.2.3",
    tagPresent: false,
    jsdelivrHttpStatus: null,
    npmRegistryHttpStatus: null,
  })
  for (const [relativePath, expected] of Object.entries(RELEASE_SNAPSHOT.artifacts)) {
    assert.equal(release.artifacts[relativePath]?.sha256, expected)
  }
  assert.equal(release.artifacts['dist/w2a-sdk.min.js']?.sri, RELEASE_SNAPSHOT.minSri)
})

test('release artifacts match their source marker, hashes and SRI', async () => {
  const release = JSON.parse(await readFile(join(ROOT, 'release.json'), 'utf8'))
  assert.equal(await sha('sha256', join(ROOT, 'src/index.js')), release.sourceSha256)

  for (const [relativePath, expected] of Object.entries(release.artifacts)) {
    const path = join(ROOT, relativePath)
    const text = await readFile(path, 'utf8')
    assert.ok(text.startsWith(`/* w2a-src-sha256:${release.sourceSha256} */`),
      `${relativePath} must name the release source hash`)
    assert.equal(await sha('sha256', path), expected.sha256,
      `${relativePath} must match release.json`)
    if (expected.sri) {
      const bytes = await readFile(path)
      const sri = 'sha384-' + createHash('sha384').update(bytes).digest('base64')
      assert.equal(sri, expected.sri, `${relativePath} SRI must match release.json`)
      const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
      assert.ok(readme.includes(`integrity="${sri}"`), 'README must publish the verified SRI')
    }
  }

  assert.equal(await sha('sha256', join(ROOT, 'types/index.d.ts')), release.typesSha256,
    'public type declarations must match release.json')
  assert.equal(await sha('sha256', join(ROOT, 'LICENSE')), release.licenseSha256,
    'public license must match release.json')
})

test('public types cover ready claims, correlated cancellation, capabilities and video clocks', async () => {
  const [source, types] = await Promise.all([
    readFile(join(ROOT, 'src/index.js'), 'utf8'),
    readFile(join(ROOT, 'types/index.d.ts'), 'utf8'),
  ])

  assert.match(source, /\n  isReady\(format, placement, minValidityMs = 0\) \{/)
  assert.match(source, /\n  tryShowReady\(format, placement\) \{/)
  assert.match(source, /\n  cancelActive\(requestId, reason/)
  assert.match(source, /\n  capabilities\(\) \{/)
  assert.match(source, /if \(Date\.now\(\) > rec\.readyUntil\) \{/,
    'preload must recheck its lease after creative loading')
  assert.ok(types.includes('isReady(format: AdFormat, placement: string, minValidityMs?: number): boolean'))
  assert.ok(types.includes('tryShowReady(format: AdFormat, placement: string): ReadyAdClaim'),
    'types must expose the gesture-safe SDK entry point')
  assert.ok(types.includes('cancelActive(requestId: string, reason?: string): boolean'))
  assert.ok(types.includes('capabilities(): W2ACapabilities'))
  for (const field of [
    'framed: boolean',
    'fullscreenAllowed: boolean',
    "coverage: 'window' | 'screen_if_gesture' | 'document'",
    'viewport: [number, number] | null',
  ]) assert.ok(types.includes(field), `W2ACapabilities must include ${field}`)
  assert.ok(types.includes('showInterstitial(placement: string): Promise<void>'),
    'types must describe the async direct-show result')
  assert.ok(types.includes('showRewarded(placement: string): Promise<void>'))
  assert.ok(types.includes('preload(format: AdFormat, placement: string): Promise<PreloadResult>'))
  for (const field of [
    'videoRewardMs?: number',
    'videoStartTimeoutMs?: number',
    'videoStallTimeoutMs?: number',
    'maxVideoMs?: number',
  ]) {
    assert.ok(types.includes(field), `W2AConfig must include ${field}`)
  }
  assert.doesNotMatch(source, /The browser signals[^\n]*`focus`/,
    'runtime JSDoc must not promise an unhandled focus lifecycle signal')
  assert.doesNotMatch(types, /Browser pages do not need this[\s\S]{0,200}`focus`/,
    'public types must not promise an unhandled focus lifecycle signal')

  const classBody = source.slice(source.indexOf('class W2ASDK {'), source.indexOf('const W2A = new W2ASDK'))
  const runtimeMethods = [...classBody.matchAll(/^  (?:async )?([A-Za-z][A-Za-z0-9]*)\([^\n]*\)\s*\{/gm)]
    .map((match) => match[1])
    .filter((name) => name !== 'constructor')
    .sort()
  const interfaceBody = types.match(/export interface W2ASDK \{([\s\S]*?)\n\}/)?.[1] || ''
  const typedMethods = [...interfaceBody.matchAll(/^  ([A-Za-z][A-Za-z0-9]*)\(/gm)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(typedMethods, runtimeMethods, 'every public runtime method must be present in W2ASDK')

  const runtimeModule = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const runtimeExports = Object.keys(runtimeModule).sort()
  const declaredValueExports = [...types.matchAll(
    /^export (?:declare )?(?:function|const|let|class|var)\s+([A-Za-z][A-Za-z0-9]*)/gm,
  )].map((match) => match[1]).sort()
  assert.deepEqual(declaredValueExports, runtimeExports,
    'every runtime module export must have a declaration, with no declared value missing at runtime')
})

test('public config types cover supported runtime keys without exposing internal controls', async () => {
  const [source, types] = await Promise.all([
    readFile(join(ROOT, 'src/index.js'), 'utf8'),
    readFile(join(ROOT, 'types/index.d.ts'), 'utf8'),
  ])
  const runtimeKeys = new Set(Array.from(source.matchAll(/this\.cfg(?:\?)?\.([A-Za-z_$][\w$]*)/g), (m) => m[1]))
  const configBody = types.match(/export interface W2AConfig \{([\s\S]*?)\n\}/)?.[1] || ''
  const declaredKeys = new Set(Array.from(configBody.matchAll(/^\s*([A-Za-z_$][\w$]*)\??:/gm), (m) => m[1]))
  const runtimeOnly = new Set(['allowSyntheticClicks', 'cell', 'debugOverlay', 'deviceOverride',
    'diagnosticCapability', 'siteId'])
  const deprecatedNoops = new Set(['antiMisclickMs'])
  const missing = [...runtimeKeys].filter((key) => !declaredKeys.has(key) && !runtimeOnly.has(key)).sort()
  const unused = [...declaredKeys].filter((key) => !runtimeKeys.has(key) && !deprecatedNoops.has(key)).sort()
  const leakedInternal = [...runtimeOnly].filter((key) => declaredKeys.has(key)).sort()
  const staleInternal = [...runtimeOnly].filter((key) => !runtimeKeys.has(key)).sort()
  const missingDeprecated = [...deprecatedNoops].filter((key) => !declaredKeys.has(key)).sort()

  assert.deepEqual(missing, [], `runtime config keys missing from W2AConfig: ${missing.join(', ')}`)
  assert.deepEqual(unused, [], `W2AConfig keys ignored by runtime: ${unused.join(', ')}`)
  assert.deepEqual(leakedInternal, [], `runtime-only config keys leaked into W2AConfig: ${leakedInternal.join(', ')}`)
  assert.deepEqual(staleInternal, [], `stale runtime-only config allowlist entries: ${staleInternal.join(', ')}`)
  assert.deepEqual(missingDeprecated, [],
    `deprecated compatibility keys missing from W2AConfig: ${missingDeprecated.join(', ')}`)
})

test('rewarded docs preserve the per-show latch through every terminal', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  assert.ok(readme.includes("if (requestId && e.requestId !== requestId) return"),
    'the sample must isolate concurrent or stale show events')
  assert.ok(readme.includes('TERMINAL.has(e.state)'),
    'a later terminal must not revoke a reward already latched by the show')
  assert.ok(readme.includes('videoRewardMs: 30000'),
    'the public release must state the 30-second advancing-playback gate')
  assert.ok(readme.includes("reason: 'closed_before_reward'"),
    'the public release must state early-close semantics')
})

test('the integration sample prepares near opportunities and owns partner fallbacks', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  for (const required of [
    'const preparations = new Map()',
    'const READY_HEADROOM_MS = 5000',
    'function onLevelAlmostComplete()',
    'function onContinueOpportunity()',
    'let adOpportunityBusy = false',
    "if (claim.reason === 'busy')",
    'Promise.resolve(partnerShow)',
    'if (earned === true) grantReward()',
  ]) {
    assert.ok(readme.includes(required), `README use sample must include ${required}`)
  }
})

test('the integration sample refreshes expiring ads at explicit near-opportunity signals', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const useSection = readme.match(/## Use[\s\S]*?```js\n([\s\S]*?)\n```/)
  assert.ok(useSection, 'README must contain an executable JavaScript use example')

  let now = 0
  const listeners = new Set()
  const readyUntil = new Map()
  const preloadCalls = []
  const pendingPreloads = []
  const claims = []
  let partnerInterstitial = 0
  let partnerRewarded = 0
  const makeButton = () => ({
    clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this.clickHandler = fn },
    click() { assert.ok(this.clickHandler); this.clickHandler() },
  })
  const levelEndButton = makeButton()
  const continueButton = makeButton()
  const W2A = {
    init() { return sdk },
    on(event, fn) {
      assert.equal(event, 'ad_state')
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(event) { for (const fn of [...listeners]) fn(event) },
  }
  const sdk = {
    preload(format, placement) {
      const key = `${format}|${placement}`
      preloadCalls.push(key)
      return new Promise((resolve) => pendingPreloads.push({ key, resolve }))
    },
    isReady(format, placement, minValidityMs = 0) {
      const until = readyUntil.get(`${format}|${placement}`)
      return until !== undefined && now + minValidityMs <= until
    },
    tryShowReady(format, placement) {
      const key = `${format}|${placement}`
      const started = this.isReady(format, placement)
      const requestId = `jit-${claims.length + 1}`
      claims.push({ format, placement, started, requestId })
      if (started) {
        readyUntil.delete(key)
        W2A.emit({ format, placement, requestId, state: 'opened' })
      }
      return { started, requestId, reason: started ? undefined : 'preload_expired' }
    },
  }
  const sandbox = {
    W2A,
    levelEndButton,
    continueButton,
    showPartnerInterstitial() { partnerInterstitial++ },
    showPartnerRewarded() { partnerRewarded++; return false },
    grantReward() {},
    Promise,
    Set,
  }
  vm.runInNewContext(useSection[1], sandbox, { filename: 'README.md#jit-use' })
  const resolvePreloads = async () => {
    for (const pending of pendingPreloads.splice(0)) {
      readyUntil.set(pending.key, now + 30000)
      pending.resolve({ filled: true, ready: true })
    }
    await Promise.resolve(); await Promise.resolve()
  }

  await resolvePreloads()
  now = 26001
  assert.equal(typeof sandbox.onLevelAlmostComplete, 'function',
    'the sample must expose a bounded signal for the next interstitial opportunity')
  assert.equal(typeof sandbox.onContinueOpportunity, 'function',
    'the sample must expose a bounded signal for the next rewarded opportunity')

  sandbox.onLevelAlmostComplete()
  sandbox.onContinueOpportunity()
  sandbox.onLevelAlmostComplete()
  sandbox.onContinueOpportunity()
  assert.equal(preloadCalls.filter((key) => key === 'interstitial|level_end').length, 2,
    'duplicate signals must share one in-flight interstitial preparation')
  assert.equal(preloadCalls.filter((key) => key === 'rewarded|continue').length, 2,
    'duplicate signals must share one in-flight rewarded preparation')
  await resolvePreloads()
  sandbox.onLevelAlmostComplete()
  sandbox.onContinueOpportunity()
  assert.equal(preloadCalls.filter((key) => key === 'interstitial|level_end').length, 2,
    'a signal must not supersede a fresh ready interstitial')
  assert.equal(preloadCalls.filter((key) => key === 'rewarded|continue').length, 2,
    'a signal must not supersede a fresh ready rewarded ad')

  levelEndButton.click()
  W2A.emit({
    format: 'interstitial', placement: 'level_end', requestId: 'stale-level-end', state: 'closed',
  })
  levelEndButton.click()
  assert.equal(claims.filter((claim) => claim.format === 'interstitial').length, 1,
    'a stale terminal must not release the active interstitial busy guard')
  continueButton.click()
  assert.equal(claims.filter((claim) => claim.format === 'rewarded').length, 0,
    'the shared guard must block a rewarded claim while an interstitial owns the slot')
  const interstitialClaim = claims.find((claim) => claim.format === 'interstitial')
  W2A.emit({
    format: 'interstitial', placement: 'level_end', requestId: interstitialClaim.requestId, state: 'closed',
  })
  continueButton.click()
  assert.equal(claims.filter((claim) => claim.started).length, 2,
    'each refreshed opportunity must be claimed synchronously after ownership is released')
  assert.equal(partnerInterstitial, 0)
  assert.equal(partnerRewarded, 0)
})

test('the integration sample owns partner rewarded fallback until its boolean terminal', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const useSection = readme.match(/## Use[\s\S]*?```js\n([\s\S]*?)\n```/)
  assert.ok(useSection, 'README must contain an executable JavaScript use example')

  const listeners = new Set()
  const partnerResults = []
  let insideClick = false
  let claims = 0
  let partnerCalls = 0
  let grants = 0
  const makeButton = () => ({
    clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this.clickHandler = fn },
    click() {
      assert.ok(this.clickHandler)
      insideClick = true
      try { this.clickHandler() } finally { insideClick = false }
    },
  })
  const levelEndButton = makeButton()
  const continueButton = makeButton()
  const sdk = {
    preload() { return Promise.resolve({ filled: false, ready: false, reason: 'no_bid' }) },
    isReady() { return false },
    tryShowReady(format, placement) {
      claims++
      return { started: false, requestId: `fallback-${claims}`, format, placement, reason: 'not_ready' }
    },
  }
  const W2A = {
    init() { return sdk },
    on(event, fn) {
      assert.equal(event, 'ad_state')
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const sandbox = {
    W2A,
    levelEndButton,
    continueButton,
    showPartnerInterstitial() {},
    showPartnerRewarded() {
      assert.equal(insideClick, true, 'partner fallback must start before the trusted click returns')
      partnerCalls++
      return new Promise((resolve, reject) => partnerResults.push({ resolve, reject }))
    },
    grantReward() { grants++ },
    Promise,
    Set,
  }
  vm.runInNewContext(useSection[1], sandbox, { filename: 'README.md#partner-rewarded-use' })

  continueButton.click()
  continueButton.click()
  assert.equal(claims, 1, 'the partner show must retain the same busy guard as a W2A show')
  assert.equal(partnerCalls, 1)
  partnerResults.shift().resolve(true)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(grants, 1, 'only an explicit partner-earned result grants the reward')

  continueButton.click()
  partnerResults.shift().resolve(false)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(grants, 1, 'a declined partner reward must not grant')

  continueButton.click()
  partnerResults.shift().reject(new Error('partner unavailable'))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(grants, 1, 'a rejected partner show must not grant')
  continueButton.click()
  assert.equal(partnerCalls, 4, 'a rejected partner show must release the busy guard')
})

test('the integration sample serializes all providers and never passes back an SDK busy refusal', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const useSection = readme.match(/## Use[\s\S]*?```js\n([\s\S]*?)\n```/)
  assert.ok(useSection, 'README must contain an executable JavaScript use example')

  const listeners = new Set()
  const claims = []
  let active = null
  let externallyBusy = false
  let partnerInterstitial = 0
  let partnerRewarded = 0
  const makeButton = () => ({
    clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this.clickHandler = fn },
    click() { assert.ok(this.clickHandler); this.clickHandler() },
  })
  const levelEndButton = makeButton()
  const continueButton = makeButton()
  const W2A = {
    init() { return sdk },
    on(event, fn) {
      assert.equal(event, 'ad_state')
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(event) { for (const fn of [...listeners]) fn(event) },
  }
  const sdk = {
    preload() { return Promise.resolve({ filled: true, ready: true }) },
    isReady() { return true },
    tryShowReady(format, placement) {
      const requestId = `owned-${claims.length + 1}`
      if (active || externallyBusy) {
        claims.push({ format, placement, started: false, reason: 'busy' })
        return { started: false, reason: 'busy' }
      }
      active = { format, placement, requestId }
      claims.push({ ...active, started: true })
      W2A.emit({ ...active, state: 'opened' })
      return { started: true, requestId }
    },
  }
  vm.runInNewContext(useSection[1], {
    W2A,
    levelEndButton,
    continueButton,
    showPartnerInterstitial() { partnerInterstitial++; return Promise.resolve() },
    showPartnerRewarded() { partnerRewarded++; return false },
    grantReward() {},
    console,
    Promise,
    Set,
  }, { filename: 'README.md#shared-ownership' })
  await Promise.resolve(); await Promise.resolve()

  levelEndButton.click()
  continueButton.click()
  assert.equal(claims.length, 1, 'one shared guard must block a cross-format claim')
  assert.equal(partnerRewarded, 0, 'a blocked click must not start another provider')

  const interstitial = active
  active = null
  W2A.emit({ ...interstitial, state: 'closed' })
  externallyBusy = true
  continueButton.click()
  assert.equal(partnerRewarded, 0, 'an SDK busy refusal must not pass back to a second provider')
  externallyBusy = false
  continueButton.click()
  assert.equal(claims.at(-1).started, true, 'the busy refusal must release the local guard')
  assert.equal(partnerInterstitial, 0)
})

test('AppsFlyer guidance separates generic ingress from unavailable account routes', async () => {
  const integration = await readFile(join(ROOT, 'INTEGRATION.md'), 'utf8')

  assert.ok(integration.includes('generic MMP ingress'))
  assert.ok(integration.includes('not available on the current AppsFlyer plan'))
  assert.ok(integration.includes('subscription package missing'))
  assert.ok(integration.includes('Aggregated API'))
  assert.ok(integration.includes('af_sub1'))
  assert.ok(integration.includes('Sub param 1'))
  assert.doesNotMatch(integration, /## Install postbacks \(AppsFlyer Push API\)/)
})

test('README identifies the prepared 0.2.3 candidate without claiming publication', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')

  assert.ok(readme.includes('Release status: prepared, not yet published on the CDN'))
  assert.ok(readme.includes('supersedes 0.2.2'))
  assert.ok(readme.includes('have not yet been verified'))
  assert.match(readme, /npm remains\s+outside this release procedure/)
})

test('the build uses one exact official esbuild dependency and is byte reproducible', async () => {
  const [pkg, lock] = await Promise.all([
    readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(ROOT, 'package-lock.json'), 'utf8').then(JSON.parse),
  ])

  assert.equal(pkg.scripts.build, 'node build.mjs')
  assert.equal(pkg.devDependencies?.esbuild, '0.28.1')
  assert.equal(lock.packages?.['']?.devDependencies?.esbuild, '0.28.1')
  assert.equal(lock.packages?.['node_modules/esbuild']?.version, '0.28.1')

  const { buildSdk } = await import('../build.mjs')
  const outdir = await mkdtemp(join(tmpdir(), 'w2a-sdk-build-'))
  try {
    await buildSdk({ outdir })
    for (const relativePath of Object.keys(RELEASE_SNAPSHOT.artifacts)) {
      const filename = relativePath.slice('dist/'.length)
      assert.deepEqual(await readFile(join(outdir, filename)), await readFile(join(ROOT, relativePath)),
        `${filename} must rebuild byte-identically`)
    }
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
})

test('npm pack contains exactly the reviewed public contract', async () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout } = await execFileAsync(npm, ['pack', '--dry-run', '--json'], { cwd: ROOT })
  const [pack] = JSON.parse(stdout)
  const paths = pack.files.map((file) => file.path).sort()

  assert.deepEqual(paths, [
    'INTEGRATION.md',
    'LICENSE',
    'README.md',
    'dist/w2a-sdk.esm.js',
    'dist/w2a-sdk.iife.js',
    'dist/w2a-sdk.min.js',
    'package.json',
    'release.json',
    'types/index.d.ts',
  ])
})
