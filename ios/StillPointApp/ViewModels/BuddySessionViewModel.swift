import Foundation
import SwiftUI
import UIKit
import StillPointShared

@Observable
@MainActor
final class BuddySessionViewModel {
    let sessionId: String
    let currentUserId: String

    var snapshot: BuddySnapshotDTO?
    var isLoading = true
    var pollError: String?
    var actionError: String?

    var mindState: String = "clear"
    var mindStateLog: [MindStateEntry] = []
    var capturedThoughts: [CapturedThought] = []
    var pendingThought = ""
    var distractionSegmentCount = 0

    var meetingToken: String?
    var meetingTokenError: String?

    var isSavingCompletion = false
    var completionSaveError: String?

    /// #554: shared sound preferences, loaded from the same UserDefaults key as solo sessions.
    var soundPrefs: AudioEngine.SoundPrefs = AudioEngine.loadPrefs()
    /// Last second announced via voice countdown in the current active session window.
    private var lastVoiceCountdownSec: Int = 0
    /// #736: highest minute block already marked, so a boundary fires once.
    private var lastCompletedMinuteBlockIndex = -1
    /// #736: natural completion has already been announced for this window.
    private var sessionEndHapticEmitted = false
    /// #736: held for the sit. A generator built at the moment of the cue fires
    /// late enough to miss the minute it belongs to.
    private let gentleHaptic = UIImpactFeedbackGenerator(style: .light)
    private let pronouncedHaptic = UINotificationFeedbackGenerator()

    private var pollTask: Task<Void, Never>?
    private var activeAnchor: ActiveAnchor?
    private var lastActiveKey: String?
    private var latestMeetingTokenRequestKey: String?
    private var refreshRequestCounter = 0
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private let isoFormatterFallback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(sessionId: String, currentUserId: String) {
        self.sessionId = sessionId
        self.currentUserId = currentUserId
    }

