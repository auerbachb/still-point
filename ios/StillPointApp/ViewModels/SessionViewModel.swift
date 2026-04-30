import SwiftUI
import Combine
import StillPointShared

@Observable
final class SessionViewModel {
    // Session config
    let dayNumber: Int
    let sessionType: SessionType
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
    /// Distraction segments started this sit (for in-session badge); API `thoughtCount` uses captured notes only.
    var distractionSegmentCount = 0
    var capturedThoughts: [CapturedThought] = []

    var thoughtCount: Int { capturedThoughts.count }

    // UI state — optional thought prompt after a distraction segment ends
    var showPostDistractionCapture = false
    var controlsVisible = true
    var soundPrefs: AudioEngine.SoundPrefs

    // Internal
    private var startDate: Date?
    private var pausedElapsed: Double = 0
    private var timer: AnyCancellable?
    private var lastTickSec = 0
    private var lastCompletedMinuteBlockIndex = -1
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

    init(dayNumber: Int, sessionType: SessionType = .standard) {
        self.dayNumber = dayNumber
        self.sessionType = sessionType
        self.plannedSeconds = Self.resolveTotalSeconds(for: dayNumber, sessionType: sessionType)
        self.soundPrefs = AudioEngine.loadPrefs()
        self.uiTestTimerMultiplier = Self.resolveUITestTimerMultiplier()
        // Initial mind state log entry
        self.mindStateLog = [MindStateEntry(time: 0, state: "clear")]
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
        } else {
            // Fresh session start: clear any carried timer/chime state.
            elapsed = 0
            pausedElapsed = 0
            lastTickSec = 0
            lastCompletedMinuteBlockIndex = -1
        }

        isActive = true
        isPaused = false
        startDate = Date().addingTimeInterval(-(pausedElapsed / uiTestTimerMultiplier))
        if soundPrefs.tick || soundPrefs.chime || soundPrefs.completion {
            AudioEngine.shared.warmUp()
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
    }

    func resume() {
        guard isPaused else { return }
        start()
    }

    func extendBonus(seconds: Int) {
        guard seconds > 0, !isComplete, !isAbandoned, !showPostDistractionCapture else { return }
        bonusSeconds += seconds
        userInteracted()
    }

    /// Hold to mark a distraction segment (`thinking`); release returns to aware (`clear`).
    func beginDistraction() {
        guard isActive, mindState == "clear", !showPostDistractionCapture else { return }
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
        guard isActive, mindState == "clear", !showPostDistractionCapture else { return }
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

    func userInteracted() {
        controlsVisible = true
        scheduleControlHide()
    }

    func toggleSound(_ keyPath: WritableKeyPath<AudioEngine.SoundPrefs, Bool>) {
        soundPrefs[keyPath: keyPath].toggle()
        AudioEngine.savePrefs(soundPrefs)
    }

    /// End session early but keep the data
    func endEarly() -> (clearPercent: Int, thoughtCount: Int, thoughts: [CapturedThought]) {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timer?.cancel()
        isActive = false
        isComplete = true
        return (clearPercent, thoughtCount, capturedThoughts)
    }

    /// Abandon session — discard all data, don't save
    func abandon() {
        finalizeActiveHoldIfNeeded(at: elapsed)
        timer?.cancel()
        isActive = false
        isAbandoned = true
        isComplete = true
    }

    /// Save session to the API. Returns the session on success.
    /// Thought batch failure is logged but does not fail the session save.
    func saveSession(completed: Bool) async -> SessionDTO? {
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
            sessionDate: dateFormatter.string(from: Date())
        )

        do {
            let session = try await APIClient.shared.createSession(request)

            // Batch save thoughts — failure here is non-fatal since the session is already persisted
            let allThoughts = capturedThoughts.map {
                BatchThoughtsRequest.ThoughtInput(
                    timeInSession: $0.timeInSession,
                    text: $0.text
                )
            }

            if !allThoughts.isEmpty {
                do {
                    _ = try await APIClient.shared.batchThoughts(
                        BatchThoughtsRequest(
                            sessionId: session.id,
                            dayNumber: session.dayNumber,
                            thoughts: allThoughts
                        )
                    )
                } catch {
                    print("Failed to save thoughts (session was saved): \(error)")
                }
            }

            return session
        } catch {
            print("Failed to save session: \(error)")
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
            if soundPrefs.completion {
                AudioEngine.shared.playCompletion()
            }
            return
        }

        elapsed = newElapsed
        pausedElapsed = newElapsed

        let currentSec = Int(newElapsed)

        // Tick sound — once per second
        if soundPrefs.tick && currentSec > lastTickSec {
            lastTickSec = currentSec
            AudioEngine.shared.playTick()
        }

        // Advance minute-block boundary progress independent of mute state.
        let chimeUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: newElapsed,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: lastCompletedMinuteBlockIndex
        )
        if chimeUpdate.updatedCompletedBlockIndex > lastCompletedMinuteBlockIndex {
            lastCompletedMinuteBlockIndex = chimeUpdate.updatedCompletedBlockIndex
            if soundPrefs.chime, let chimeCount = chimeUpdate.chimeCount {
                AudioEngine.shared.playChime(count: chimeCount)
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

    private static func resolveTotalSeconds(for dayNumber: Int, sessionType: SessionType) -> Int {
        let env = ProcessInfo.processInfo.environment
        guard let override = env["SP_UI_TEST_SESSION_SECONDS"],
              let overrideSeconds = Int(override),
              overrideSeconds > 0 else {
            return StillPoint.duration(for: sessionType, day: dayNumber)
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
