# Release procedure

## Goal

Publish one reviewed SDK snapshot from the private core repository through this
public release mirror, with an immutable version URL and verifiable artifact
hashes.

## Prerequisites

- A clean, pushed `main` in both repositories.
- Node.js and the package build dependencies already used by this repository.
- GitHub CLI authentication with permission to push this mirror and manage its
  release tags.
- The release version must be new. Never reuse an existing tag.

Secrets come from the existing GitHub CLI credential store. Do not copy tokens
into repository files, shell history, release notes or test output.

## Steps

1. Set `CORE_REPO` and `MIRROR_REPO` to the two checkout paths.
2. Copy `sdk-pkg/src/index.js`, all three `sdk-pkg/dist` JavaScript artifacts,
   and `sdk-pkg/types/index.d.ts` from the reviewed core commit.
3. Bump the package version and update `release.json` with the core commit,
   source hash, artifact hashes, CDN URL and SRI.
4. Run `npm run build`, then confirm the rebuilt files are byte-identical to the
   committed release artifacts.
5. Run `npm test` and `npm pack --dry-run`.
6. Commit and push the mirror. Create a new semver tag only after the commit is
   on `origin/main`.
7. Confirm the repository is public, push the tag, and wait for the exact
   jsDelivr URL in `release.json` to return HTTP 200 JavaScript.
8. Compare the downloaded SHA-256 and SRI with `release.json` before updating a
   partner integration.

## Verification

- `git status --short` is empty and `HEAD` equals `origin/main`.
- `npm test` passes all release and integration contract checks.
- `npm pack --dry-run` contains `dist`, `types`, `README.md` and `release.json`.
- Every dist banner names the source SHA-256 from `release.json`.
- The exact jsDelivr URL returns the recorded minified artifact bytes.
- A partner fallback, if shipped, is byte-identical to the same minified file
  and uses the same SRI.

## Failure paths

- If rebuild bytes differ, stop and resolve the build tool or source mismatch.
- If the tag already exists, choose a new version. Do not move or replace it.
- If jsDelivr returns 404, verify repository visibility, tag existence and file
  path. Do not switch the partner integration to a mutable branch URL.
- If the CDN hash differs, do not publish the partner revision. Create a new
  release after finding the source of the mismatch.
