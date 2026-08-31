import SwiftUI
import Combine
import StillPointShared

@Observable
final class SessionViewModel {
    // Session config
    let dayNumber: Int
    let sessionType: SessionType
    /// #240: which daily track this sit advances.
    let track: Track
    let plannedSeconds: Int
    var bonusSeconds: Int = 0

    var totalSeconds: Int {
        plannedSeconds + bonusSeconds
    }

    // Timer state
    var elapsed: Double = 0
    var isActive = false
    var isPaused = false
    var isComplete = false
    /// Whether the session completed naturally (timer ran out) vs ended early
    var completedNaturally = false
    /// Whether the user explicitly abandoned (discard data, don't save)
    var isAbandoned = false

    // Mind state
    var mindState: String = "clear"
    var mindStateLog: [MindStateEntry] = []
    /// #113: ARKit gaze attention log when opt-in tracking is enabled.
    var attentionLog: [AttentionEntry]?
    /// #563: ambient sound level summary; nil when capture was off or mic was denied.
    var ambientSoundSummary: AmbientSoundSummary?
    /// Distraction segments started this sit (for in-session badge); API `thoughtCount` uses captured notes only.
    var distractionSegmentCount = 0
    var capturedThoughts: [CapturedThought] = []

    var thoughtCount: Int { capturedThoughts.count }

    // UI state — optional thought prompt after a distraction segment ends
    var showPostDistractionCapture = false
    /// Opt-in guided exercise overlay while the sit timer keeps running (#519).
    var showGuidedExercise = false
    /// Pre-session intro overlay; gates `start()` until dismissed (#560).
    var showIntroOverlay = false
    var controlsVisible = true
    var soundPrefs: AudioEngine.SoundPrefs

    // Internal
    private var startDate: Date?
    private var pausedElapsed: Double = 0
    private var timer: AnyCancellable?
    private var lastTickSec = 0
    private var lastCompletedMinuteBlockIndex = -1
    /// #554: last second announced via voice countdown; 0 means none yet this window.
    private var lastVoiceCountdownSec = 0
    private var controlHideTimer: AnyCancellable?
    private let uiTestTimerMultiplier: Double

    var remaining: Double {
        max(0, Double(totalSeconds) - elapsed)
    }

    private var displaySeconds: Int {
        remaining == 0 ? 0 : Int(ceil(remaining))
    }

    var minutes: Int {
        displaySeconds / 60
    }

    var seconds: Int {
        displaySeconds % 60
    }

    var clearPercent: Int {
        SessionLogic.calculateClearPercent(
            mindStateLog: mindStateLog,
            totalElapsed: elapsed
        )
    }

    var blocks: [BlockDef] {
        SessionLogic.buildBlocks(totalSeconds: totalSeconds)
    }

    var statusLabel: String {
        SessionLogic.statusLabel(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            blocks: blocks
        )
    }

    var timeString: String {
        "\(minutes):\(String(format: "%02d", seconds))"
    }

    init(dayNumber: Int, sessionType: SessionType = .standard, track: Track = .primary, recovery: DurationRecovery.RecoveryFields = .none) {
        self.dayNumber = dayNumber
        self.sessionType = sessionType
        self.track = track
        self.plannedSeconds = Self.resolveTotalSeconds(
            for: dayNumber,
            sessionType: sessionType,
            track: track,
            recovery: recovery
        )
        self.soundPrefs = AudioEngine.loadPrefs()
        self.uiTestTimerMultiplier = Self.resolveUITestTimerMultiplier()
        // Initial mind state log entry
        self.mindStateLog = [MindStateEntry(time: 0, state: "clear")]
    }

    /// Prepare the session screen. Shows the intro overlay unless permanently hidden or UI-test skip.
    func prepareSession(introHiddenPermanently: Bool, skipIntroForUITest: Bool) {
        if skipIntroForUITest || introHiddenPermanently {
            showIntroOverlay = false
            start()
        } else {
            showIntroOverlay = true
        }
    }

    /// Dismiss the intro overlay and begin the countdown.
    func dismissIntroOverlay(dontShowAgain: Bool) {
        if dontShowAgain {
            SessionIntroPrefs.setIntroOverlayHidden(true)
        }
        showIntroOverlay = false
        start()
    }

