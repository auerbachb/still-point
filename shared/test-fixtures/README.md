# Shared cross-platform test fixtures (#421)

Golden-set JSON fixtures for the algorithms that are duplicated between the web
app (`src/lib/**`, TypeScript, vitest) and the iOS app (`ios/StillPointShared`,
Swift, Swift Testing). Both test suites load the **same** files, so drift
between the two implementations fails at least one suite — see
[Adding a fixture](#adding-a-fixture) for when the iOS suite actually runs.

## Fixtures

The table is an index only. Each fixture's contract lives in its note under
[Per-fixture notes](#per-fixture-notes).

| File | Web impl (`src/lib/`) | iOS impl (`StillPointShared`) |
| --- | --- | --- |
| `clearPercent.json` | `computeClearPercentFromLog` (`mindStateSession.ts`) | `SessionLogic.calculateClearPercent` (`SessionLogic.swift`) |
| `historyJourney.json` | `buildHistoryJourneyRows` (`historyJourney.ts`) | `HistoryJourney.buildRows` (`HistoryJourney.swift`) |
| `sessionStats.json` | `calculateSessionStats` (`constants.ts`) | `SessionStatistics.calculateStats` (`HistoryJourney.swift`) |
| `breathCounting.json` | `breathCountForTaps` / `phaseForTaps` / `elapsedDisplay` (`breathCounting.ts`) | `BreathCounting.breathCount` / `phase` / `elapsedDisplay` (`BreathCountingLogic.swift`) |
| `aphorisms.json` | `aphorismForDay` (`aphorisms.ts`) | `Aphorisms.forDay` (`Aphorisms.swift`) |
| `buddyCalendarColors.json` | `buddyColorFromUserId` (`buddyCalendarColors.ts`) | `buddyColorIndexFromUserId` (`BuddyCalendarColors.swift`) |
| `durationForDay.json` | `durationForDay` (`constants.ts`); `isDualTrackEligible` / `advanceProgression` / `detectMissedDayGap` / `recoveryStepDuration` (`duration.ts`) | `StillPoint.duration(forDay:)` / `isDualTrackEligible` (`Constants.swift`); `DurationRecovery.advanceProgression` / `detectMissedDayGap` / `recoveryStepDuration` (`DurationRecovery.swift`) |
| `pathway.json` | `buildPathway` / `nodeStateForDay` (`pathway.ts`) | `Pathway.build` / `Pathway.nodeState(forDay:currentDay:)` (`Pathway.swift`) |
| `combinedSit.json` | `combinedDurationForUser` / `isCombineOffered` (`combinedSit.ts`); `tracksCredited` (`sessionCalendar.ts`) | `CombinedSit.combinedDuration` / `isCombineOffered` / `tracksCredited` (`CombinedSit.swift`) |
| `focusDuration.json` | `FOCUS_DURATION_CONFIG` / `focusDurationForDay` / `shouldAdvanceFocusDay` (`constants.ts`); `advanceFocusActivityDay` (`duration.ts`) | `StillPoint.focusDurationConfig` / `focusDuration(forDay:)` / `shouldAdvanceFocusDay` / `advanceFocusActivityDay` (`Constants.swift`) |
| `focusActivity.json` | `formatFocusGoal` / `formatFocusCountdown` / `focusCountdownFontSize` / `focusRemainingSeconds` / `resolveFocusEnd` / `focusActivityDayAfterCompletedSave` (`focusActivity.ts`); `FOCUS_ACTIVITIES` (`focusActivityContent.ts`) | `FocusActivity.formatGoal` / `countdownDisplay` / `countdownShowsHours` / `remainingSeconds` / `resolveEnd` / `focusActivityDayAfterCompletedSave`, `FocusCategory.pickerDescription` (`FocusActivityLogic.swift`); `FocusCategory.displayLabel` (`Constants.swift`) |
| `guidedExercise.json` | `clampStepIndex` / `isLastStep` / `nextStepIndex` / `previousStepIndex` / `stepProgressFraction` / `totalDurationMs` / `exerciseSummary` (`guidedExercise.ts`) | `GuidedExerciseLogic` — the same seven functions (`GuidedExerciseLogic.swift`) |

## How each suite loads them

- **Web / vitest** — `loadSharedFixture<T>(fileName)` in
  `src/lib/testing/sharedFixtures.ts` resolves this directory relative to its
  own source file and parses the JSON. The parity tests live in `src/lib/`,
  but their file names do not always match the implementation file (for
  example `sessionStats.json` is asserted in `sessionProgression.test.ts`, and
  `buddyCalendarColors.json` in `buddyCalendar.test.ts`).
- **iOS / Swift Testing** — `SharedFixtures.load(_:as:)` in
  `ios/StillPointShared/Tests/StillPointSharedTests/SharedFixtures.swift`
  resolves this directory from the test file's `#filePath` and decodes each
  fixture with `Decodable`. The test target declares no `resources:`, so the
  fixtures must stay at `shared/test-fixtures/` in the checked-out tree;
  `swift test` compiles from that tree, so the path is valid locally and in CI.

## Per-fixture notes

These fixtures only contain inputs where **both** implementations produce
identical golden values. Each note is the single place for that fixture's
contract.

- **clearPercent** — includes an empty log, for which both platforms return
  100. The other cases use a positive `endTime` and avoid exact `.5`
  percentages; for these nonnegative values JS `Math.round` and Swift
  `rounded()` both round halfway values up, so they agree. Not covered: a
  non-empty log with `endTime` 0, or a sub-second `endTime`. There the platforms
  differ (web divides by `max(endTime, 1)`; iOS returns 100 for any
  `totalElapsed <= 0` and divides by `totalElapsed`), so such cases are
  platform-specific.
- **sessionStats** — every session sets `actualTime = duration + bonusSeconds`
  so the thoughts-per-minute denominators match (web divides by
  `duration + bonusSeconds`, iOS by `actualTime`). Web exposes
  `bonusSecondsTotal`; iOS exposes `bonusMinutesTotal` — both are provided.
  Averages are kept on clean values: web rounds the thought averages to one
  decimal while iOS returns a raw `Double` (asserted within `0.05`), and web
  rounds `avgClearPercent` with `Math.round` while iOS uses integer division.
  Inclusion-rule asymmetry: `avgClearPercent` is computed from **completed
  standard sessions only**, while `avgThoughtsPerSession` and
  `avgThoughtsPerMinute` average across **all standard sessions** (completed or
  not) using a per-session-rate average. Expected values must respect this
  difference.
- **historyJourney** — each session has a distinct `createdAt`, which web feeds
  as its `sortKey`, so ordering is identical to iOS (`sessionDate`, then
  `createdAt`, then `id`) without relying on the id tiebreaker.
- **breathCounting** — only non-negative `taps` are included; web clamps
  negatives to 0 while iOS does not, so negative inputs are platform-specific
  and tested per-suite. Wall-clock `elapsedSeconds` is omitted because its
  input is a platform-specific timestamp/`Date` rather than a portable scalar.
- **aphorisms** — parity checks the list length (`expectedCount`) and which
  index each day resolves to, not the aphorism text itself.
- **buddyCalendarColors** — web returns the hex string, iOS the palette index;
  both suites also check the fixture's palette and pinned indices.
- **durationForDay** — duration and recovery run on both clients via
  `DurationRecovery.swift` (#524). `recoveryStepDuration` expectations are
  snapped to whole 10-second blocks (#661). Days are 1 or more, because iOS's
  meditation `duration(forDay:)` asserts on days below 1 in debug builds.
- **pathway** — the preview uses the coming-soon state for every node, not the
  day count (#587).
- **combinedSit** — today's two sits done as one (#769), loaded on iOS by
  `CombinedSitTests` (#896). A combined sit is both tracks' planned lengths
  added together, ignoring recovery, and a combined row credits both tracks
  whatever its `track`.
- **focusDuration** — the focus goal (#765): 1 min, +1 min per completed focus
  session, 2 h cap, no recovery ramp; only a completed focus session steps
  `focusActivityDay`, by one (#839). Includes day 0, which both platforms treat
  as day 1 — only the focus ramp can carry such a case (see `durationForDay`).
- **focusActivity** — the focus timer (#840): its goal and countdown text, the
  wall-clock countdown, what an end saves, the goal step after a completed
  save, and the picker's cards. Web maps the countdown to a font size, iOS to
  `countdownShowsHours`. Times are milliseconds after the session started
  (`elapsedMs`); web adds them to a start timestamp, iOS to a start `Date`.
  Seconds inputs are whole numbers, because web floors a fractional second and
  iOS takes an `Int`; `focusActivityDayAfterCompletedSave` always has a counter,
  because only web's takes a missing one.
- **guidedExercise** — step index math, per-step progress, total duration, and
  exercise summaries. Web asserts `stepProgressFraction` exactly; iOS within
  `0.0001`.

When adding a case, prefer inputs whose expected values are exact on both
platforms; otherwise document the tolerance in the loading suite.

## Adding a fixture

No automated check enforces these steps, so do all of them:

1. Add the JSON file here with `algorithm` and `description` keys.
2. Add its TypeScript type in `src/lib/testing/sharedFixtures.ts`.
3. Add its `Decodable` model in `SharedFixtures.swift`.
4. Add a consumer test on each platform.
5. Add one row to the table above and one per-fixture note.

The iOS CI workflow (`.github/workflows/ios-shared-tests.yml`) runs the real
`swift test` only when a PR touches `ios/StillPointShared/`,
`ios/StillPointModels/`, or that workflow. A PR that changes only files in this
directory gets the no-op pass, so run `swift test` in `ios/StillPointShared`
locally (see `ios/SWIFT_PACKAGES.md`) before pushing a fixture change.
