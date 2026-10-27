import SwiftUI
import StillPointShared
import os

struct CompletionView: View {
    private static let diagLog = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "e2e-diag")

    let appVM: AppViewModel
    let sessionId: String
    let clientSessionId: UUID
    let clearPercent: Int
    let thoughtCount: Int
    let thoughts: [CapturedThought]
    let dayNumber: Int
    let sessionType: SessionType
    let track: Track
    let sessionCompleted: Bool
    let duration: Int
    let bonusSeconds: Int
    let attentionLog: [AttentionEntry]?
    let attentionElapsed: Double?
    /// #563: ambient sound level summary; nil when capture was off or mic was denied.
    let ambientSoundSummary: AmbientSoundSummary?
    /// #898: today's two sits done as one (#769). Its "tomorrow" is the next two
    /// sits added up.
    let combined: Bool

    @State private var endNote = ""
    @State private var noteSaved = false
    @State private var lastSavedNote = ""
    /// #792: a note write that failed or was cancelled may still have landed,
    /// so until the next one succeeds `lastSavedNote` is a guess and every
    /// write is sent.
    @State private var noteUnsure = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var noteAutosaveTask: Task<Void, Never>?
    @State private var moodAutosaveTask: Task<Void, Never>?
    @State private var returnFlushFailed = false
    @State private var isReturning = false

    // Before/after mood matrix (#472 / #635)
    @State private var moodMatrix: [MoodKey: MoodMatrixEntry] = [:]
    @State private var moodMatrixSaved = false
    @State private var lastSavedMoodKey = ""
    /// #792: the rows the server holds, so deselecting them clears them there.
    @State private var persistedMood: [String: MoodMatrixEntry] = [:]
    /// #792: as `noteUnsure`, for mood. While set, `persistedMood` also holds
    /// the rows of the write that failed, so a later patch still empties them.
    @State private var moodUnsure = false
    @State private var isSavingMoodMatrix = false
    /// #792: false until the stored matrix has loaded. The grid stays disabled
    /// until then, so the load cannot replace a cell picked while it was in flight.
    @State private var moodLoaded = false
    @State private var moodMatrixSaveError: String?

    /// #792: where this sit stands in the offline queue — nil until it is read.
    @State private var queueState: SessionSyncCoordinator.QueuedSessionState?

    /// #792: the id the mood is loaded from and sent against. Nil until the
    /// queue says the sit has a server row: a pending sit's `sessionId` is its
    /// provisional client id, and every PATCH against it fails.
    private var detailSessionId: String? {
        queueState?.detailSessionId(handedSessionId: sessionId)
    }

    private var nextDuration: Int {
        if combined {
            return DurationRecovery.previewNextCombinedDuration(
                completed: sessionCompleted,
                user: appVM.currentUser
            )
        }
        return DurationRecovery.previewNextStandardDuration(
            sessionType: sessionType,
            completed: sessionCompleted,
            track: track,
            user: appVM.currentUser
        )
    }
    private var nextBlocks: Int { StillPoint.blockCount(forDuration: nextDuration) }
    private var trimmedEndNote: String {
        endNote.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isQuickSession: Bool { sessionType == .quick }
    private var hasUnlockedApps: Bool { appVM.appBlockingManager.didUnlockFromLastCompletedSession }

    private var attentionSummary: AttentionTrackingLogic.AttentionSummary? {
        guard let attentionLog, let attentionElapsed, attentionElapsed > 0 else { return nil }
        return AttentionTrackingLogic.calculateAttentionSummary(
            log: attentionLog,
            totalElapsed: attentionElapsed
        )
    }

    private var durationSubtitle: String {
        guard bonusSeconds > 0 else {
            return "\(duration) seconds of sustained attention"
        }
        let total = duration + bonusSeconds
        return "\(duration) planned · \(bonusSeconds)s bonus (\(total)s timer)"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Spacer().frame(height: SPSpacing.s4)

                // Header
                VStack(spacing: SPSpacing.s2) {
                    Text(isQuickSession ? "Quick Minute Complete" : "Day \(dayNumber) Complete")
                        .font(SPFont.serifItalic(32, weight: .light))
                        .foregroundStyle(Color(SPColor.fg))
                        .accessibilityIdentifier("completion.dayTitle")

                    Text(durationSubtitle)
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(1)
                        .accessibilityIdentifier("completion.durationLabel")
                }

                CompletionStatsSection(
                    clearPercent: clearPercent,
                    thoughtCount: thoughtCount,
                    attentionSummary: attentionSummary,
                    ambientSoundSummary: ambientSoundSummary
                )

                if !thoughts.isEmpty {
                    CompletionThoughtsSection(thoughts: thoughts)
                }

                // Session environment photo (optional)
                CompletionPhotoSection(sessionId: sessionId)

                // End-of-session note
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Text("SESSION NOTE")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    TextEditor(text: $endNote)
                        .font(SPFont.serifItalic(15))
                        .foregroundStyle(Color(SPColor.fg))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 80)
                        .padding(SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(SPColor.border2)
                        )
                        .disabled(isReturning)
                        .accessibilityIdentifier("completion.endNoteEditor")

                    if noteSaved {
                        Text("Saved")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.green)
                            .accessibilityIdentifier("completion.savedIndicator")
                    }

                    if let saveError {
                        Text(saveError)
                            .font(SPFont.mono(11))
                            .foregroundStyle(SPColor.dangerMuted)
                    }
                }

                // Mood shift (#472 / #635). #792: hidden while the sit is
                // pending sync, as on web — there is no server row to attach
                // it to, so "save and return to home" leaves on the first tap.
                if detailSessionId != nil {
                    MoodShiftSection(
                        moodMatrix: moodMatrix,
                        cellsDisabled: moodMatrixCellsDisabled,
                        saved: moodMatrixSaved,
                        saveError: moodMatrixSaveError,
                        onToggle: { key, column, level in
                            toggleMoodCell(key: key, column: column, level: level)
                        }
                    )
                }

                // Progression preview
                VStack(spacing: SPSpacing.s1) {
                    Text(isQuickSession ? "DAY \(dayNumber) UNCHANGED" : "TOMORROW")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    Text(isQuickSession ? "return when you're ready" : "\(nextDuration)s · \(nextBlocks) blocks")
                        .font(SPFont.mono(14, weight: .light))
                        .foregroundStyle(Color(SPColor.fg3))
                }

                if hasUnlockedApps {
                    VStack(spacing: SPSpacing.s1) {
                        Text("APP GATE OPEN")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.green)
                            .tracking(2)
                            .accessibilityIdentifier("completion.appGateOpen")
                        Text(appVM.appBlockingManager.statusText)
                            .font(SPFont.serif(14, weight: .light))
                            .foregroundStyle(Color(SPColor.fg3))
                            .multilineTextAlignment(.center)
                    }
                    .padding(SPSpacing.s3)
                    .frame(maxWidth: .infinity)
                    .background(SPColor.greenBgFaint)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(SPColor.greenBorderSubtle)
                    )
                }

                Button {
                    Task { await saveAndReturnHome() }
                } label: {
                    Text("save and return to home")
                        .font(SPFont.serifItalic(18, weight: .light))
                        .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                }
                .disabled(isReturning)
                .accessibilityIdentifier("completion.returnButton")

                Spacer().frame(height: SPSpacing.s4)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .onChange(of: endNote) { _, newValue in
            saveError = nil
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed != lastSavedNote { noteSaved = false }
            scheduleNoteAutosave(for: newValue)
        }
        .task(id: sessionId) {
            await resolveQueueState()
            await loadPersistedSessionData()
        }
    }

    // MARK: - Mood Matrix (#472 / #635)

    private var moodMatrixCellsDisabled: Bool {
        isSavingMoodMatrix || isReturning || !moodLoaded
    }

    private func toggleMoodCell(key: MoodKey, column: MoodMatrixColumn, level: Int) {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        let newBefore: Int?
        let newAfter: Int?
        switch column {
        case .before:
            newBefore = entry.before == level ? nil : level
            newAfter = entry.after
        case .after:
            newBefore = entry.before
            newAfter = entry.after == level ? nil : level
        }
        moodMatrix[key] = MoodMatrixEntry(before: newBefore, after: newAfter)
        moodMatrixSaveError = nil
        moodMatrixSaved = false
        scheduleMoodAutosave()
    }

    private func saveMoodMatrix() async {
        guard let detailSessionId, !isSavingMoodMatrix else { return }
        let key = moodSaveKey
        guard moodUnsure || key != lastSavedMoodKey else {
            moodMatrixSaved = !key.isEmpty
            moodMatrixSaveError = nil
            return
        }
        isSavingMoodMatrix = true
        moodMatrixSaveError = nil
        // #792: deselecting every cell clears the stored matrix; emptying one
        // stored row deletes just that row.
        let desired = MoodMatrixLogic.buildPayload(from: moodMatrix)
        let patch = MoodMatrixPatch(from: moodMatrix, persisted: persistedMood)
        do {
            _ = try await APIClient.shared.updateSessionMoodMatrix(sessionId: detailSessionId, patch: patch)
            isSavingMoodMatrix = false
            lastSavedMoodKey = key
            persistedMood = desired
            moodUnsure = false
            moodMatrixSaved = !patch.clearsMatrix
        } catch is CancellationError {
            isSavingMoodMatrix = false
            markMoodUnsure(attempted: desired)
        } catch let error as APIError {
            isSavingMoodMatrix = false
            markMoodUnsure(attempted: desired)
            moodMatrixSaveError = moodMatrixErrorMessage(for: error.status)
        } catch {
            isSavingMoodMatrix = false
            markMoodUnsure(attempted: desired)
            moodMatrixSaveError = "Unable to save mood — please try again"
        }
    }

    /// #792: the failed write may have stored `attempted`, so count its rows as
    /// stored and send the next write whatever it holds.
    private func markMoodUnsure(attempted: [String: MoodMatrixEntry]) {
        persistedMood.merge(attempted) { _, attemptedRow in attemptedRow }
        moodUnsure = true
    }

    private var moodSaveKey: String {
        let patch = MoodMatrixPatch(from: moodMatrix)
        return patch.entries.keys.sorted().map { key in
            let entry = patch.entries[key]
            let before = entry?.before.map(String.init) ?? "-"
            let after = entry?.after.map(String.init) ?? "-"
            return "\(key):\(before):\(after)"
        }.joined(separator: ",")
    }

    private func scheduleMoodAutosave() {
        moodAutosaveTask?.cancel()
        moodAutosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            while isSavingMoodMatrix {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
            guard !Task.isCancelled else { return }
            await saveMoodMatrix()
        }
    }

    private func moodMatrixErrorMessage(for status: Int) -> String {
        switch status {
        case 401:
            return "Please log in again"
        case 400:
            return "Invalid mood value"
        case 404:
            return "Session not found — please try again"
        case 0:
            return "Unable to save mood — please try again"
        default:
            return "Failed to save mood"
        }
    }

    /// #792: read once, when the screen opens — like web's `isPendingSync`, a
    /// sit that syncs while the screen is up stays pending here. A failed read
    /// leaves the state unread, which keeps the mood hidden rather than risk
    /// sending it against a provisional id.
    @MainActor
    private func resolveQueueState() async {
        guard let ownerUserId = appVM.currentUser?.id else { return }
        queueState = try? await SessionSyncCoordinator.shared.queuedSessionState(
            clientSessionId: clientSessionId,
            ownerUserId: ownerUserId
        )
    }

    @MainActor
    private func loadPersistedSessionData() async {
        guard let detailSessionId else { return }
        moodLoaded = false
        moodMatrix = [:]
        moodMatrixSaved = false
        moodMatrixSaveError = nil
        do {
            let (session, _) = try await APIClient.shared.getSessionBySessionId(detailSessionId)
            if let stored = session.moodMatrix {
                moodMatrix = MoodMatrixLogic.sanitizedStored(stored)
                // #792: a loaded matrix is stored, so deselecting it is a clear.
                persistedMood = MoodMatrixLogic.buildPayload(from: moodMatrix)
                lastSavedMoodKey = moodSaveKey
            }
        } catch {
            // Non-blocking: recap still works when reload fails.
        }
        // #792: after a failed load too, so the grid is never left disabled.
        moodLoaded = true
    }

    // MARK: - Session Note

    /// Saves the trimmed note, or — #792 — clears the stored one once the field
    /// is emptied. An empty note that was never saved sends nothing.
    private func saveEndNote() async {
        let noteToSave = trimmedEndNote
        guard !sessionId.isEmpty, !isSaving else { return }
        guard noteUnsure || noteToSave != lastSavedNote else {
            noteSaved = !noteToSave.isEmpty
            saveError = nil
            return
        }
        guard let ownerUserId = appVM.currentUser?.id else { return }
        isSaving = true
        saveError = nil
        do {
            if noteToSave.isEmpty {
                try await SessionSyncCoordinator.shared.clearEndNote(
                    clientSessionId: clientSessionId,
                    ownerUserId: ownerUserId
                )
            } else {
                try await SessionSyncCoordinator.shared.replaceEndNote(
                    clientSessionId: clientSessionId,
                    ownerUserId: ownerUserId,
                    note: noteToSave
                )
            }
            isSaving = false
            lastSavedNote = noteToSave
            noteUnsure = false
            noteSaved = !noteToSave.isEmpty
            logUITestDiagnostic("completion.saveEndNote.success clientSessionId=\(clientSessionId.uuidString)")
        } catch SessionSyncError.entryNotFound {
            await saveEndNoteToServer(noteToSave)
        } catch SessionSyncError.entryParked {
            // #983: retrying cannot help — the server turned this sit down.
            isSaving = false
            noteSaved = false
            saveError = "This sit couldn't be saved to your account, so its note can't be either."
            logUITestDiagnostic("completion.saveEndNote.parked clientSessionId=\(clientSessionId.uuidString)")
        } catch let error as APIError {
            print("Failed to save end note: \(error)")
            isSaving = false
            noteUnsure = true
            saveError = saveErrorMessage(for: error.status)
            logUITestDiagnostic("completion.saveEndNote.apiError status=\(error.status) message=\(error.message)")
        } catch {
            print("Failed to save end note: \(error)")
            isSaving = false
            noteUnsure = true
            saveError = "Could not save your note. Please try again."
            logUITestDiagnostic("completion.saveEndNote.error message=\(error.localizedDescription)")
        }
    }

    /// No sit in the queue under this client id — a buddy sit, which records
    /// itself on the server — so the note goes straight to its session.
    private func saveEndNoteToServer(_ noteToSave: String) async {
        // #792: never the provisional id of a sit that was pending; the server
        // has no row for it. The entry is gone now, so an unread state counts
        // as not queued.
        guard let targetSessionId = (queueState ?? .notQueued).detailSessionId(handedSessionId: sessionId) else {
            isSaving = false
            saveError = saveErrorMessage(for: 0)
            logUITestDiagnostic("completion.saveEndNote.noServerSession clientSessionId=\(clientSessionId.uuidString)")
            return
        }
        let request = noteToSave.isEmpty
            ? BatchThoughtsRequest(
                sessionId: targetSessionId,
                dayNumber: dayNumber,
                thoughts: [],
                clearCompletionNote: true
            )
            : BatchThoughtsRequest(
                sessionId: targetSessionId,
                dayNumber: dayNumber,
                thoughts: [
                    BatchThoughtsRequest.ThoughtInput(
                        timeInSession: -1,
                        text: noteToSave
                    )
                ]
            )
        do {
            _ = try await APIClient.shared.batchThoughts(request)
            isSaving = false
            lastSavedNote = noteToSave
            noteUnsure = false
            noteSaved = !noteToSave.isEmpty
            logUITestDiagnostic("completion.saveEndNote.success sessionId=\(targetSessionId)")
        } catch let error as APIError {
            print("Failed to save end note: \(error)")
            isSaving = false
            noteUnsure = true
            saveError = saveErrorMessage(for: error.status)
            logUITestDiagnostic("completion.saveEndNote.apiError status=\(error.status) message=\(error.message)")
        } catch {
            print("Failed to save end note: \(error)")
            isSaving = false
            noteUnsure = true
            saveError = "Could not save your note. Please try again."
        }
    }

    private func scheduleNoteAutosave(for note: String) {
        // #792: an empty note, or one matching the last save, is still
        // scheduled. `saveEndNote` decides once any save in flight is done, so
        // emptying the field while that save is on the wire still clears it.
        guard !sessionId.isEmpty else { return }
        noteAutosaveTask?.cancel()
        noteAutosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            // Wait out a save still in flight so this edit is not skipped.
            while isSaving {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
            guard !Task.isCancelled, endNote == note else { return }
            await saveEndNote()
        }
    }

    private func saveAndReturnHome() async {
        guard !isReturning else { return }
        isReturning = true
        if returnFlushFailed {
            await appVM.returnHome()
            isReturning = false
            return
        }
        noteAutosaveTask?.cancel()
        moodAutosaveTask?.cancel()
        while isSaving || isSavingMoodMatrix {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        await saveEndNote()
        await saveMoodMatrix()
        guard saveError == nil, moodMatrixSaveError == nil else {
            returnFlushFailed = true
            isReturning = false
            return
        }
        await appVM.returnHome()
        isReturning = false
    }

    private func logUITestDiagnostic(_ message: String) {
        guard isUITestMode else { return }
        Self.diagLog.notice("[E2E-DIAG] \(message, privacy: .public)")
    }

    private var isUITestMode: Bool {
        truthy(ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"])
    }

    private func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    private func saveErrorMessage(for status: Int) -> String {
        switch status {
        case 401:
            return "Please log in again"
        case 400, 404:
            return "Unable to save note - please try again"
        case 0:
            return "Unable to save note - please try again"
        default:
            return "Failed to save note"
        }
    }
}
