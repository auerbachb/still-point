import Foundation

// MARK: - Focus grid-tap game (#1192, port of web `src/lib/focusGameLogic.ts`)

/// The grid-tap attention game (#680 web v1, #1192 iOS port). A countdown runs for
/// the chosen duration. Squares in a grid light up at random, one at a time, with a
/// minimum quiet gap between lights. Tapping the lit square scores a hit. If the lit
/// square is not tapped within the response window the countdown starts over. A tap
/// on any other square is a wrong tap: it is counted and changes nothing else.
///
/// Pure rules, mirroring web function for function: no timers, no UI. The view owns
/// the wall clock and the random source and calls in with integer milliseconds, so
/// every rule is unit-tested with a fixed clock and a scripted random source.
/// `shared/test-fixtures/focusGame.json` is read by this suite and by web's vitest,
/// so the two implementations cannot drift.
public enum FocusGameLogic {
    /// Grid width; the grid is always this many columns wide.
    public static let columns = 3
    /// Rows on a tall viewport. Short viewports get fewer (`rowsForHeight`).
    public static let maxRows = 8
    public static let minRows = 4

    /// Timing rules, in milliseconds. The single place to tune the game's difficulty.
    public struct Timing: Equatable, Sendable {
        /// A lit square must be tapped within this long after it lights, or the countdown resets.
        public let responseMs: Int
        /// Minimum quiet time between one resolved light (hit or reset) and the next.
        public let minGapMs: Int
        /// Extra random quiet time on top of `minGapMs`, drawn uniformly.
        public let extraGapMaxMs: Int

        public static let standard = Timing(responseMs: 1000, minGapMs: 2000, extraGapMaxMs: 6000)

        public init(responseMs: Int, minGapMs: Int, extraGapMaxMs: Int) {
            self.responseMs = responseMs
            self.minGapMs = minGapMs
            self.extraGapMaxMs = extraGapMaxMs
        }
    }

    public static let timing = Timing.standard

    /// The durations the start screen offers, in seconds.
    public static let durationsSeconds = [60, 180, 300, 600]
    public static let defaultDurationSeconds = 300

    /// Gap between grid rows and columns, in px. The view's grid uses the same value.
    public static let gridGapPx = 8

    /// Space the view takes above and below the grid, conservative on purpose.
    public static let reservedPx = 260

    /// A square that is lit right now, and when it lit.
    public struct Lit: Equatable, Sendable {
        public let cell: Int
        public let litAtMs: Int

        public init(cell: Int, litAtMs: Int) {
            self.cell = cell
            self.litAtMs = litAtMs
        }
    }

    public struct State: Equatable, Sendable {
        /// The chosen duration, in milliseconds.
        public var goalMs: Int
        /// When the whole game started. Never moves on a reset: the saved session counts from here.
        public var startedAtMs: Int
        /// When the current countdown run started: the start, or the last reset.
        public var countdownStartMs: Int
        /// The lit square, or nil between lights.
        public var lit: Lit?
        /// The earliest moment the next square may light. Only read while nothing is lit.
        public var nextLightAtMs: Int
        /// The square that lit last, so the same square never lights twice in a row.
        public var lastCell: Int?
        public var hits: Int
        public var wrongTaps: Int
        public var resets: Int
        /// Consecutive hits since the last reset.
        public var streak: Int
        public var bestStreak: Int

        public init(
            goalMs: Int,
            startedAtMs: Int,
            countdownStartMs: Int,
            lit: Lit?,
            nextLightAtMs: Int,
            lastCell: Int?,
            hits: Int,
            wrongTaps: Int,
            resets: Int,
            streak: Int,
            bestStreak: Int
        ) {
            self.goalMs = goalMs
            self.startedAtMs = startedAtMs
            self.countdownStartMs = countdownStartMs
            self.lit = lit
            self.nextLightAtMs = nextLightAtMs
            self.lastCell = lastCell
            self.hits = hits
            self.wrongTaps = wrongTaps
            self.resets = resets
            self.streak = streak
            self.bestStreak = bestStreak
        }
    }

    /// What a call to `advance` or `tap` did, for the view to show.
    public enum Outcome: String, Equatable, Sendable {
        case none, lit, hit, wrong, reset
    }

    /// Rows that fit a height in px, clamped to [minRows, maxRows]. `cellPx` is the
    /// minimum tap target, so a shorter viewport gets fewer rows, not smaller targets.
    public static func rowsForHeight(_ availablePx: Int, cellPx: Int = 44, gapPx: Int = gridGapPx) -> Int {
        let fit = (max(0, availablePx) + gapPx) / (cellPx + gapPx)
        return min(maxRows, max(minRows, fit))
    }

    /// Row count for a viewport of `viewportPx` height: what is left after the reserved space.
    public static func rowsForViewport(_ viewportPx: Int) -> Int {
        rowsForHeight(viewportPx - reservedPx)
    }

    /// Height in px of a grid with `rows` rows at the minimum tap target and gaps.
    public static func gridHeightPx(_ rows: Int, cellPx: Int = 44, gapPx: Int = gridGapPx) -> Int {
        rows * cellPx + max(0, rows - 1) * gapPx
    }

    /// Quiet time before the next light, drawn from [minGapMs, minGapMs + extraGapMaxMs].
    /// `roll` is a random value in [0, 1), so the draw is `floor(roll * (extra + 1))`.
    public static func nextGapMs(roll: Double) -> Int {
        timing.minGapMs + Int((roll * Double(timing.extraGapMaxMs + 1)).rounded(.down))
    }