    func start() {
        let resumeElapsed = pausedElapsed
        let isResume =
            resumeElapsed < Double(totalSeconds)
            && (resumeElapsed > 0 || isPaused || isActive)

        if isResume {
            lastTickSec = Int(floor(resumeElapsed))
            lastCompletedMinuteBlockIndex = SessionLogic.completedMinuteBlockIndex(
                elapsed: resumeElapsed,
                totalSeconds: totalSeconds
            )
            // Reset voice countdown state so resume re-announces the current second.
            lastVoiceCountdownSec = 0
        } else {
            // Fresh session start: clear any carried timer/chime state.
            elapsed = 0
            pausedElapsed = 0
            lastTickSec = 0
            lastCompletedMinuteBlockIndex = -1
            lastVoiceCountdownSec = 0
        }

        isActive = true
        isPaused = false
        startDate = Date().addingTimeInterval(-(pausedElapsed / uiTestTimerMultiplier))
        if soundPrefs.tick || soundPrefs.chime || soundPrefs.completion || soundPrefs.voiceCountdown {
            AudioEngine.shared.warmUp()
        }
        if soundPrefs.voiceCountdown {
            AudioEngine.shared.preloadVoiceCountdown()
        }
        startTimer()
        scheduleControlHide()
    }

    func pause() {
        finalizeActiveHoldIfNeeded(at: elapsed)
        isPaused = true
        isActive = false
        pausedElapsed = elapsed
        timer?.cancel()
        controlsVisible = true
        AudioEngine.shared.cancelVoiceCountdownPlayback()
    }

    func resume() {
        guard isPaused else { return }
        start()
    }

    func extendBonus(seconds: Int) {
        guard seconds > 0, isActive, !isComplete, !isAbandoned, !showPostDistractionCapture, !showGuidedExercise else { return }
        bonusSeconds += seconds
        userInteracted()
    }

    /// Hold to mark a distraction segment (`thinking`); release returns to aware (`clear`).
    func beginDistraction() {
        guard isActive, mindState == "clear", !showPostDistractionCapture, !showGuidedExercise else { return }
        mindState = "thinking"
        distractionSegmentCount += 1
        mindStateLog.append(MindStateEntry(time: elapsed, state: "thinking"))
        userInteracted()
    }

    func endDistraction() {
        guard mindState == "thinking" else { return }
        finalizeActiveHoldIfNeeded(at: elapsed)
        userInteracted()
    }

    /// Hold to mark hyperfocus; counts toward awareness in `clearPercent`. Release returns to `clear`.
    func beginHyperfocus() {
        guard isActive, mindState == "clear", !showPostDistractionCapture, !showGuidedExercise else { return }
        mindState = "hyperfocus"
        mindStateLog.append(MindStateEntry(time: elapsed, state: "hyperfocus"))
        userInteracted()
    }

    func endHyperfocus() {
        guard mindState == "hyperfocus" else { return }
        finalizeActiveHoldIfNeeded(at: elapsed)
        userInteracted()
    }

    func openThoughtCapture() {
        guard (isActive || isPaused), !isComplete, !isAbandoned else { return }
        finalizeActiveHoldIfNeeded(at: elapsed)
        showPostDistractionCapture = true
        userInteracted()
    }

    func captureThought(_ text: String) {
        guard !text.isEmpty else { return }
        capturedThoughts.append(CapturedThought(
            timeInSession: Int(elapsed),
            text: text
        ))
        showPostDistractionCapture = false
    }

    func dismissPostDistractionCapture() {
        showPostDistractionCapture = false
    }

    func openGuidedExercise() {
        guard (isActive || isPaused), !isComplete, !isAbandoned else { return }
        finalizeActiveHoldIfNeeded(at: elapsed)
        showGuidedExercise = true
        userInteracted()
    }

    func closeGuidedExercise() {
        showGuidedExercise = false
    }

    func userInteracted() {
        controlsVisible = true
        scheduleControlHide()
    }

