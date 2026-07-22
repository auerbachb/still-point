import SwiftUI
import StillPointShared
import UIKit
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

    @State private var endNote = ""
    @State private var noteSaved = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var uiTestAutoSaveTask: Task<Void, Never>?

    // Session environment photo (optional, local-only MVP)
    @State private var capturedPhoto: UIImage?
    @State private var showPhotoPicker = false

    // Post-session ratings (#521)
    @State private var focusRating: Double = 5
    @State private var happinessRating: Double = 5
    @State private var focusTouched = false
    @State private var happinessTouched = false
    @State private var ratingsSaved = false
    @State private var isSavingRatings = false
    @State private var ratingsSaveError: String?

    private var nextDuration: Int {
        DurationRecovery.previewNextStandardDuration(
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

    private var isSaveDisabled: Bool { trimmedEndNote.isEmpty || noteSaved || isSaving || sessionId.isEmpty }
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

                    if let ambient = ambientSoundSummary {
                        HStack(spacing: SPSpacing.s3) {
                            statCard(
                                value: "\(ambient.quietPercent)%",
                                label: "QUIET TIME",
                                color: SPColor.green,
                                bgColor: SPColor.greenBgFaint,
                                borderColor: SPColor.greenBorderSubtle
                            )

                            statCard(
                                value: String(format: "%.0f dBFS", ambient.avgDb),
                                label: "AVG LEVEL",
                                color: SPColor.amber,
                                bgColor: SPColor.amberBgFaint,
                                borderColor: SPColor.amberBorderSubtle
                            )
                        }
                        .accessibilityIdentifier("completion.ambientSoundSummary")
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

                // Session environment photo (optional)
                sessionPhotoSection

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

                // Post-session ratings (#521)
                if !sessionId.isEmpty {
                    ratingsSection
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
        .sheet(isPresented: $showPhotoPicker) {
            SessionPhotoPicker { image in
                handlePhotoSelected(image)
            }
        }
    }

    // MARK: - Session Photo Section

    @ViewBuilder
    private var sessionPhotoSection: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SESSION PHOTO")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if let photo = capturedPhoto {
                // Thumbnail with retake / remove controls
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: 180)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .clipped()
                        .accessibilityIdentifier("completion.photoThumbnail")

                    HStack {
                        Button {
                            showPhotoPicker = true
                        } label: {
                            Text("Retake")
                                .font(SPFont.mono(11, weight: .medium))
                                .foregroundStyle(Color(SPColor.fg3))
                        }
                        .accessibilityIdentifier("completion.retakePhotoButton")

                        Spacer()

                        Button {
                            removePhoto()
                        } label: {
                            Text("Remove")
                                .font(SPFont.mono(11, weight: .medium))
                                .foregroundStyle(SPColor.dangerMuted)
                        }
                        .accessibilityIdentifier("completion.removePhotoButton")
                    }
                }
            } else {
                // Dashed "add" affordance — intentionally low-prominence so it never feels mandatory.
                // Disabled until sessionId is assigned by the server (mirrors isSaveDisabled guard).
                Button {
                    showPhotoPicker = true
                } label: {
                    HStack(spacing: SPSpacing.s2) {
                        Image(systemName: "camera")
                            .font(.system(size: 15))
                        Text("Add photo of your environment")
                            .font(SPFont.serifItalic(15, weight: .light))
                    }
                    .foregroundStyle(Color(SPColor.fg3))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s3)
                    .background(Color(SPColor.surface1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                    )
                }
                .disabled(sessionId.isEmpty)
                .accessibilityIdentifier("completion.addPhotoButton")
            }
        }
    }

    private func handlePhotoSelected(_ image: UIImage) {
        guard !sessionId.isEmpty else { return }
        guard SessionPhotoStore.shared.save(image, forSessionId: sessionId) != nil else { return }
        capturedPhoto = image
    }

    private func removePhoto() {
        SessionPhotoStore.shared.delete(forSessionId: sessionId)
        capturedPhoto = nil
    }

    // MARK: - Ratings Section (#521)

    @ViewBuilder
    private var ratingsSection: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SESSION RATINGS")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            ratingRow(
                label: "FOCUS",
                value: $focusRating,
                onTouch: { focusTouched = true },
                disabled: isSavingRatings || ratingsSaved
            )
            .accessibilityIdentifier("completion.focusSlider")

            ratingRow(
                label: "HAPPINESS",
                value: $happinessRating,
                onTouch: { happinessTouched = true },
                disabled: isSavingRatings || ratingsSaved
            )
            .accessibilityIdentifier("completion.happinessSlider")

            if ratingsSaved {
                Text("ratings saved")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(SPColor.green)
                    .accessibilityIdentifier("completion.ratingsSavedIndicator")
            } else {
                Button {
                    saveRatings()
                } label: {
                    HStack(spacing: SPSpacing.s1) {
                        if isSavingRatings {
                            ProgressView()
                                .controlSize(.small)
                                .tint(Color(SPColor.bg))
                        }
                        Text(isSavingRatings ? "Saving…" : "Save ratings")
                    }
                    .font(SPFont.serifItalic(18, weight: .light))
                    .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                }
                .disabled(isSavingRatings)
                .accessibilityIdentifier("completion.saveRatingsButton")
            }

            if let ratingsSaveError {
                VStack(alignment: .leading, spacing: SPSpacing.s1) {
                    Text(ratingsSaveError)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.dangerMuted)

                    Button {
                        saveRatings()
                    } label: {
                        Text("Retry")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.dangerMuted)
                    }
                    .disabled(isSavingRatings)
                }
            }
        }
    }

    private func ratingRow(
        label: String,
        value: Binding<Double>,
        onTouch: @escaping () -> Void,
        disabled: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: SPSpacing.s1) {
            HStack {
                Text(label)
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(2)
                Spacer()
                Text("\(Int(value.wrappedValue))")
                    .font(SPFont.mono(14))
                    .foregroundStyle(Color(SPColor.fg))
            }
            Slider(value: value, in: 1...10, step: 1)
                .tint(SPColor.green)
                .disabled(disabled)
                .onChange(of: value.wrappedValue) { _, _ in onTouch() }
        }
    }

    private func saveRatings() {
        guard !sessionId.isEmpty, !isSavingRatings, !ratingsSaved else { return }
        isSavingRatings = true
        ratingsSaveError = nil
        Task { @MainActor in
            // Replicate web's touched-field payload logic exactly:
            // Only send ratings the user explicitly touched. If neither was
            // touched, send both (user tapped Save with visible defaults —
            // treat as intentional, mirroring web's CompletionScreen behaviour).
            let patch: SessionRatingsPatch
            if !focusTouched && !happinessTouched {
                patch = SessionRatingsPatch(
                    focusRating: Int(focusRating),
                    happinessRating: Int(happinessRating)
                )
            } else {
                patch = SessionRatingsPatch(
                    focusRating: focusTouched ? Int(focusRating) : nil,
                    happinessRating: happinessTouched ? Int(happinessRating) : nil
                )
            }
            do {
                _ = try await APIClient.shared.updateSessionRatings(sessionId: sessionId, ratings: patch)
                isSavingRatings = false
                ratingsSaved = true
            } catch is CancellationError {
                isSavingRatings = false
            } catch let error as APIError {
                isSavingRatings = false
                ratingsSaveError = ratingsErrorMessage(for: error.status)
            } catch {
                isSavingRatings = false
                ratingsSaveError = "Unable to save ratings — please try again"
            }
        }
    }

    private func ratingsErrorMessage(for status: Int) -> String {
        switch status {
        case 401:
            return "Please log in again"
        case 400:
            return "Invalid rating value"
        case 404:
            return "Session not found — please try again"
        case 0:
            return "Unable to save ratings — please try again"
        default:
            return "Failed to save ratings"
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
        let noteToSave = trimmedEndNote
        guard !noteToSave.isEmpty, !sessionId.isEmpty, !isSaving, !noteSaved else { return }
        guard let ownerUserId = appVM.currentUser?.id else { return }
        isSaving = true
        saveError = nil
        Task { @MainActor in
            do {
                try await SessionSyncCoordinator.shared.appendEndNote(
                    clientSessionId: clientSessionId,
                    ownerUserId: ownerUserId,
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
