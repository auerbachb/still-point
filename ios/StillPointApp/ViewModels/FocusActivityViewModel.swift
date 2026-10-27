import Foundation
import StillPointShared

// Mirrors the wall-clock pattern of `BreathCountingViewModel`: the start is stamped
// once, and each tick recomputes the time left from `Date()`, so backgrounding the
// app doesn't corrupt the countdown. The rules are `FocusSessionRun`'s and
// `FocusActivity`'s, in StillPointShared so its tests can drive them (#840).

@Observable
@MainActor
final class FocusActivityViewModel {
    // MARK: - Published state

    /// The goal, pinned when the session opens.
    let goalSeconds: Int
    private(set) var remainingSeconds: Int
    /// True from `start` until the session ends. Drives the idle timer and the
    /// notification suppression, as in `BreathCountingViewModel`.
    private(set) var sessionInProgress = false

    var countdownDisplay: String {
        FocusActivity.countdownDisplay(remainingSeconds)
    }

    var countdownShowsHours: Bool {
        FocusActivity.countdownShowsHours(goalSeconds: goalSeconds)
    }

    var reachedGoal: Bool {
        remainingSeconds == 0
    }

    /// Once true, End does nothing: the session has already reported its end.
    var hasEnded: Bool {
        run?.hasEnded ?? false
    }

    // MARK: - Private

    private var run: FocusSessionRun?
    private var timer: Timer?
    private var onEnd: (@MainActor (FocusSessionEnd) -> Void)?
    /// Read when the session starts, as web does. Set in `start` rather than here:
    /// SwiftUI builds a view model each time the view is re-created and keeps only
    /// the first, so `init` stays free of side effects.
    private var soundPrefs = AudioEngine.SoundPrefs.defaults
    private var hapticPlayer: HapticCuePlayer?

    init(goalSeconds: Int) {
        self.goalSeconds = goalSeconds
        self.remainingSeconds = goalSeconds
    }

    // MARK: - Actions

    /// Starts the countdown. The picker card that opened the timer was the start
    /// gesture, as on web, so this runs on appear. Idempotent.
    ///
    /// - Parameter onEnd: called once, in the same turn as the End tap or the tick
    ///   that reached the goal.
    func start(onEnd: @escaping @MainActor (FocusSessionEnd) -> Void) {
        guard run == nil else { return }
        self.onEnd = onEnd
        run = FocusSessionRun(goalSeconds: goalSeconds, startedAt: Date())
        sessionInProgress = true
        soundPrefs = AudioEngine.loadPrefs()
        // Only the end cue can play, so only its channels are readied: the audio
        // session when the completion sound is on, the haptic engine when haptics
        // are. Neither is touched otherwise, so a silent setup opens no audio
        // session. The haptic engine may shut itself down while it idles: the one
        // cue can be two hours away, and `fire` restarts it.
        if soundPrefs.completion {
            AudioEngine.shared.warmUp()
        }
        if soundPrefs.haptics {
            let player = HapticCuePlayer(isAutoShutdownEnabled: true)
            player.prepare()
            hapticPlayer = player
        }
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    /// The End button.
    func end() {
        finish(.ended)
    }

    /// Invalidate the timer. Idempotent; called when the session ends and from the
    /// view's `onDisappear`, as in `BreathCountingViewModel`.
    func stop() {
        sessionInProgress = false
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Private

    private func tick() {
        guard let run, !run.hasEnded else { return }
        let left = run.remainingSeconds(now: Date())
        // Four ticks a second, but the digits change once a second: only a change
        // is published, so the view is not redrawn for nothing.
        if left != remainingSeconds {
            remainingSeconds = left
        }
        if left == 0 {
            finish(.expired)
        }
    }

    private func finish(_ reason: FocusEndReason) {
        // Nil once the session has ended: expiry and an End in the same turn, or a
        // second End tap, report nothing more.
        guard let end = run?.end(reason: reason, now: Date()) else { return }
        stop()
        let cues = FocusActivity.endCues(reason: reason, prefs: soundPrefs)
        if cues.playCompletion {
            AudioEngine.shared.playCompletion()
        }
        if let haptic = cues.haptic {
            // Set up in `start` from the same preferences that asked for this cue.
            hapticPlayer?.fire(haptic)
        }
        let report = onEnd
        onEnd = nil
        report?(end)
    }
}
