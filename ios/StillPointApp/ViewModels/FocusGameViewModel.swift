import Foundation
import StillPointShared

// The grid-tap focus game's clock and random source (#1192). The rules are
// `FocusGameLogic`'s, in StillPointShared, so `swift test` holds them. Like
// `FocusActivityViewModel`, every decision reads the wall clock, so a backgrounded
// app catches up on its next tick instead of drifting.

@Observable
@MainActor
final class FocusGameViewModel {
    enum Phase: Equatable {
        case setup
        case playing
        case ended
    }

    /// The square that was just tapped, coloured for a moment.
    struct Flash: Equatable {
        let cell: Int
        let isHit: Bool
        let atMs: Int
    }

    /// Milliseconds the tap feedback and the "missed it" notice stay up. Web's values.
    static let flashMs = 300
    static let resetNoticeMs = 1500

    private(set) var phase: Phase = .setup
    /// The duration the setup screen has chosen, in seconds.
    var durationSeconds = FocusGameLogic.defaultDurationSeconds
    private(set) var game: FocusGameLogic.State?
    /// The clock as of the last frame. Drives the countdown and the flash timing.
    private(set) var nowMs = 0
    private(set) var flash: Flash?
    private(set) var resetAtMs: Int?
    /// Squares on the grid: columns times the rows fitted to the viewport at start.
    private(set) var cellCount = 0

    private var timer: Timer?
    private var onEnd: ((FocusSessionResult?) -> Void)?

    var isPlaying: Bool { phase == .playing }

    /// Whole seconds left, rounded up as web shows them.
    var remainingSeconds: Int {
        guard let game else { return durationSeconds }
        return (FocusGameLogic.remainingMs(game, nowMs: nowMs) + 999) / 1000
    }

    /// True within the "missed it" window after a reset.
    var showsResetNotice: Bool {
        guard let resetAtMs else { return false }
        return nowMs - resetAtMs < Self.resetNoticeMs
    }

    /// The lit square's flash, while it is still up.
    func flashCell(_ cell: Int) -> Flash.Kind? {
        guard let flash, flash.cell == cell, nowMs - flash.atMs < Self.flashMs else { return nil }
        return flash.isHit ? .hit : .wrong
    }

    /// Starts a game on the chosen duration. `viewportHeight` is the space the
    /// view has; the row count is fixed for the whole game.
    func start(viewportHeight: Int, onEnd: @escaping (FocusSessionResult?) -> Void) {
        guard phase != .playing else { return }
        let now = Self.nowMs(Date())
        let rows = FocusGameLogic.rowsForViewport(viewportHeight)
        cellCount = FocusGameLogic.columns * rows
        self.onEnd = onEnd
        nowMs = now
        game = FocusGameLogic.create(goalSeconds: durationSeconds, nowMs: now, roll: Self.roll)
        flash = nil
        resetAtMs = nil
        phase = .playing
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    /// A tap on a grid square.
    func tap(_ cell: Int) {
        guard phase == .playing, let current = game else { return }
        let now = Self.nowMs(Date())
        let result = FocusGameLogic.tap(current, cell: cell, nowMs: now, roll: Self.roll, cells: cellCount)
        apply(result.state, outcome: result.outcome, nowMs: now, cell: cell)
        if FocusGameLogic.isFinished(result.state, nowMs: now) {
            finish(.expired)
        }
    }

    /// The End button.
    func endPressed() {
        finish(.ended)
    }

    /// Back from the setup screen: nothing was played, nothing is saved.
    func backFromSetup() {
        guard phase == .setup else { return }
        phase = .ended
        onEnd?(nil)
        onEnd = nil
    }

    /// Invalidates the timer. Idempotent; called when the game ends and from the view's `onDisappear`.
    func stop() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Private

    private func tick() {
        guard phase == .playing, let current = game else { return }
        let now = Self.nowMs(Date())
        let result = FocusGameLogic.advance(current, nowMs: now, roll: Self.roll, cells: cellCount)
        apply(result.state, outcome: result.outcome, nowMs: now, cell: nil)
        if game.map({ FocusGameLogic.isFinished($0, nowMs: now) }) == true {
            finish(.expired)
        }
    }

    private func apply(_ state: FocusGameLogic.State, outcome: FocusGameLogic.Outcome, nowMs now: Int, cell: Int?) {
        game = state
        nowMs = now
        if outcome == .reset {
            resetAtMs = now
        }
        if let cell, outcome == .hit || outcome == .wrong {
            flash = Flash(cell: cell, isHit: outcome == .hit, atMs: now)
        }
    }

    private func finish(_ reason: FocusEndReason) {
        guard phase == .playing, let current = game else { return }
        let now = Self.nowMs(Date())
        nowMs = now
        // Completion is decided from the clock at the moment of End, as on web.
        let saved = FocusGameLogic.result(current, nowMs: now, reason: reason)
        phase = .ended
        stop()
        let report = onEnd
        onEnd = nil
        report?(saved)
    }

    private static func nowMs(_ date: Date) -> Int {
        Int((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    /// The game's random source: uniform in [0, 1).
    private static func roll() -> Double {
        Double.random(in: 0..<1)
    }
}

extension FocusGameViewModel.Flash {
    enum Kind {
        case hit
        case wrong
    }
}
