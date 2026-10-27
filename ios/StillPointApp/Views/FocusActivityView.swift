import SwiftUI
import StillPointShared

// Mirrors BreathCountingView.swift for the idle-timer and notification-suppression
// wiring, and web `FocusActivityView.tsx` for the screen (#840).

/// A full-screen countdown to the focus goal. It runs silently: no tick, minute
/// chime, voice countdown or interval buzz, because a focus session is for
/// reading, writing or listening. Only a countdown that runs out is announced,
/// through the person's own completion-sound and haptic settings.
struct FocusActivityView: View {
    let appVM: AppViewModel
    let category: FocusCategory
    /// The goal counter the session started on, from its route.
    let focusActivityDay: Int
    @State private var vm: FocusActivityViewModel

    init(appVM: AppViewModel, category: FocusCategory, focusActivityDay: Int) {
        self.appVM = appVM
        self.category = category
        self.focusActivityDay = focusActivityDay
        _vm = State(initialValue: FocusActivityViewModel(goalSeconds: StillPoint.focusDuration(forDay: focusActivityDay)))
    }

    var body: some View {
        ZStack {
            SPColor.bg
                .ignoresSafeArea()

            VStack(spacing: SPSpacing.s4) {
                Text(vm.countdownDisplay)
                    // An hour-plus goal starts with an hour field, three characters
                    // wider, so it gets smaller digits for the whole session.
                    .font(SPFont.mono(vm.countdownShowsHours ? 64 : 80, weight: .ultraLight))
                    .foregroundStyle(vm.reachedGoal ? SPColor.green : Color(SPColor.fg))
                    .shadow(color: vm.reachedGoal ? SPColor.green.opacity(0.35) : .clear, radius: 24)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .contentTransition(.numericText(countsDown: true))
                    .animation(.easeInOut(duration: 0.8), value: vm.reachedGoal)
                    .accessibilityIdentifier("focusActivity.countdown")
                    .accessibilityLabel("Focus time remaining")
                    .accessibilityValue(FocusActivity.spokenDuration(vm.remainingSeconds))
                    .accessibilityAddTraits(.updatesFrequently)

                Text("\(category.displayLabel) · \(FocusActivity.formatGoal(vm.goalSeconds))")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(2)
                    .textCase(.uppercase)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("focusActivity.goal")
                    .accessibilityLabel("\(category.displayLabel), \(FocusActivity.spokenDuration(vm.goalSeconds)) goal")
            }
            .padding(.horizontal, SPSpacing.s4)

            // End control: explicit, pinned to the bottom, as in breath counting.
            VStack {
                Spacer()
                Button {
                    vm.end()
                } label: {
                    Text("End")
                        .font(SPFont.mono(13, weight: .medium))
                        .spCapsuleButtonStyle(.neutral, size: .regular)
                }
                // The session has reported its end; the save is taking it home.
                .disabled(vm.hasEnded)
                .accessibilityIdentifier("focusActivity.endButton")
                .accessibilityLabel("End focus session")
                .padding(.bottom, SPSpacing.s5)
            }
        }
        .onAppear {
            vm.start { end in
                report(end)
            }
            syncSessionSideEffects(inProgress: vm.sessionInProgress)
        }
        .onDisappear {
            vm.stop()
            syncSessionSideEffects(inProgress: false)
        }
        .onChange(of: vm.sessionInProgress) { _, inProgress in
            syncSessionSideEffects(inProgress: inProgress)
        }
        .onChange(of: appVM.keepScreenAwakeDuringSession) { _, _ in
            syncSessionSideEffects(inProgress: vm.sessionInProgress)
        }
    }

    /// Hands the session's end to the save. Called in the same turn as the End tap
    /// or the tick that reached the goal.
    private func report(_ end: FocusSessionEnd) {
        // #854: read here, with the end. The task starts a turn later, when another
        // account may already be signed in.
        let generation = appVM.authGeneration
        // Also read here: the save task can run after local midnight, and the
        // session belongs to the day it ended on.
        let endedAt = Date()
        Task {
            await appVM.completeFocusSession(
                end,
                category: category,
                focusActivityDay: focusActivityDay,
                endedAt: endedAt,
                startedAtGeneration: generation
            )
        }
    }

    private func syncSessionSideEffects(inProgress: Bool) {
        SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: inProgress)
        SessionNotificationSuppressionController.syncLocalSession(
            appVM: appVM,
            inProgress: inProgress
        )
    }
}
