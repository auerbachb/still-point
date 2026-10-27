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

    // Session environment photo (optional, local-only MVP)
    @State private var capturedPhoto: UIImage?
    @State private var showPhotoPicker = false

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

    private enum MoodMatrixColumn {
        case before
        case after
    }

    /// #792: the id the mood is loaded from and sent against. Nil until the
    /// queue says the sit has a server row: a pending sit's `sessionId` is its
    /// provisional client id, and every PATCH against it fails.
    private var detailSessionId: String? {
        queueState?.detailSessionId(handedSessionId: sessionId)
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

                // Mood shift (#472 / #635). #792: hidden while the sit is
                // pending sync, as on web — there is no server row to attach
                // it to, so "save and return to home" leaves on the first tap.
                if detailSessionId != nil {
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
            await resolveQueueState()
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

    // MARK: - Mood Matrix Section (#472 / #635)

    /// #885: the column-header, scale-hint and mood rows share one label width
    /// and one spacing so their columns line up. #911: the headers, hints and
    /// cell groups also share one scale width, so they line up in the stacked
    /// layout too. The widths come from `MoodMatrixGeometry`, whose tests pin
    /// which iPhones get which layout.
    private enum MoodMatrixLayout {
        static let labelWidth = CGFloat(MoodMatrixGeometry.labelWidth)
        static let rowSpacing = CGFloat(MoodMatrixGeometry.columnSpacing)
        static let boxSpacing = CGFloat(MoodMatrixGeometry.cellSpacing)
        static let cellSize = CGFloat(MoodMatrixGeometry.cellSize)
        static let scaleWidth = CGFloat(MoodMatrixGeometry.scaleWidth)
        static let phaseLabelWidth = CGFloat(MoodMatrixGeometry.phaseLabelWidth)
        /// Between a stacked mood's label, its BEFORE row and its AFTER row.
        static let stackedRowSpacing: CGFloat = 4
    }

    @ViewBuilder
    private var moodMatrixSection: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("MOOD SHIFT")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            // #911: a wide row needs 388pt, more than the 327pt column of a
            // 375pt iPhone. Where it does not fit, each mood stacks BEFORE above
            // AFTER instead. Only one layout is shown, so the cell identifiers
            // stay unique.
            ViewThatFits(in: .horizontal) {
                moodMatrixWideGrid
                moodMatrixStackedGrid
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

    /// BEFORE and AFTER side by side, each mood on one row.
    private var moodMatrixWideGrid: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            moodMatrixColumnHeaders
            moodMatrixScaleHints

            VStack(spacing: SPSpacing.s2) {
                ForEach(MoodKey.allCases, id: \.self) { key in
                    moodMatrixRow(for: key)
                }
            }
        }
    }

    /// #911: one low/high hint row, then each mood's label on a line of its
    /// own, followed by a BEFORE row and an AFTER row. Centered in the
    /// section, as on web.
    private var moodMatrixStackedGrid: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            HStack(spacing: MoodMatrixLayout.rowSpacing) {
                Text("")
                    .frame(width: MoodMatrixLayout.phaseLabelWidth)
                moodMatrixScaleHint
            }

            ForEach(MoodKey.allCases, id: \.self) { key in
                moodMatrixStackedBlock(for: key)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var moodMatrixColumnHeaders: some View {
        HStack(spacing: MoodMatrixLayout.rowSpacing) {
            Text("")
                .frame(width: MoodMatrixLayout.labelWidth, alignment: .trailing)
            moodMatrixSideLabel(.before)
                .frame(width: MoodMatrixLayout.scaleWidth)
                .frame(maxWidth: .infinity)
            moodMatrixSideLabel(.after)
                .frame(width: MoodMatrixLayout.scaleWidth)
                .frame(maxWidth: .infinity)
        }
    }

    private var moodMatrixScaleHints: some View {
        HStack(spacing: MoodMatrixLayout.rowSpacing) {
            Text("")
                .frame(width: MoodMatrixLayout.labelWidth)
            ForEach(0..<2, id: \.self) { _ in
                moodMatrixScaleHint
                    .frame(maxWidth: .infinity)
            }
        }
    }

    /// Low/high ends of the scale, one scale wide so each end sits over the
    /// first or the fifth cell.
    private var moodMatrixScaleHint: some View {
        HStack {
            Text("low")
            Spacer()
            Text("high")
        }
        .font(SPFont.mono(9))
        .foregroundStyle(Color(SPColor.fg4))
        .frame(width: MoodMatrixLayout.scaleWidth)
    }

    /// The BEFORE / AFTER column headers, and the stacked layout's row labels.
    private func moodMatrixSideLabel(_ column: MoodMatrixColumn) -> some View {
        Text(column == .before ? "BEFORE" : "AFTER")
            .font(SPFont.mono(10, weight: .medium))
            .foregroundStyle(Color(SPColor.fg4))
            .tracking(1.4)
            .lineLimit(1)
    }

    private func moodMatrixMoodLabel(_ key: MoodKey) -> some View {
        Text(key.label.uppercased())
            .font(SPFont.mono(10, weight: .medium))
            .foregroundStyle(Color(SPColor.fg3))
            .tracking(1)
            .lineLimit(1)
    }

    private var moodMatrixCellsDisabled: Bool {
        isSavingMoodMatrix || isReturning || !moodLoaded
    }

    private func moodMatrixRow(for key: MoodKey) -> some View {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        return HStack(spacing: MoodMatrixLayout.rowSpacing) {
            moodMatrixMoodLabel(key)
                .frame(width: MoodMatrixLayout.labelWidth, alignment: .trailing)

            moodMatrixTapRow(
                moodKey: key,
                column: .before,
                selected: entry.before,
                disabled: moodMatrixCellsDisabled
            )
            .frame(maxWidth: .infinity)

            moodMatrixTapRow(
                moodKey: key,
                column: .after,
                selected: entry.after,
                disabled: moodMatrixCellsDisabled
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func moodMatrixStackedBlock(for key: MoodKey) -> some View {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        return VStack(alignment: .leading, spacing: MoodMatrixLayout.stackedRowSpacing) {
            moodMatrixMoodLabel(key)

            ForEach([MoodMatrixColumn.before, .after], id: \.self) { column in
                HStack(spacing: MoodMatrixLayout.rowSpacing) {
                    moodMatrixSideLabel(column)
                        .frame(width: MoodMatrixLayout.phaseLabelWidth, alignment: .trailing)

                    moodMatrixTapRow(
                        moodKey: key,
                        column: column,
                        selected: column == .before ? entry.before : entry.after,
                        disabled: moodMatrixCellsDisabled
                    )
                }
            }
        }
    }

    private func moodMatrixTapRow(
        moodKey: MoodKey,
        column: MoodMatrixColumn,
        selected: Int?,
        disabled: Bool
    ) -> some View {
        HStack(spacing: MoodMatrixLayout.boxSpacing) {
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
                        .frame(width: MoodMatrixLayout.cellSize, height: MoodMatrixLayout.cellSize)
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
