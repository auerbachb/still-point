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
    @State private var lastSavedNote = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var noteAutosaveTask: Task<Void, Never>?
    @State private var ratingsAutosaveTask: Task<Void, Never>?
    @State private var moodAutosaveTask: Task<Void, Never>?
    @State private var returnFlushFailed = false
    @State private var isReturning = false

    // Session environment photo (optional, local-only MVP)
    @State private var capturedPhoto: UIImage?
    @State private var showPhotoPicker = false

    // Post-session ratings (#521)
    @State private var focusRating: Double = 5
    @State private var happinessRating: Double = 5
    @State private var focusTouched = false
    @State private var happinessTouched = false
    @State private var ratingsSaved = false
    @State private var lastSavedRatingsKey = ""
    @State private var isSavingRatings = false
    @State private var ratingsSaveError: String?

    // Before/after mood matrix (#472 / #635)
    @State private var moodMatrix: [MoodKey: MoodMatrixEntry] = [:]
    @State private var moodMatrixSaved = false
    @State private var lastSavedMoodKey = ""
    @State private var isSavingMoodMatrix = false
    @State private var moodMatrixSaveError: String?

    private enum MoodMatrixColumn {
        case before
        case after
    }

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

                // Post-session ratings (#521)
                if !sessionId.isEmpty {
                    ratingsSection
                    moodMatrixSection
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
        .sheet(isPresented: $showPhotoPicker) {
            SessionPhotoPicker { image in
                handlePhotoSelected(image)
            }
        }
        .task(id: sessionId) {
            await loadPersistedSessionData()
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
                onTouch: {
                    focusTouched = true
                    ratingsSaved = false
                    scheduleRatingsAutosave()
                },
                disabled: isReturning
            )
            .accessibilityIdentifier("completion.focusSlider")

            ratingRow(
                label: "HAPPINESS",
                value: $happinessRating,
                onTouch: {
                    happinessTouched = true
                    ratingsSaved = false
                    scheduleRatingsAutosave()
                },
                disabled: isReturning
            )
            .accessibilityIdentifier("completion.happinessSlider")

            if ratingsSaved {
                Text("ratings saved")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(SPColor.green)
                    .accessibilityIdentifier("completion.ratingsSavedIndicator")
            }

            if let ratingsSaveError {
                Text(ratingsSaveError)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
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

    private func saveRatings() async {
        guard !sessionId.isEmpty, !isSavingRatings else { return }
        guard focusTouched || happinessTouched else { return }
        let key = ratingsSaveKey
        guard key != lastSavedRatingsKey else {
            ratingsSaved = true
            return
        }
        isSavingRatings = true
        ratingsSaveError = nil
        let patch = SessionRatingsPatch(
            focusRating: focusTouched ? Int(focusRating) : nil,
            happinessRating: happinessTouched ? Int(happinessRating) : nil
        )
        do {
            _ = try await APIClient.shared.updateSessionRatings(sessionId: sessionId, ratings: patch)
            isSavingRatings = false
            lastSavedRatingsKey = key
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

    private var ratingsSaveKey: String {
        let focus = focusTouched ? String(Int(focusRating)) : "-"
        let happiness = happinessTouched ? String(Int(happinessRating)) : "-"
        return "\(focus):\(happiness)"
    }

    private func scheduleRatingsAutosave() {
        ratingsAutosaveTask?.cancel()
        ratingsAutosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            await saveRatings()
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

    // MARK: - Mood Matrix Section (#472 / #635)

    @ViewBuilder
    private var moodMatrixSection: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("MOOD SHIFT")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            moodMatrixColumnHeaders
            moodMatrixScaleHints

            VStack(spacing: SPSpacing.s2) {
                ForEach(MoodKey.allCases, id: \.self) { key in
                    moodMatrixRow(for: key)
                }
            }

            if moodMatrixSaved {
                Text("mood saved")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(SPColor.green)
                    .accessibilityIdentifier("completion.moodMatrixSavedIndicator")
            }

            if let moodMatrixSaveError {
                Text(moodMatrixSaveError)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
            }
        }
    }

    private var moodMatrixColumnHeaders: some View {
        HStack(spacing: SPSpacing.s2) {
            Text("")
                .frame(width: 56, alignment: .trailing)
            Text("BEFORE")
                .font(SPFont.mono(10, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(1.4)
                .frame(maxWidth: .infinity)
            Text("AFTER")
                .font(SPFont.mono(10, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(1.4)
                .frame(maxWidth: .infinity)
        }
    }

    private var moodMatrixScaleHints: some View {
        HStack(spacing: SPSpacing.s2) {
            Text("")
                .frame(width: 56)
            ForEach(0..<2, id: \.self) { _ in
                HStack {
                    Text("low")
                    Spacer()
                    Text("high")
                }
                .font(SPFont.mono(9))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func moodMatrixRow(for key: MoodKey) -> some View {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        return HStack(spacing: SPSpacing.s2) {
            Text(key.label.uppercased())
                .font(SPFont.mono(10, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(1)
                .frame(width: 56, alignment: .trailing)

            moodMatrixTapRow(
                moodKey: key,
                column: .before,
                selected: entry.before,
                disabled: isSavingMoodMatrix || isReturning
            )
            .frame(maxWidth: .infinity)

            moodMatrixTapRow(
                moodKey: key,
                column: .after,
                selected: entry.after,
                disabled: isSavingMoodMatrix || isReturning
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func moodMatrixTapRow(
        moodKey: MoodKey,
        column: MoodMatrixColumn,
        selected: Int?,
        disabled: Bool
    ) -> some View {
        HStack(spacing: 4) {
            ForEach(1...5, id: \.self) { level in
                Button {
                    toggleMoodCell(key: moodKey, column: column, level: level)
                } label: {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(moodBoxFill(selected: selected == level, level: level))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(
                                    selected == level ? SPColor.greenBorderSubtle : SPColor.border2,
                                    lineWidth: 1
                                )
                        )
                        .overlay {
                            if selected == level {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(SPColor.green.opacity(0.35 + Double(level) * 0.12))
                                    .frame(width: 10, height: 10)
                            }
                        }
                        .frame(width: 28, height: 28)
                }
                .disabled(disabled)
                .accessibilityIdentifier(moodMatrixAccessibilityId(moodKey: moodKey, column: column, level: level))
            }
        }
    }

    private func moodBoxFill(selected: Bool, level: Int) -> Color {
        if selected {
            return SPColor.green.opacity(0.08 + Double(level) * 0.07)
        }
        return Color(SPColor.surface1)
    }

    private func moodMatrixAccessibilityId(moodKey: MoodKey, column: MoodMatrixColumn, level: Int) -> String {
        let side = column == .before ? "before" : "after"
        return "completion.moodMatrix.\(moodKey.rawValue).\(side).\(level)"
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
        guard !sessionId.isEmpty, !isSavingMoodMatrix else { return }
        guard MoodMatrixLogic.isTouched(moodMatrix) else { return }
        let key = moodSaveKey
        guard key != lastSavedMoodKey else {
            moodMatrixSaved = true
            return
        }
        isSavingMoodMatrix = true
        moodMatrixSaveError = nil
        let patch = MoodMatrixPatch(from: moodMatrix)
        do {
            _ = try await APIClient.shared.updateSessionMoodMatrix(sessionId: sessionId, patch: patch)
            isSavingMoodMatrix = false
            lastSavedMoodKey = key
            moodMatrixSaved = true
        } catch is CancellationError {
            isSavingMoodMatrix = false
        } catch let error as APIError {
            isSavingMoodMatrix = false
            moodMatrixSaveError = moodMatrixErrorMessage(for: error.status)
        } catch {
            isSavingMoodMatrix = false
            moodMatrixSaveError = "Unable to save mood — please try again"
        }
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

    @MainActor
    private func loadPersistedSessionData() async {
        guard !sessionId.isEmpty else { return }
        moodMatrix = [:]
        moodMatrixSaved = false
        moodMatrixSaveError = nil
        do {
            let (session, _) = try await APIClient.shared.getSessionBySessionId(sessionId)
            if let stored = session.moodMatrix {
                moodMatrix = MoodMatrixLogic.sanitizedStored(stored)
            }
        } catch {
            // Non-blocking: recap still works when reload fails.
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

    private func saveEndNote() async {
        let noteToSave = trimmedEndNote
        guard !noteToSave.isEmpty, !sessionId.isEmpty, !isSaving else { return }
        guard noteToSave != lastSavedNote else {
            noteSaved = true
            return
        }
        guard let ownerUserId = appVM.currentUser?.id else { return }
        isSaving = true
        saveError = nil
        do {
            try await SessionSyncCoordinator.shared.appendEndNote(
                clientSessionId: clientSessionId,
                ownerUserId: ownerUserId,
                note: noteToSave
            )
            isSaving = false
            lastSavedNote = noteToSave
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
                lastSavedNote = noteToSave
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

    private func scheduleNoteAutosave(for note: String) {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !sessionId.isEmpty, trimmed != lastSavedNote else { return }
        noteAutosaveTask?.cancel()
        noteAutosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled,
                  endNote == note,
                  !isSaving else { return }
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
        ratingsAutosaveTask?.cancel()
        moodAutosaveTask?.cancel()
        while isSaving || isSavingRatings || isSavingMoodMatrix {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        await saveEndNote()
        await saveRatings()
        await saveMoodMatrix()
        guard saveError == nil, ratingsSaveError == nil, moodMatrixSaveError == nil else {
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
