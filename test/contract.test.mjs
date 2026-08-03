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
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The single canonical address, and the hosts that must never be configured again.
const CANONICAL = 'https://w2a-ads-demo.azurewebsites.net'
const RETIRED = ['w2a-demo.onrender.com']

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
