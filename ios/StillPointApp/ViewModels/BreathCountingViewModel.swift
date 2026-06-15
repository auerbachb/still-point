import Foundation
import SwiftUI
import UIKit
import StillPointShared

// Mirrors the wall-clock pattern from SessionViewModel (see SessionViewModel.swift ~lines 42, 121, 289):
// `startDate` is set once on first tap; elapsed is recomputed from Date() each tick so
// backgrounding doesn't corrupt the counter.

@Observable
@MainActor
final class BreathCountingViewModel {
    // MARK: - Published state

    private(set) var tapCount: Int = 0
    private(set) var startedAt: Date?
    private(set) var elapsedSeconds: Int = 0

    // MARK: - Computed from BreathCounting helpers

    var breathCount: Int {
        BreathCounting.breathCount(forTaps: tapCount)
    }

    var phase: BreathPhase {
        BreathCounting.phase(forTaps: tapCount)
    }

    var elapsedDisplay: String {
        BreathCounting.elapsedDisplay(elapsedSeconds)
    }

    // MARK: - Private

    private var timer: Timer?

    // MARK: - Actions

    /// Record a tap (inhale or exhale). Starts the wall-clock timer on the first tap.
    func recordTap() {
        tapCount += 1

        if startedAt == nil {
            startedAt = Date()
            startTimer()
        }

        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// End the session. Stops the timer and returns final values for the caller to persist.
    func end() -> (elapsed: Int, breaths: Int) {
        // Recompute elapsed from the wall clock so ending between 1-second ticks
        // (or right after the first tap) doesn't under-report the persisted duration.
        let finalElapsed = startedAt.map { BreathCounting.elapsedSeconds(since: $0) } ?? elapsedSeconds
        stop()
        return (elapsed: finalElapsed, breaths: breathCount)
    }

    /// Invalidate the timer. Idempotent; called on End and from the view's
    /// `onDisappear`. (A `deinit` can't touch this `@MainActor`-isolated state
    /// under strict concurrency, and the timer's `[weak self]` closure means it
    /// never retains the view model, so lifecycle-driven cleanup is sufficient.)
    func stop() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Private

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let start = self.startedAt else { return }
                self.elapsedSeconds = BreathCounting.elapsedSeconds(since: start)
            }
        }
    }
}