    /// A square to light: uniform over `cells`, never `exclude` (the square that lit last).
    /// Consumes exactly one roll, as the web function does.
    public static func pickCell(roll: Double, cells: Int, exclude: Int?) -> Int {
        var pool: [Int] = []
        for cell in 0..<max(0, cells) where cell != exclude {
            pool.append(cell)
        }
        if pool.isEmpty { return 0 }
        let index = min(pool.count - 1, Int((roll * Double(pool.count)).rounded(.down)))
        return pool[index]
    }

    /// A fresh game: the countdown starts now, and the first light is one quiet gap away.
    public static func create(goalSeconds: Int, nowMs: Int, roll: () -> Double) -> State {
        State(
            goalMs: goalSeconds * 1000,
            startedAtMs: nowMs,
            countdownStartMs: nowMs,
            lit: nil,
            nextLightAtMs: nowMs + nextGapMs(roll: roll()),
            lastCell: nil,
            hits: 0,
            wrongTaps: 0,
            resets: 0,
            streak: 0,
            bestStreak: 0
        )
    }

    /// Whole milliseconds left on the countdown. Reads 0 once the goal has elapsed.
    public static func remainingMs(_ state: State, nowMs: Int) -> Int {
        max(0, state.goalMs - (nowMs - state.countdownStartMs))
    }

    /// True once the countdown has run out. No square lights after this.
    public static func isFinished(_ state: State, nowMs: Int) -> Bool {
        remainingMs(state, nowMs: nowMs) == 0
    }

    /// The lit square's response window has passed without a tap.
    private static func expired(_ state: State, nowMs: Int) -> Bool {
        guard let lit = state.lit else { return false }
        return nowMs - lit.litAtMs > timing.responseMs
    }

    /// Applies a missed square: clears it, restarts the countdown, breaks the streak.
    private static func resetCountdown(_ state: State, nowMs: Int, roll: () -> Double) -> State {
        var next = state
        next.lit = nil
        next.countdownStartMs = nowMs
        next.resets += 1
        next.streak = 0
        next.nextLightAtMs = nowMs + nextGapMs(roll: roll())
        return next
    }

    /// The focus session a game saves, or nil when there is nothing to save. The session
    /// counts the whole game: total time played since the start, across every reset, and
    /// `duration` is the chosen goal. An expired countdown is always completed. An early
    /// end is not completed; it saves the time played so far (at least one second).
    public static func result(_ state: State, nowMs: Int, reason: FocusEndReason) -> FocusSessionResult? {
        let goalSeconds = state.goalMs / 1000
        // A countdown that has run out is completed even if the tick that ends the game
        // has not fired yet, so an End press in that window does not save an incomplete session.
        if reason == .expired || isFinished(state, nowMs: nowMs) {
            return FocusSessionResult(duration: goalSeconds, actualTime: goalSeconds, completed: true)
        }
        let played = min(goalSeconds, max(0, nowMs - state.startedAtMs) / 1000)
        if played == 0 { return nil }
        return FocusSessionResult(duration: goalSeconds, actualTime: played, completed: false)
    }

    /// Moves the game to `nowMs` without a tap. Call it on every tick. It either resets
    /// the countdown (the lit square was missed), lights a new square (the quiet gap has
    /// passed and the countdown is still running), or changes nothing.
    public static func advance(
        _ state: State,
        nowMs: Int,
        roll: () -> Double,
        cells: Int
    ) -> (state: State, outcome: Outcome) {
        // Completion wins: once the countdown has run out, a late miss cannot restart it.
        if isFinished(state, nowMs: nowMs) {
            return (state, .none)
        }
        if expired(state, nowMs: nowMs) {
            return (resetCountdown(state, nowMs: nowMs, roll: roll), .reset)
        }
        if state.lit == nil, nowMs >= state.nextLightAtMs, remainingMs(state, nowMs: nowMs) > 0 {
            let cell = pickCell(roll: roll(), cells: cells, exclude: state.lastCell)
            var next = state
            next.lit = Lit(cell: cell, litAtMs: nowMs)
            next.lastCell = cell
            return (next, .lit)
        }
        return (state, .none)
    }

    /// A tap on `cell` at `nowMs`. A lit square that has already expired is handled first,
    /// as a reset, so a tap that lands between ticks cannot rescue a missed square. Then:
    /// the lit square is a hit; any other square is a wrong tap, which counts but does not reset.
    public static func tap(
        _ state: State,
        cell: Int,
        nowMs: Int,
        roll: () -> Double,
        cells: Int
    ) -> (state: State, outcome: Outcome) {
        // Completion wins over a late tap: the game ends on the next check, unchanged.
        if isFinished(state, nowMs: nowMs) {
            return (state, .none)
        }
        if expired(state, nowMs: nowMs) {
            return (resetCountdown(state, nowMs: nowMs, roll: roll), .reset)
        }
        guard let lit = state.lit, lit.cell == cell else {
            var next = state
            next.wrongTaps += 1
            return (next, .wrong)
        }
        var next = state
        next.lit = nil
        next.hits += 1
        next.streak += 1
        next.bestStreak = max(next.bestStreak, next.streak)
        next.nextLightAtMs = nowMs + nextGapMs(roll: roll())
        return (next, .hit)
    }
}
