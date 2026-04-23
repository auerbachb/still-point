import SwiftUI
import StillPointShared

struct CompletionView: View {
    let appVM: AppViewModel
    let sessionId: String
    let clearPercent: Int
    let thoughtCount: Int
    let thoughts: [CapturedThought]
    let dayNumber: Int
    let duration: Int

    @State private var endNote = ""
    @State private var noteSaved = false
    @State private var isSaving = false
    @State private var saveError: String?

    private var nextDay: Int { dayNumber + 1 }
    private var nextDuration: Int { StillPoint.duration(forDay: nextDay) }
    private var nextBlocks: Int { StillPoint.blockCount(forDuration: nextDuration) }
    private var isSaveDisabled: Bool { endNote.isEmpty || noteSaved || isSaving || sessionId.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Spacer().frame(height: SPSpacing.s4)

                // Header
                VStack(spacing: SPSpacing.s2) {
                    Text("Day \(dayNumber) Complete")
                        .font(SPFont.serifItalic(32, weight: .light))
                        .foregroundStyle(Color(SPColor.fg))

                    Text("\(duration) seconds of sustained attention")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(1)
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

                    if noteSaved {
                        Text("Saved")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.green)
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
                            .foregroundStyle(isSaveDisabled ? Color(SPColor.fg3) : Color(SPColor.bg))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SPSpacing.s2)
                            .background(isSaveDisabled ? SPColor.surface2 : SPColor.green)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule().stroke(isSaveDisabled ? SPColor.border2 : Color.clear)
                            )
                        }
                        .disabled(isSaveDisabled)
                    }

                    if let saveError {
                        Text(saveError)
                            .font(SPFont.mono(11))
                            .foregroundStyle(SPColor.dangerMuted)
                    }
                }

                // Tomorrow preview
                VStack(spacing: SPSpacing.s1) {
                    Text("TOMORROW")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    Text("\(nextDuration)s · \(nextBlocks) blocks")
                        .font(SPFont.mono(14, weight: .light))
                        .foregroundStyle(Color(SPColor.fg3))
                }

                // Return button
                Button {
                    Task { await appVM.returnHome() }
                } label: {
                    Text("Return")
                        .font(SPFont.serifItalic(18, weight: .light))
                        .foregroundStyle(Color(SPColor.fg))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface2)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border2))
                }

                Spacer().frame(height: SPSpacing.s4)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .onChange(of: endNote) { _, _ in
            saveError = nil
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
                _ = try await APIClient.shared.batchThoughts(request)
                isSaving = false
                noteSaved = true
            } catch {
                print("Failed to save end note: \(error)")
                isSaving = false
                saveError = "Failed to save note"
            }
        }
    }
}
