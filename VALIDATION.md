# MergePaid verification

Verified locally on 17 November 2026 using Node.js 24.7.0 on Windows.

## Build

`npm.cmd run build` — passed. Vite 6.4.6 compiled 1,571 modules. Final application JavaScript is approximately 198 kB before gzip, 59 kB gzipped.

## Automated tests

`npm.cmd test` — 2 integration tests passed, 0 failures. These tests execute multiple assertions and negative transactions:

- Real Solidity deployment and real Ganache transactions.
- Matching applies 1:1 and never exceeds the pre-funded reserve.
- Only the reviewer can open review and finalize.
- Funding is rejected after review opens.
- Allocations must total exactly the funded pool.
- Duplicate recipient entries are rejected.
- Contributor claims transfer funds; duplicate claims fail.
- All allocated rewards can be claimed without leaving unallocated pool funds.
- API rejects actions from the wrong demo role.
- Contributors cannot appeal someone else's contribution.
- Unresolved appeals block finalization.
- Score changes, review explanations, and appeal resolutions enable finalization.
- Finalized scores cannot be edited.
- Downloaded canonical allocation evidence matches its keccak256 hash.
- API rejects writes from an unrelated browser origin.

## Browser walkthrough

Verified through the Codex in-app browser, with actual clicks and form inputs:

1. Dashboard rendered the three sample rounds and their on-chain balances.
2. Switched from maintainer to sponsor.
3. Sponsored 0.1 local ETH in the Orbit sample round; pool increased from 2.4 to 2.6 ETH and remaining matching reserve decreased from 0.3 to 0.2 ETH.
4. Switched to maintainer and closed funding to open review.
5. Switched to Sam and submitted an appeal on the documentation contribution.
6. Switched to maintainer, adjusted impact from 26 to 30 and complexity from 14 to 20, and saved a public explanation. Total score changed from 54 to 64.
7. Resolved the appeal with a public reason.
8. Finalized the full pool on-chain.
9. Switched to Sam, opened My rewards, and claimed approximately 0.7633 local ETH.
10. Available rewards became zero and the Claim button became a disabled Claimed button.

Captured browser warning/error logs were empty after this flow. Ganache's optional native-module fallback warning is a server-side compatibility notice, not a failed test.

Visual QA covered a wide desktop layout and a 514 px layout. The latter had a 514 px document width with no horizontal page overflow. The rewards view and mobile navigation were exercised at that width. This is not exhaustive cross-browser or accessibility certification.

## Live public GitHub import

Created a round for `vitejs/vite` and imported six actual merged PRs. Source URLs included PRs #24123, #24125, #24049, #24108, #24106, and #24067 at verification time. All imported contributions were correctly marked Needs review. No GitHub account or repository was modified.

## Local endpoints

- Frontend: http://127.0.0.1:5187
- API: http://127.0.0.1:3017/api/health
- Production build when running `npm start`: http://127.0.0.1:3017

Both HTTP readiness and the API health response were verified. Original port 5173 was occupied by another app, so MergePaid uses 5187 without modifying that app.

The final Desktop copy is intended to start with clean sample state so the presentation can be repeated. All in-memory state resets when the server restarts. See README.md for the presentation script and prototype limitations.
