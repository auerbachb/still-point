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
    /// #724: the "Session could not be saved" alert, raised by
    /// `completeSit(appVM:startedAtGeneration:)`.
    var showSaveError = false
    var controlsVisible = true
    var soundPrefs: AudioEngine.SoundPrefs

    // Internal
    /// #739: the sit's clock, its per-tick cues, and the haptic generators.
    private let timerEngine: SessionTimerEngine
    private var controlHideTimer: AnyCancellable?

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
        self.timerEngine = SessionTimerEngine(timerMultiplier: Self.resolveUITestTimerMultiplier())
        // Initial mind state log entry
        self.mindStateLog = [MindStateEntry(time: 0, state: "clear")]
        timerEngine.tickInputs = { [weak self] in
            guard let self, self.isActive else { return nil }
            return SessionTimerEngine.TickInputs(
                totalSeconds: self.totalSeconds,
                soundPrefs: self.soundPrefs,
                isAbandoned: self.isAbandoned
            )
        }
        timerEngine.onTick = { [weak self] outcome in
            self?.handleTick(outcome)
        }
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
        // #848: a sit that has ended never restarts its clock or its cues.
        // Returning before `isPaused` changes also keeps the session screen
        // from resuming the trackers its completion handler stopped.
        guard SessionTickLogic.canStart(isComplete: isComplete, isAbandoned: isAbandoned) else { return }
        let isResume = SessionTickLogic.isResume(
            pausedElapsed: timerEngine.pausedElapsed,
            totalSeconds: totalSeconds,
            isPaused: isPaused,
            isActive: isActive
        )
        if !isResume {
            // Fresh session start: the engine clears its carried timer/chime state.
            elapsed = 0
        }

        isActive = true
        isPaused = false
        timerEngine.start(resuming: isResume, totalSeconds: totalSeconds, soundPrefs: soundPrefs)
        scheduleControlHide()
    }

    func pause() {
        finalizeActiveHoldIfNeeded(at: elapsed)
        isPaused = true
        isActive = false
        timerEngine.pause(at: elapsed)
        controlsVisible = true
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

    func setCueMode(_ mode: CueMode) {
        let previous = soundPrefs
        let next = CueModeLogic.applying(mode, to: previous)
        guard next != previous else { return }
        soundPrefs = next
        AudioEngine.savePrefs(soundPrefs)

        if next.haptics && !previous.haptics {
            timerEngine.prepareHaptics()
        }

        timerEngine.apply(CueModeLogic.transitionEffects(from: previous, to: next))
    }

    func toggleSound(_ keyPath: WritableKeyPath<AudioEngine.SoundPrefs, Bool>) {
        if let mode = CueModeLogic.mode(
            forTick: keyPath == \AudioEngine.SoundPrefs.tick,
            haptics: keyPath == \AudioEngine.SoundPrefs.haptics,
            voice: keyPath == \AudioEngine.SoundPrefs.voiceCountdown
        ) {
            // Selecting a cue turns that one on. The active cue cannot be
            // toggled off; another segment has to take its place.
            if !soundPrefs[keyPath: keyPath] {
                setCueMode(mode)
            }
            return
        }
        let toggledKeyWasEnabled = soundPrefs[keyPath: keyPath]
        let voiceCountdownWasEnabled = soundPrefs.voiceCountdown
        // #712: the one toggle that governs vibration rather than sound.
        let isHapticsToggle = keyPath == \AudioEngine.SoundPrefs.haptics
        soundPrefs[keyPath: keyPath].toggle()
        AudioEngine.savePrefs(soundPrefs)

        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: toggledKeyWasEnabled,
            toggledKeyIsEnabled: soundPrefs[keyPath: keyPath],
            voiceCountdownWasEnabled: voiceCountdownWasEnabled,
            voiceCountdownIsEnabled: soundPrefs.voiceCountdown,
            toggledKeyUsesAudio: !isHapticsToggle
        )

        if isHapticsToggle, soundPrefs.haptics {
            // Turned on mid-sit: prime the generators so the next minute marker
            // lands on time rather than a beat late.
            timerEngine.prepareHaptics()
        }

        timerEngine.apply(effects)
    }

    /// End session early but keep the data
    func endEarly() -> (clearPercent: Int, thoughtCount: Int, thoughts: [CapturedThought]) {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timerEngine.stop()
        isActive = false
        isComplete = true
        return (clearPercent, thoughtCount, capturedThoughts)
    }

    /// Abandon session — discard all data, don't save
    func abandon() {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timerEngine.stop()
        isActive = false
        isAbandoned = true
        isComplete = true
    }

    /// #557: stable local key for offline end-note sync during completion.
    private(set) var lastClientSessionId: UUID?
    /// Credited practice day, pinned on the first save so a retry after 6:00
    /// still stores the sit on the day it ended.
    private var pinnedSessionDate: String?

    /// Save session locally first, then sync when online (#557). Returns nil when persistence fails.
    func saveSession(completed: Bool, ownerUserId: String, sessionDate: String? = nil) async -> SessionDTO? {
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
        if pinnedSessionDate == nil {
            pinnedSessionDate = sessionDate ?? dateFormatter.string(from: Date())
        }
        let creditedDate = pinnedSessionDate ?? dateFormatter.string(from: Date())

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
            sessionDate: creditedDate,
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

    // MARK: - Completion (#724)

    /// Saves the finished sit, then hands it to `appVM` for the completion
    /// screen, or raises `showSaveError` when it could not be saved.
    ///
    /// `SessionView` calls this once the sit completes, after its trackers have
    /// written `attentionLog` and `ambientSoundSummary`, and again from the
    /// alert's Retry. An abandoned sit is never saved here. A retry reuses the
    /// first attempt's client id and credited day (see `saveSession`), so it
    /// stores the same sit rather than a second one.
    ///
    /// A save that settles after a sign-out shows nothing, whatever its outcome:
    /// by then the screen belongs to another session, even when the same account
    /// has signed back in (#854). The save itself is not undone.
    ///
    /// - Parameter generation: `appVM.authGeneration`, read where the sit ended or
    ///   Retry was tapped. This runs from a task that starts a main-actor turn
    ///   later, so a read taken here would belong to whoever is signed in by then.
    @MainActor
    func completeSit(appVM: AppViewModel, startedAtGeneration generation: Int) async {
        // #854: an identity transition that landed before this task started has made
        // the screen another account's, and `ownerUserId` below would be that
        // account's. Nothing is saved or shown for it.
        guard generation == appVM.authGeneration else { return }
        guard let ownerUserId = appVM.currentUser?.id else {
            applySaveOutcome(.noSignedInUser, appVM: appVM)
            return
        }
        // #854: the save waits on the server flush, so a sign-out and a sign-in as
        // someone else can land before it settles. Everything after it is for the
        // account that sat: the #703 flag, the alert, and `completeSession`, which
        // credits the sit and opens its completion screen. A save that settles
        // under another generation does none of it. Web: `handleSessionComplete`
        // (#666).
        await GenerationScopedWork.run(
            startedAt: generation,
            liveGeneration: { appVM.authGeneration }
        ) {
            // Persist session before navigating to completion screen
            await saveSession(
                completed: completedNaturally,
                ownerUserId: ownerUserId,
                sessionDate: appVM.creditedSessionDate()
            )
        } apply: { session in
            guard let session else {
                // #703: the alert already blocks the false-success completion; the
                // flag additionally withdraws the offline strip's "sits are saved"
                // promise, which stays on screen after the user picks "Continue
                // without saving".
                applySaveOutcome(.notStored, appVM: appVM)
                return
            }
            applySaveOutcome(.stored, appVM: appVM)
            appVM.completeSession(
                sessionId: session.id,
                clientSessionId: lastClientSessionId ?? UUID(uuidString: session.id) ?? UUID(),
                clearPercent: clearPercent,
                thoughtCount: thoughtCount,
                thoughts: capturedThoughts,
                dayNumber: session.dayNumber,
                sessionType: session.sessionType,
                track: track,
                duration: plannedSeconds,
                bonusSeconds: bonusSeconds,
                unlockAppGate: completedNaturally,
                attentionLog: attentionLog,
                attentionElapsed: attentionLog != nil ? elapsed : nil,
                ambientSoundSummary: ambientSoundSummary
            )
        }
    }

    /// The alert's "Continue without saving": the completion screen, with no
    /// stored session behind it.
    ///
    /// The payload has no session id, so that screen saves nothing: its note is
    /// never sent, no photo can be added, and ratings and mood stay hidden. The
    /// attention log goes along as it does from `completeSit`, so the screen
    /// shows the same gaze summary a saved sit's does (#873).
    @MainActor
    func continueWithoutSaving(appVM: AppViewModel) {
        appVM.completeSession(
            sessionId: "",
            clientSessionId: UUID(),
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            thoughts: capturedThoughts,
            dayNumber: dayNumber,
            sessionType: sessionType,
            track: track,
            duration: plannedSeconds,
            bonusSeconds: bonusSeconds,
            unlockAppGate: completedNaturally,
            attentionLog: attentionLog,
            attentionElapsed: attentionLog != nil ? elapsed : nil,
            ambientSoundSummary: ambientSoundSummary
        )
    }

    /// Carries out what a save outcome decides: the #703 flag first, then the alert.
    @MainActor
    private func applySaveOutcome(_ outcome: SessionCompletionLogic.SaveOutcome, appVM: AppViewModel) {
        if let localSaveFailed = SessionCompletionLogic.localSaveFailed(after: outcome) {
            appVM.localSaveFailed = localSaveFailed
        }
        if SessionCompletionLogic.showsSaveError(after: outcome) {
            showSaveError = true
        }
    }

    // MARK: - Private

    /// Mirrors one tick of the engine's clock into the state the session screen reads.
    private func handleTick(_ outcome: SessionTickLogic.Outcome) {
        elapsed = outcome.elapsed
        guard outcome.completedNaturally else { return }
        finalizeActiveHoldIfNeeded(at: outcome.elapsed)
        isActive = false
        completedNaturally = true
        isComplete = true
    }

    func setHapticInterval(_ interval: HapticCueLogic.Interval) {
        guard soundPrefs.hapticInterval != interval else { return }
        soundPrefs.hapticInterval = interval
        AudioEngine.savePrefs(soundPrefs)
        timerEngine.reseedHapticInterval(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            intervalSeconds: interval.seconds
        )
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
