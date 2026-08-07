# Release procedure

## Goal

Publish one reviewed SDK snapshot from the private core repository through this
release mirror. The release must use an immutable version URL, identify its core
provenance, rebuild byte-for-byte, and contain only the reviewed public files.

Registry publication is a separate decision. `npm pack` validates the package,
but this procedure does not authorize `npm publish`.

## Prerequisites

- The reviewed core commit is final and available by its full 40-character SHA.
- The SDK paths in the core checkout have no uncommitted changes.
- Node.js 18 or later and npm are installed.
- GitHub CLI authentication can push this mirror and inspect repository
  visibility and tags.
- The release version is new. Never reuse or move an existing release tag.
- External publication, repository visibility changes, pushes and tags have
  explicit owner approval.

Build dependencies come from `package-lock.json`. Official `esbuild` installs a
platform-specific binary, so do not use `--ignore-scripts` or `--no-optional`.
GitHub credentials remain in the existing credential store. Do not copy tokens
into repository files, shell history, release notes or test output.

## Prepare the candidate

1. Record the full reviewed core SHA.
2. From that same commit, copy these files into the mirror:
   - `w2a-demo/sdk-pkg/src/index.js` to `src/index.js`
   - all three `w2a-demo/sdk-pkg/dist/w2a-sdk*.js` files to `dist/`
   - `w2a-demo/sdk-pkg/types/index.d.ts` to `types/index.d.ts`
   - the core `LICENSE` to `LICENSE`
3. Update `package.json`, `package-lock.json`, `README.md`, `INTEGRATION.md`,
   and `release.json`. Record the core SHA, source hash, type hash, license hash,
   three bundle hashes, minified SRI, immutable CDN URL, exact build tool and a
   timestamped machine-readable publication check.
4. Install exactly the locked dependency graph:

   ```bash
   npm ci
   ```

5. Rebuild all bundles with the cross-platform Node.js runner:

   ```bash
   npm run build
   ```

6. Run the offline contract, provenance, rebuild and pack gates:

   ```bash
   npm test
   npm pack --dry-run --json
   git diff --check
   ```

The pack allowlist is exactly:

- `INTEGRATION.md`
- `LICENSE`
- `README.md`
- `dist/w2a-sdk.esm.js`
- `dist/w2a-sdk.iife.js`
- `dist/w2a-sdk.min.js`
- `package.json`
- `release.json`
- `types/index.d.ts`

## Publish after approval

1. Review the complete diff and stage only the release files.
2. Commit the mirror candidate and push its commit to `origin/main`.
3. Confirm the repository is public and the version tag does not exist.
4. Create the semver tag on the reviewed mirror commit, then push that tag once.
5. Wait for the exact jsDelivr URL in `release.json` to return JavaScript.
6. Download that exact URL and compare its SHA-256 and SRI with `release.json`.
7. Only after those checks, update a partner integration to the immutable URL.

## Verification

- `release.json.coreCommit` is the reviewed core SHA, and the copied source,
  types and license match the recorded hashes.
- `package-lock.json` resolves `esbuild` 0.28.1 and `npm ci` succeeds.
- `npm run build` leaves all three committed bundles byte-identical.
- `npm test` passes every offline release and integration contract check.
- `npm pack --dry-run --json` contains exactly the allowlist above.
- After commit, `git status --short` is empty and `HEAD` equals `origin/main`.
- The public tag points to that same mirror commit and is never moved.
- The exact jsDelivr bytes match the minified SHA-256 and SRI in `release.json`.
- The deployment `/version.sdkSha256` matches `release.json.sourceSha256` and
  the `w2a-src-sha256` banner in the loaded bundle. Exact bundle bytes are
  verified separately against their artifact SHA-256 and SRI.

## Failure paths

- If any copied hash differs from the reviewed core snapshot, stop and recopy
  from the recorded commit. Do not mix files from different commits.
- If `npm ci` cannot install the platform binary, restore normal lifecycle
  scripts and optional dependencies before diagnosing anything else.
- If rebuilt bytes differ, stop and inspect the source hash, exact esbuild
  version and build options. Do not overwrite the manifest with unexpected bytes.
- If the tag already exists, choose a new version. Do not move or replace it.
- If the repository is private or jsDelivr returns 404, do not claim that the
  CDN route is published and do not switch to a mutable branch URL.
- If CDN bytes differ, do not update a partner. Find the mismatch and create a
  new immutable release if any released byte must change.
- If npm is still unpublished, keep the npm example labelled unavailable. A
  successful pack gate is not proof of registry publication.
