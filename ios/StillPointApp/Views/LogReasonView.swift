import SwiftUI
import StillPointShared

private let maxReasonLength = 1000

@MainActor
@Observable
private final class LogReasonViewModel {
    var text = ""
    var loadingExisting = true
    var hadExisting = false
    var submitting = false
    var errorMessage: String?
    var saved = false

    private var submittingInFlight = false
    private var activeDate = ""

    func resetForDate(_ date: String) {
        activeDate = date
        saved = false
        errorMessage = nil
        text = ""
        hadExisting = false
        submittingInFlight = false
        submitting = false
        loadingExisting = true
    }

    func loadExisting(date: String) async {
        resetForDate(date)
        do {
            let lookup = try await APIClient.shared.getFailureReason(date: date)
            guard activeDate == date else { return }
            if let existing = lookup.failureReason {
                text = existing.text
                hadExisting = true
            }
        } catch {
            // Non-fatal: fall back to an empty field.
        }
        if activeDate == date {
            loadingExisting = false
        }
    }

    func submit(date: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !submittingInFlight else { return }

        let maxAllowedDate = WidgetData.localDayString(Date())
        guard date <= maxAllowedDate else {
            errorMessage = "You can only log a reason for today or earlier."
            return
        }

        submittingInFlight = true
        submitting = true
        errorMessage = nil
        defer {
            if activeDate == date {
                submittingInFlight = false
                submitting = false
            }
        }

        do {
            _ = try await APIClient.shared.submitFailureReason(
                SubmitFailureReasonRequest(reasonDate: date, text: trimmed)
            )
            guard activeDate == date else { return }
            saved = true
        } catch let apiError as APIError {
            guard activeDate == date else { return }
            errorMessage = apiError.message
        } catch {
            guard activeDate == date else { return }
            errorMessage = "Could not save your note. Please try again."
        }
    }
}

struct LogReasonView: View {
    let appVM: AppViewModel
    let targetDate: String

    @State private var vm = LogReasonViewModel()

    private var today: String { WidgetData.localDayString(Date()) }
    private var yesterday: String { SessionCalendar.addDays(toIsoDate: today, deltaDays: -1) }
    private var isYesterday: Bool { targetDate == yesterday }
    private var dayLabel: String {
        if isYesterday { return "yesterday" }
        if targetDate == today { return "today" }
        return "that day"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SPSpacing.s3) {
                HStack {
                    Button {
                        Task { await appVM.returnHome() }
                    } label: {
                        Text("Back to home")
                            .font(SPFont.mono(11, weight: .medium))
                            .tracking(2)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("logReason.backButton")
                    Spacer()
                }

                if vm.saved {
                    savedContent
                } else {
                    formContent
                }
            }
            .padding(SPSpacing.s3)
        }
        .stillPointBackground()
        .navigationTitle("A gentle check-in")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: targetDate) {
            await vm.loadExisting(date: targetDate)
        }
    }

    @ViewBuilder
    private var savedContent: some View {
        Text("Thanks for logging. Every day is a fresh start.")
            .font(SPFont.serif(20, weight: .light))
            .italic()
            .foregroundStyle(Color(SPColor.fg))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)

        if isYesterday {
            Button {
                appVM.openLogReason(date: today)
            } label: {
                Text("Now: why not today?")
                    .font(SPFont.mono(12, weight: .medium))
                    .spCapsuleButtonStyle(.green, size: .regular)
            }
            .accessibilityIdentifier("logReason.logTodayButton")

            Button {
                appVM.beginSession(type: .quick)
            } label: {
                Text("Or start a quick 60-second session")
                    .font(SPFont.mono(11, weight: .medium))
                    .tracking(2)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("logReason.quickSessionButton")
        } else {
            Button {
                appVM.beginSession(type: .quick)
            } label: {
                Text("Start a quick 60-second session")
                    .font(SPFont.mono(12, weight: .medium))
                    .spCapsuleButtonStyle(.green, size: .regular)
            }
            .accessibilityIdentifier("logReason.quickSessionButton")

            Button {
                Task { await appVM.returnHome() }
            } label: {
                Text("Back to home")
                    .font(SPFont.mono(11, weight: .medium))
                    .tracking(2)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("logReason.homeButton")
        }
    }

    @ViewBuilder
    private var formContent: some View {
        Text("Why couldn't you meditate \(dayLabel)?")
            .font(SPFont.serif(20, weight: .light))
            .italic()
            .foregroundStyle(Color(SPColor.fg))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("logReason.prompt")

        Text("No judgment — even a sentence helps you notice the patterns that get in the way.")
            .font(SPFont.serif(14, weight: .light))
            .italic()
            .foregroundStyle(Color(SPColor.fg3))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)

        TextEditor(text: $vm.text)
            .font(SPFont.serif(16, weight: .light))
            .foregroundStyle(Color(SPColor.fg))
            .frame(minHeight: 110)
            .padding(SPSpacing.s2)
            .background(SPColor.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .disabled(vm.loadingExisting || vm.submitting)
            .accessibilityIdentifier("logReason.textField")
            .onChange(of: vm.text) { _, newValue in
                if newValue.count > maxReasonLength {
                    vm.text = String(newValue.prefix(maxReasonLength))
                }
            }

        HStack(spacing: SPSpacing.s2) {
            if vm.hadExisting {
                Text("Updating your earlier note for this day.")
                    .font(SPFont.mono(11))
                    .foregroundStyle(Color(SPColor.fg4))
            }
            Spacer()
            Text("\(vm.text.count)/\(maxReasonLength)")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg4))
        }

        if let error = vm.errorMessage {
            Text(error)
                .font(SPFont.mono(11))
                .foregroundStyle(SPColor.dangerMuted)
                .accessibilityIdentifier("logReason.error")
        }

        Button {
            Task { await vm.submit(date: targetDate) }
        } label: {
            Text(vm.submitting ? "Saving…" : "Save note")
                .font(SPFont.mono(12, weight: .medium))
                .spCapsuleButtonStyle(.green, size: .regular)
        }
        .disabled(
            vm.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || vm.submitting
                || vm.loadingExisting
        )
        .accessibilityIdentifier("logReason.saveButton")
    }
}