    @MainActor
    deinit {
        pollTask?.cancel()
    }

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            await self?.refreshSnapshot()
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 1_500_000_000)
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                guard let self else { return }
                await self.refreshSnapshot()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        AudioEngine.shared.cancelVoiceCountdownPlayback()
        lastVoiceCountdownSec = 0
    }

    func refreshSnapshot() async {
        refreshRequestCounter += 1
        let requestID = refreshRequestCounter
        do {
            let snapshot = try await APIClient.shared.getBuddySnapshot(sessionId: sessionId)
            guard requestID == refreshRequestCounter else { return }
            self.snapshot = snapshot
            pollError = nil
            isLoading = false
            handleSnapshotUpdate(snapshot)
        } catch let error as APIError {
            guard requestID == refreshRequestCounter else { return }
            pollError = error.message
            isLoading = false
        } catch {
            guard requestID == refreshRequestCounter else { return }
            pollError = "Could not refresh session."
            isLoading = false
        }
    }

    @discardableResult
    func setReady(_ ready: Bool) async -> Bool {
        do {
            try await APIClient.shared.setBuddyReady(sessionId: sessionId, ready: ready)
            actionError = nil
            await refreshSnapshot()
            return true
        } catch let error as APIError {
            actionError = error.message
            return false
        } catch {
            actionError = "Could not update ready state."
            return false
        }
    }

    func startSession() async {
        do {
            try await APIClient.shared.startBuddySession(sessionId: sessionId)
            actionError = nil
            await refreshSnapshot()
        } catch let error as APIError {
            actionError = error.message
        } catch {
            actionError = "Could not start shared session."
        }
    }

    @discardableResult
    func cancelSession() async -> Bool {
        do {
            try await APIClient.shared.cancelBuddySession(sessionId: sessionId)
            actionError = nil
            await refreshSnapshot()
            return true
        } catch let error as APIError {
            actionError = error.message
            return false
        } catch {
            actionError = "Could not cancel session."
            return false
        }
    }

    @discardableResult
    func leaveSession() async -> Bool {
        do {
            try await APIClient.shared.leaveBuddySession(sessionId: sessionId)
            actionError = nil
            return true
        } catch let error as APIError {
            actionError = error.message
            return false
        } catch {
            actionError = "Could not leave session."
            return false
        }
    }

    func beginDistraction() {
        guard isActive, mindState == "clear" else { return }
        mindState = "thinking"
        distractionSegmentCount += 1
        mindStateLog.append(MindStateEntry(time: Double(currentElapsedSeconds()), state: "thinking"))
    }

    func beginHyperfocus() {
        guard isActive, mindState == "clear" else { return }
        mindState = "hyperfocus"
        mindStateLog.append(MindStateEntry(time: Double(currentElapsedSeconds()), state: "hyperfocus"))
    }

    func endMindStateHold() {
        guard mindState == "thinking" || mindState == "hyperfocus" else { return }
        mindState = "clear"
        mindStateLog.append(MindStateEntry(time: Double(currentElapsedSeconds()), state: "clear"))
    }

    func addPendingThought() {
        let trimmed = pendingThought.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        capturedThoughts.append(CapturedThought(timeInSession: currentElapsedSeconds(), text: trimmed))
        pendingThought = ""
    }

    // MARK: - Sound Preferences (#554)

    func toggleSound(_ keyPath: WritableKeyPath<AudioEngine.SoundPrefs, Bool>) {
        let toggledKeyWasEnabled = soundPrefs[keyPath: keyPath]
        let voiceCountdownWasEnabled = soundPrefs.voiceCountdown
        // #736: haptics is vibration, not sound. Enabling it must not warm the
        // audio session — that ducks whatever else is playing for a sound this
        // sit is not going to make.
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
            prepareHaptics()
        }

        if effects.warmUp {
            // #667: this view model never warms the engine anywhere, so a buddy sit
            // could leave the audio session inactive for its whole run. Reactivate on
            // any off→on toggle so the re-enabled sound is audible.
            AudioEngine.shared.warmUp()
        }
        if effects.preloadVoiceCountdown {
            AudioEngine.shared.preloadVoiceCountdown()
        }
        if effects.resetVoiceDedup {
            // Voice countdown was just disabled — reset dedup state so re-enabling
            // during the same remaining second announces correctly (#554).
            lastVoiceCountdownSec = 0
        }
        if effects.cancelVoiceCountdown {
            // Stop any in-flight clip.
            AudioEngine.shared.cancelVoiceCountdownPlayback()
        }
    }

    /// Called from `BuddyActiveSessionView`'s per-second timer.
    /// Fires the voice countdown clip matching the current remaining seconds,
    /// with the same clamp/dedup/reset semantics as the solo session path.
    ///
    /// #736: that same tick is the buddy sit's only timing source. Minute and
    /// end haptics are read from it before the voice-countdown guard, so a
    /// sitter who turned every sound off still feels the sit.
    func handleVoiceCountdownTick(remaining: Int) {
        emitSharedTimerHaptics(remaining: remaining)
        let remainingDouble = Double(remaining)
        guard soundPrefs.voiceCountdown else { return }

        if VoiceCountdownLogic.shouldReset(remaining: remainingDouble) {
            if lastVoiceCountdownSec != 0 {
                lastVoiceCountdownSec = 0
                AudioEngine.shared.cancelVoiceCountdownPlayback()
            }
        } else if let sec = VoiceCountdownLogic.announceSecond(
            remaining: remainingDouble,
            lastAnnouncedSec: lastVoiceCountdownSec
        ) {
            lastVoiceCountdownSec = sec
            AudioEngine.shared.playVoiceCountdown(seconds: sec)
        }
    }

    func currentElapsedSeconds(at now: Date = Date()) -> Int {
        guard let anchor = activeAnchor else {
            return snapshot?.elapsedSeconds ?? 0
        }
        let localDelta = now.timeIntervalSince(anchor.localNow)
        let estimated = anchor.serverElapsedAtSync + Int(localDelta.rounded(.towardZero))
        return max(0, min(anchor.durationSeconds, estimated))
    }

    func currentRemainingSeconds(at now: Date = Date()) -> Int {
        guard let duration = snapshot?.durationSeconds else { return 0 }
        return max(0, duration - currentElapsedSeconds(at: now))
    }

    func formattedRemaining(at now: Date = Date()) -> String {
        let remaining = currentRemainingSeconds(at: now)
        return "\(remaining / 60):\(String(format: "%02d", remaining % 60))"
    }

    func savePersonalSession() async -> SessionDTO? {
        guard let snapshot, snapshot.state == "completed" else { return nil }
        isSavingCompletion = true
        completionSaveError = nil
        defer { isSavingCompletion = false }
        AudioEngine.shared.cancelVoiceCountdownPlayback()
        lastVoiceCountdownSec = 0

        finalizeOpenMindStateSegmentIfNeeded(duration: snapshot.durationSeconds)

        let logToSave = normalizedMindStateLog(forDuration: snapshot.durationSeconds)
        let clearPercent = SessionLogic.calculateClearPercent(
            mindStateLog: logToSave,
            totalElapsed: Double(snapshot.durationSeconds)
        )
        let thoughtInputs = capturedThoughts.map {
            BatchThoughtsRequest.ThoughtInput(timeInSession: $0.timeInSession, text: $0.text)
        }
        let request = RecordBuddyPersonalSessionRequest(
            clearPercent: clearPercent,
            thoughtCount: thoughtInputs.count,
            mindStateLog: logToSave,
            actualTime: snapshot.durationSeconds,
            sessionDate: localISODate(),
            thoughts: thoughtInputs.isEmpty ? nil : thoughtInputs
        )

        do {
            let session = try await APIClient.shared.recordBuddyPersonalSession(
                sessionId: sessionId,
                request: request
            )
            _ = await leaveSession()
            return session
        } catch let error as APIError {
            completionSaveError = error.message
            return nil
        } catch {
            completionSaveError = "Could not save personal session."
            return nil
        }
    }

    var isActive: Bool {
        snapshot?.state == "active"
    }

    var isHost: Bool {
        snapshot?.isHost ?? false
    }

    private func handleSnapshotUpdate(_ snapshot: BuddySnapshotDTO) {
        if snapshot.state == "active", let startedAt = parseISO(snapshot.startedAt) {
            let key = "\(snapshot.id):\(startedAt.timeIntervalSince1970)"
            let serverNow = parseISO(snapshot.serverNow) ?? Date()
            let elapsedAtSync = snapshot.elapsedSeconds ?? max(
                0,
                min(snapshot.durationSeconds, Int(serverNow.timeIntervalSince(startedAt)))
            )
            if key != lastActiveKey {
                lastActiveKey = key
                mindState = "clear"
                mindStateLog = [MindStateEntry(time: 0, state: "clear")]
                capturedThoughts = []
                pendingThought = ""
                distractionSegmentCount = 0
                // #554: new active session window — reset voice countdown so the first
                // announcement in this window is not suppressed by a stale lastVoiceCountdownSec.
                if lastVoiceCountdownSec != 0 {
                    lastVoiceCountdownSec = 0
                    AudioEngine.shared.cancelVoiceCountdownPlayback()
                }
                // #736: seed from server elapsed so markers that already passed
                // do not replay, and a window that opens already finished does
                // not buzz on the next tick.
                seedHapticClock(elapsedAtSync: elapsedAtSync, durationSeconds: snapshot.durationSeconds)
            }

            activeAnchor = ActiveAnchor(
                localNow: Date(),
                serverElapsedAtSync: elapsedAtSync,
                durationSeconds: snapshot.durationSeconds
            )
            maybeFetchMeetingToken(snapshot: snapshot)
            return
        }

        // #736: the poll can reconcile the sit to `completed` and unmount the
        // active view before its `remaining == 0` tick. The server only writes
        // `completed` once the full duration has elapsed, so the first
        // completed snapshot after an active window still owes the end cue.
        let wasActiveWindow = activeAnchor != nil
        if wasActiveWindow, snapshot.state == "completed", !sessionEndHapticEmitted {
            if let cue = HapticCueLogic.sessionEndCue(
                hapticsEnabled: soundPrefs.haptics,
                completedNaturally: true,
                isAbandoned: false
            ) {
                fireHaptic(cue)
            }
        }

        activeAnchor = nil
        latestMeetingTokenRequestKey = nil
        meetingToken = nil
        meetingTokenError = nil
        resetHapticClock()
    }

    /// #736: minute-marker and natural-completion haptics from the shared timer.
    ///
    /// The iOS buddy room does not render its own haptics control. The
    /// preference is per-user and set elsewhere — a solo sit, or the web buddy
    /// room — and this view model only plays what that preference already says.
    private func emitSharedTimerHaptics(remaining: Int) {
        guard let snapshot else { return }
        let duration = snapshot.durationSeconds
        // Waiting and completed screens do not owe a cue. Abandoned is handled
        // below so a tick that lands as the host ends the sit still goes
        // through `HapticCueLogic` and stays silent.
        let isAbandoned = snapshot.state == "abandoned"
        guard snapshot.state == "active" || isAbandoned else { return }
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: remaining,
            durationSeconds: duration,
            lastCompletedBlockIndex: lastCompletedMinuteBlockIndex,
            sessionEndAlreadyEmitted: sessionEndHapticEmitted
        )
        lastCompletedMinuteBlockIndex = signals.updatedCompletedBlockIndex
        sessionEndHapticEmitted = signals.sessionEndAlreadyEmitted

        // Leaving before remaining hits 0 never sets `completedNaturally`.
        if let cue = HapticCueLogic.minuteMarkerCue(
            hapticsEnabled: soundPrefs.haptics,
            crossedMinuteBoundary: signals.crossedMinuteBoundary,
            fullMinuteRemains: signals.fullMinuteRemains,
            isAbandoned: isAbandoned
        ) {
            fireHaptic(cue)
        }
        if let cue = HapticCueLogic.sessionEndCue(
            hapticsEnabled: soundPrefs.haptics,
            completedNaturally: signals.completedNaturally,
            isAbandoned: isAbandoned
        ) {
            fireHaptic(cue)
        }
    }

    private func seedHapticClock(elapsedAtSync: Int, durationSeconds: Int) {
        lastCompletedMinuteBlockIndex = SessionLogic.completedMinuteBlockIndex(
            elapsed: Double(max(0, elapsedAtSync)),
            totalSeconds: durationSeconds
        )
        sessionEndHapticEmitted = elapsedAtSync >= durationSeconds
        if soundPrefs.haptics {
            prepareHaptics()
        }
    }

    private func resetHapticClock() {
        lastCompletedMinuteBlockIndex = -1
        sessionEndHapticEmitted = false
    }

    private func prepareHaptics() {
        gentleHaptic.prepare()
        pronouncedHaptic.prepare()
    }

    private func fireHaptic(_ cue: HapticCueLogic.Cue) {
        switch HapticCueLogic.intensity(for: cue) {
        case .gentle:
            gentleHaptic.impactOccurred()
            gentleHaptic.prepare()
        case .pronounced:
            pronouncedHaptic.notificationOccurred(.success)
        }
    }

    private func maybeFetchMeetingToken(snapshot: BuddySnapshotDTO) {
        guard let dailyRoomURL = snapshot.dailyRoomUrl, !dailyRoomURL.isEmpty else {
            meetingToken = nil
            meetingTokenError = nil
            latestMeetingTokenRequestKey = nil
            return
        }
        let requestKey = "\(snapshot.id):\(snapshot.revision):\(dailyRoomURL)"
        if latestMeetingTokenRequestKey == requestKey, meetingToken != nil { return }
        if latestMeetingTokenRequestKey != requestKey {
            meetingToken = nil
            meetingTokenError = nil
        }
        latestMeetingTokenRequestKey = requestKey

        Task { [weak self] in
            guard let self else { return }
            do {
                let token = try await APIClient.shared.getBuddyMeetingToken(sessionId: sessionId)
                guard self.latestMeetingTokenRequestKey == requestKey else { return }
                self.meetingToken = token
                self.meetingTokenError = nil
            } catch let error as APIError {
                guard self.latestMeetingTokenRequestKey == requestKey else { return }
                self.meetingToken = nil
                self.meetingTokenError = error.message
            } catch {
                guard self.latestMeetingTokenRequestKey == requestKey else { return }
                self.meetingToken = nil
                self.meetingTokenError = "Could not get video token."
            }
        }
    }

    private func finalizeOpenMindStateSegmentIfNeeded(duration: Int) {
        guard mindState == "thinking" || mindState == "hyperfocus" else { return }
        mindState = "clear"
        mindStateLog.append(MindStateEntry(time: Double(duration), state: "clear"))
    }

    private func normalizedMindStateLog(forDuration duration: Int) -> [MindStateEntry] {
        if mindStateLog.isEmpty {
            return [MindStateEntry(time: 0, state: "clear")]
        }

        var log = mindStateLog.sorted { $0.time < $1.time }
        if let first = log.first, first.time > 0 {
            log.insert(MindStateEntry(time: 0, state: "clear"), at: 0)
        }
        if log.last?.state != "clear" {
            log.append(MindStateEntry(time: Double(duration), state: "clear"))
        }
        return log
    }

    private func localISODate() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        return formatter.string(from: Date())
    }

    private func parseISO(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let date = isoFormatter.date(from: raw) {
            return date
        }
        return isoFormatterFallback.date(from: raw)
    }
}

private struct ActiveAnchor {
    let localNow: Date
    let serverElapsedAtSync: Int
    let durationSeconds: Int
}