    func toggleSound(_ keyPath: WritableKeyPath<AudioEngine.SoundPrefs, Bool>) {
        let toggledKeyWasEnabled = soundPrefs[keyPath: keyPath]
        let voiceCountdownWasEnabled = soundPrefs.voiceCountdown
        soundPrefs[keyPath: keyPath].toggle()
        AudioEngine.savePrefs(soundPrefs)

        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: toggledKeyWasEnabled,
            toggledKeyIsEnabled: soundPrefs[keyPath: keyPath],
            voiceCountdownWasEnabled: voiceCountdownWasEnabled,
            voiceCountdownIsEnabled: soundPrefs.voiceCountdown
        )

        if effects.warmUp {
            // #667: `start()` only warms the engine when a sound is already on, so a
            // sit begun with everything off leaves the audio session inactive.
            // Reactivate it here so the re-enabled sound is audible at its next
            // scheduled play point — no restart required.
            AudioEngine.shared.warmUp()
        }
        if effects.preloadVoiceCountdown {
            // Voice countdown was just enabled — prime the buffer cache.
            AudioEngine.shared.preloadVoiceCountdown()
        }
        if effects.resetVoiceDedup {
            // Voice countdown was just disabled — reset dedup state so re-enabling
            // during the same remaining second announces correctly (#554).
            lastVoiceCountdownSec = 0
        }
        if effects.cancelVoiceCountdown {
            AudioEngine.shared.cancelVoiceCountdownPlayback()
        }
    }

    /// End session early but keep the data
    func endEarly() -> (clearPercent: Int, thoughtCount: Int, thoughts: [CapturedThought]) {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timer?.cancel()
        isActive = false
        isComplete = true
        AudioEngine.shared.cancelVoiceCountdownPlayback()
        return (clearPercent, thoughtCount, capturedThoughts)
    }

    /// Abandon session — discard all data, don't save
    func abandon() {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timer?.cancel()
        isActive = false
        isAbandoned = true
        isComplete = true
        AudioEngine.shared.cancelVoiceCountdownPlayback()
    }

    /// #557: stable local key for offline end-note sync during completion.
    private(set) var lastClientSessionId: UUID?

    /// Save session locally first, then sync when online (#557). Returns nil when persistence fails.
    func saveSession(completed: Bool, ownerUserId: String) async -> SessionDTO? {
        let clientSessionId: UUID
        if let existing = lastClientSessionId {
            clientSessionId = existing
        } else {
            let newId = UUID()
            lastClientSessionId = newId
            clientSessionId = newId
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.calendar = Calendar(identifier: .gregorian)

        let request = CreateSessionRequest(
            dayNumber: dayNumber,
            sessionType: sessionType,
            duration: plannedSeconds,
            bonusSeconds: bonusSeconds,
            completed: completed,
            actualTime: Int(elapsed),
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            mindStateLog: mindStateLog,
            attentionLog: attentionLog,
            sessionDate: dateFormatter.string(from: Date()),
            track: track,
            clientSessionId: clientSessionId,
            ambientSoundSummary: ambientSoundSummary
        )

        let pendingThoughts = capturedThoughts.map {
            PendingSessionThought(timeInSession: $0.timeInSession, text: $0.text)
        }

        do {
            let result = try await SessionSyncCoordinator.shared.saveCompletedSession(
                request: request,
                clientSessionId: clientSessionId,
                ownerUserId: ownerUserId,
                thoughts: pendingThoughts
            )
            return result.session
        } catch {
            print("Failed to persist session locally: \(error)")
            return nil
        }
    }

    // MARK: - Private

    private func startTimer() {
        timer = Timer.publish(every: 0.05, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.tick()
            }
    }

    private func tick() {
        guard let startDate, isActive else { return }

        let newElapsed = Date().timeIntervalSince(startDate) * uiTestTimerMultiplier

        if newElapsed >= Double(totalSeconds) {
            elapsed = Double(totalSeconds)
            pausedElapsed = elapsed
            finalizeActiveHoldIfNeeded(at: Double(totalSeconds))
            timer?.cancel()
            isActive = false
            completedNaturally = true
            isComplete = true
            // Cancel any in-flight voice countdown clip before the completion cue.
            AudioEngine.shared.cancelVoiceCountdownPlayback()
            // Completion sound plays unconditionally even in voice countdown mode.
            if soundPrefs.completion {
                AudioEngine.shared.playCompletion()
            }
            return
        }

        elapsed = newElapsed
        pausedElapsed = newElapsed

        let currentSec = Int(newElapsed)
        let currentRemaining = max(0.0, Double(totalSeconds) - newElapsed)
        let voiceActive = soundPrefs.voiceCountdown && VoiceCountdownLogic.isActive(remaining: currentRemaining)

        // Voice countdown — fires once per second in the final minute.
        // Mirrors BlockTimer.tsx: suppresses tick and per-minute chime while active.
        if soundPrefs.voiceCountdown {
            if VoiceCountdownLogic.shouldReset(remaining: currentRemaining) {
                // Remaining went back above 60 s (e.g., bonus seconds added mid-final-minute).
                if lastVoiceCountdownSec != 0 {
                    lastVoiceCountdownSec = 0
                    AudioEngine.shared.cancelVoiceCountdownPlayback()
                }
            } else if let sec = VoiceCountdownLogic.announceSecond(
                remaining: currentRemaining,
                lastAnnouncedSec: lastVoiceCountdownSec
            ) {
                lastVoiceCountdownSec = sec
                AudioEngine.shared.playVoiceCountdown(seconds: sec)
            }
        }

        // Tick sound — once per second; suppressed during voice countdown final minute.
        if soundPrefs.tick && currentSec > lastTickSec {
            lastTickSec = currentSec
            if !voiceActive {
                AudioEngine.shared.playTick()
            }
        }

        // Advance minute-block boundary progress independent of mute state.
        let chimeUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: newElapsed,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: lastCompletedMinuteBlockIndex
        )
        if chimeUpdate.updatedCompletedBlockIndex > lastCompletedMinuteBlockIndex {
            lastCompletedMinuteBlockIndex = chimeUpdate.updatedCompletedBlockIndex
            // Per-minute chime suppressed during voice countdown final minute.
            // `chimeCount` is non-nil only when a full minute is still to go;
            // since #711 the bell is one strike, so the value survives purely
            // as that gate and no longer sets how many strikes play.
            if soundPrefs.chime, chimeUpdate.chimeCount != nil, !voiceActive {
                AudioEngine.shared.playChime()
            }
        }
    }

    private func finalizeActiveHoldIfNeeded(at time: Double) {
        guard mindState == "thinking" || mindState == "hyperfocus" else { return }
        mindState = "clear"
        mindStateLog.append(MindStateEntry(time: time, state: "clear"))
    }

    private func scheduleControlHide() {
        controlHideTimer?.cancel()
        if ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1" {
            controlsVisible = true
            return
        }
        controlHideTimer = Timer.publish(every: 3.0, on: .main, in: .common)
            .autoconnect()
            .first()
            .sink { [weak self] _ in
                guard let self, self.isActive else { return }
                withAnimation(.easeOut(duration: 0.3)) {
                    self.controlsVisible = false
                }
            }
    }

    private static func resolveTotalSeconds(
        for dayNumber: Int,
        sessionType: SessionType,
        track: Track,
        recovery: DurationRecovery.RecoveryFields
    ) -> Int {
        let env = ProcessInfo.processInfo.environment
        guard let override = env["SP_UI_TEST_SESSION_SECONDS"],
              let overrideSeconds = Int(override),
              overrideSeconds > 0 else {
            if track == .second {
                return StillPoint.duration(for: sessionType, day: dayNumber)
            }
            return DurationRecovery.sessionDurationForUser(
                sessionType: sessionType,
                currentDay: dayNumber,
                recovery: recovery
            )
        }
        return overrideSeconds
    }

    private static func resolveUITestTimerMultiplier() -> Double {
        let env = ProcessInfo.processInfo.environment
        guard let multiplier = env["SP_UI_TEST_TIMER_MULTIPLIER"],
              let parsed = Double(multiplier),
              parsed.isFinite,
              parsed > 0 else {
            return 1.0
        }
        return parsed
    }

}
