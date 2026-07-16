# Shared cross-platform test fixtures (#421)

Golden-set JSON fixtures for the algorithms that are duplicated between the web
app (`src/lib/**`, TypeScript) and the iOS app (`ios/StillPointShared`, Swift).
Both test suites load the **same** files, so any drift between the two
implementations breaks CI on at least one platform.

## Fixtures

| File | Web impl (vitest) | iOS impl (XCTest) |
| --- | --- | --- |
| `clearPercent.json` | `computeClearPercentFromLog` (`src/lib/mindStateSession.ts`) | `SessionLogic.calculateClearPercent` (`SessionLogic.swift`) |
| `historyJourney.json` | `buildHistoryJourneyRows` (`src/lib/historyJourney.ts`) | `HistoryJourney.buildRows` (`HistoryJourney.swift`) |
| `sessionStats.json` | `calculateSessionStats` (`src/lib/constants.ts`) | `SessionStatistics.calculateStats` (`HistoryJourney.swift`) |
| `breathCounting.json` | `breathCountForTaps` / `phaseForTaps` / `elapsedDisplay` (`src/lib/breathCounting.ts`) | `BreathCounting.breathCount` / `phase` / `elapsedDisplay` (`BreathCountingLogic.swift`) |
| `aphorisms.json` | `aphorismForDay` (`src/lib/aphorisms.ts`) | `Aphorisms.forDay` (`Aphorisms.swift`) |
| `buddyCalendarColors.json` | `buddyColorFromUserId` (`src/lib/buddyCalendarColors.ts`) | `buddyColorIndexFromUserId` (`BuddyCalendarColors.swift`) |
| `durationForDay.json` | `durationForDay` / `isDualTrackEligible` (`src/lib/constants.ts`, `src/lib/duration.ts`) | `StillPoint.duration(forDay:)` / `isDualTrackEligible` (`Constants.swift`). `advanceProgression` and `detectMissedDayGap` cases are web-only until iOS recovery parity (#524). |
| `pathway.json` | `buildPathway` / `nodeStateForDay` (`src/lib/pathway.ts`) | `Pathway.build` / `Pathway.nodeState(forDay:currentDay:)` (`Pathway.swift`) |

## How each suite loads them

- **Web / vitest** — `loadFixture(name)` in `src/lib/testing/sharedFixtures.ts`
  reads the JSON from this directory (resolved relative to the repo root). The
  parity suites live next to each source file (e.g. `historyJourney.test.ts`).
- **iOS / XCTest** — `SharedFixtures.load(_:)` in
  `ios/StillPointShared/Tests/StillPointSharedTests/SharedFixtures.swift`
  resolves this directory from the test file's `#filePath` and decodes each
  fixture with `Codable`. `swift test` compiles from the checked-out source
  tree, so the path is valid both locally and in CI.

## Cross-platform value conventions

These fixtures only contain inputs where **both** implementations produce
identical golden values. To keep them in agreement:

- **clearPercent** — cases avoid exact `.5` percentages (JS `Math.round`
  rounds half up; Swift `rounded()` rounds half away from zero) and always use
  a non-empty log with `endTime > 0` so both share the empty/zero-elapsed guard.
- **sessionStats** — every session sets `actualTime = duration + bonusSeconds`
  so the thoughts-per-minute denominators match (web divides by
  `duration + bonusSeconds`, iOS by `actualTime`). Averages are kept on clean
  values because web rounds to one decimal while iOS returns a raw `Double`
  (the iOS suite asserts these with a small tolerance). Web exposes
  `bonusSecondsTotal`; iOS exposes `bonusMinutesTotal` — both are provided.
  Note the inclusion-rule asymmetry: `avgClearPercent` is computed from
  **completed standard sessions only**, while `avgThoughtsPerSession` and
  `avgThoughtsPerMinute` average across **all standard sessions** (completed or
  not) using a per-session-rate average. When adding cases, make sure the
  fixture's expected values respect this difference.
- **historyJourney** — each session has a distinct `createdAt`, which web feeds
  as its `sortKey`, so ordering is identical to iOS (`sessionDate`, then
  `createdAt`, then `id`) without relying on the id tiebreaker.
- **breathCounting** — only non-negative `taps` are included; web clamps
  negatives to 0 while iOS does not, so negative inputs are platform-specific
  and tested per-suite. Wall-clock `elapsedSeconds` is omitted because its
  input is a platform-specific timestamp/`Date` rather than a portable scalar.

When adding a case, prefer inputs whose expected values are exact on both
platforms; otherwise document the tolerance in the loading suite.
