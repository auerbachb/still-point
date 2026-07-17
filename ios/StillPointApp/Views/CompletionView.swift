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
    let duration: Int
    let bonusSeconds: Int
    let attentionLog: [AttentionEntry]?
    let attentionElapsed: Double?

    @State private var endNote = ""
    @State private var noteSaved = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var uiTestAutoSaveTask: Task<Void, Never>?

    private var nextDay: Int { dayNumber + 1 }
    private var nextDuration: Int { StillPoint.duration(forDay: nextDay) }
    private var nextBlocks: Int { StillPoint.blockCount(forDuration: nextDuration) }
    private var isSaveDisabled: Bool { endNote.isEmpty || noteSaved || isSaving || sessionId.isEmpty }
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

                // Stats cards
                VStack(spacing: SPSpacing.s3) {
                    HStack(spacing: SPSpacing.s3) {
                        statCard(
                            value: "\(clearPercent)%",
                            label: "AWARENESS",
                            color: SPColor.green,
                            bgColor: SPColor.greenBgFaint,
                            borderColor: SPColor.greenBorderSubtle
                        )

                        statCard(
                            value: "\(max(0, 100 - clearPercent))%",
                            label: "DISTRACTION",
                            color: SPColor.amber,
                            bgColor: SPColor.amberBgFaint,
                            borderColor: SPColor.amberBorderSubtle
                        )
                    }

                    statCard(
                        value: "\(thoughtCount)",
                        label: "CAPTURED NOTES",
                        color: SPColor.amber,
                        bgColor: SPColor.amberBgFaint,
                        borderColor: SPColor.amberBorderSubtle
                    )

                    if let attentionSummary {
                        HStack(spacing: SPSpacing.s3) {
                            statCard(
                                value: "\(attentionSummary.attentivePercent)%",
                                label: "GAZE ON SCREEN",
                                color: SPColor.green,
                                bgColor: SPColor.greenBgFaint,
                                borderColor: SPColor.greenBorderSubtle
                            )

                            statCard(
                                value: "\(attentionSummary.awayPercent)%",
                                label: "GAZE AWAY",
                                color: SPColor.amber,
                                bgColor: SPColor.amberBgFaint,
                                borderColor: SPColor.amberBorderSubtle
                            )
                        }
                        .accessibilityIdentifier("completion.attentionSummary")
                    }
                }

                // Captured thoughts
                if !thoughts.isEmpty {
                    VStack(alignment: .leading, spacing: SPSpacing.s2) {
                        Text("THOUGHTS CAPTURED")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .tracking(2)

                        ForEach(thoughts) { thought in
                            HStack(alignment: .top, spacing: SPSpacing.s2) {
                                Text("@\(thought.timeInSession)s")
                                    .font(SPFont.mono(11))
                                    .foregroundStyle(SPColor.amberText)
                                    .frame(width: 50, alignment: .trailing)

                                Text(thought.text)
                                    .font(SPFont.serifItalic(15))
                                    .foregroundStyle(Color(SPColor.fg2))
                            }
                        }
                    }
                    .padding(SPSpacing.s3)
                    .background(SPColor.amberBgFaint)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(SPColor.amberBorderSubtle)
                    )
                }

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
                        .disabled(isSaving || noteSaved)
                        .onChange(of: endNote) {
                            if noteSaved { noteSaved = false }
                        }
                        .accessibilityIdentifier("completion.endNoteEditor")

                    if noteSaved {
                        Text("Saved")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.green)
                            .accessibilityIdentifier("completion.savedIndicator")
                    } else {
                        Button {
                            saveEndNote()
                        } label: {
                            HStack(spacing: SPSpacing.s1) {
                                if isSaving {
                                    ProgressView()
                                        .controlSize(.small)
                                        .tint(Color(SPColor.bg))
                                }
                                Text(isSaving ? "Saving…" : "Save note")
                            }
                            .font(SPFont.serifItalic(18, weight: .light))
                            .spCapsuleButtonStyle(
                                isSaveDisabled ? .neutral : .greenSolid,
                                size: .fullWidth,
                                prominent: isSaveDisabled
                            )
                            .foregroundStyle(isSaveDisabled ? Color(SPColor.fg3) : Color(SPColor.bg))
                        }
                        .disabled(isSaveDisabled)
                        .accessibilityIdentifier("completion.saveNoteButton")
                    }

                    if let saveError {
                        VStack(alignment: .leading, spacing: SPSpacing.s1) {
                            Text(saveError)
                                .font(SPFont.mono(11))
                                .foregroundStyle(SPColor.dangerMuted)

                            Button {
                                saveEndNote()
                            } label: {
                                Text("Retry save")
                                    .font(SPFont.mono(11, weight: .medium))
                                    .foregroundStyle(SPColor.dangerMuted)
                            }
                            .disabled(isSaving)
                        }
                    }
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

                // Return button
                Button {
                    Task { await appVM.returnHome() }
                } label: {
                    Text("Return")
                        .font(SPFont.serifItalic(18, weight: .light))
                        .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                }
                .accessibilityIdentifier("completion.returnButton")

                Spacer().frame(height: SPSpacing.s4)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .onChange(of: endNote) { _, newValue in
            saveError = nil
            scheduleUITestAutoSaveIfNeeded(for: newValue)
        }
    }

    private func statCard(
        value: String,
        label: String,
        color: Color,
        bgColor: Color,
        borderColor: Color
    ) -> some View {
        VStack(spacing: SPSpacing.s1) {
            Text(value)
                .font(SPFont.statValue)
                .foregroundStyle(color)
            Text(label)
                .font(SPFont.statLabel)
                .foregroundStyle(color.opacity(0.6))
                .tracking(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SPSpacing.s3)
        .background(bgColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(borderColor)
        )
    }

    private func saveEndNote() {
        let noteToSave = endNote
        guard !noteToSave.isEmpty, !sessionId.isEmpty, !isSaving, !noteSaved else { return }
        isSaving = true
        saveError = nil
        Task { @MainActor in
            do {
                try await SessionSyncCoordinator.shared.appendEndNote(
                    clientSessionId: clientSessionId,
                    note: noteToSave
                )
                isSaving = false
                noteSaved = true
                logUITestDiagnostic("completion.saveEndNote.success clientSessionId=\(clientSessionId.uuidString)")
            } catch SessionSyncError.entryNotFound {
                let request = BatchThoughtsRequest(
                    sessionId: sessionId,
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
                    noteSaved = true
                    logUITestDiagnostic("completion.saveEndNote.success sessionId=\(sessionId)")
                } catch let error as APIError {
                    print("Failed to save end note: \(error)")
                    isSaving = false
                    saveError = saveErrorMessage(for: error.status)
                    logUITestDiagnostic("completion.saveEndNote.apiError status=\(error.status) message=\(error.message)")
                } catch {
                    print("Failed to save end note: \(error)")
                    isSaving = false
                    saveError = "Could not save your note. Please try again."
                }
            } catch let error as APIError {
                print("Failed to save end note: \(error)")
                isSaving = false
                saveError = saveErrorMessage(for: error.status)
                logUITestDiagnostic("completion.saveEndNote.apiError status=\(error.status) message=\(error.message)")
            } catch {
                print("Failed to save end note: \(error)")
                isSaving = false
                saveError = "Could not save your note. Please try again."
                logUITestDiagnostic("completion.saveEndNote.error message=\(error.localizedDescription)")
            }
        }
    }

    private func scheduleUITestAutoSaveIfNeeded(for note: String) {
        guard isUITestMode, !note.isEmpty, !sessionId.isEmpty, !noteSaved else { return }
        uiTestAutoSaveTask?.cancel()
        uiTestAutoSaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled,
                  endNote == note,
                  !isSaving,
                  !noteSaved else { return }
            saveEndNote()
        }
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
