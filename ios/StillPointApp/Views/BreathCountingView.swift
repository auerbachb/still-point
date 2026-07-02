import SwiftUI
import StillPointShared

// Mirrors SessionView.swift for idle-timer wiring (~lines 109-154) and
// AppViewModel / BreathCountingViewModel integration patterns.

struct BreathCountingView: View {
    let appVM: AppViewModel
    @State private var vm = BreathCountingViewModel()

    var body: some View {
        ZStack {
            // Full-screen tap target — a tap anywhere (eyes-closed) registers a breath.
            SPColor.bg
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    vm.recordTap()
                }

            // Centered status. Non-interactive so taps on the labels (especially the
            // large timer) fall through to the tap target above rather than being
            // swallowed — otherwise center taps would never count.
            VStack(spacing: SPSpacing.s5) {
                Text(vm.elapsedDisplay)
                    .font(SPFont.timerDisplay)
                    .foregroundStyle(Color(SPColor.fg))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("breath.elapsedLabel")
                    .accessibilityLabel("Elapsed time \(vm.elapsedDisplay)")

                // Phase indicator: shows the next expected action.
                Text(vm.startedAt == nil ? "tap to begin" : (vm.phase == .inhale ? "in" : "out"))
                    .font(SPFont.mono(28, weight: .ultraLight))
                    .foregroundStyle(
                        vm.startedAt == nil
                            ? Color(SPColor.fg4)
                            : vm.phase == .inhale
                                ? SPColor.greenText
                                : Color(SPColor.fg3)
                    )
                    .tracking(4)
                    .animation(.easeInOut(duration: 0.2), value: vm.phase == .inhale)
                    .accessibilityIdentifier("breath.phaseLabel")

                if vm.breathCount > 0 {
                    Text("\(vm.breathCount) breath\(vm.breathCount == 1 ? "" : "s")")
                        .font(SPFont.mono(16, weight: .light))
                        .foregroundStyle(SPColor.greenText)
                        .tracking(2)
                        .accessibilityIdentifier("breath.countLabel")
                } else {
                    Text("tap each inhale and exhale")
                        .font(SPFont.mono(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(1)
                }
            }
            .padding(.horizontal, SPSpacing.s4)
            .allowsHitTesting(false)

            // End control — explicit, interactive, pinned to the bottom.
            VStack {
                Spacer()
                Button {
                    let result = vm.end()
                    Task {
                        await appVM.completeBreathSession(
                            elapsedSeconds: result.elapsed,
                            breathCount: result.breaths
                        )
                    }
                } label: {
                    Text("End")
                        .font(SPFont.mono(13, weight: .medium))
                        .spCapsuleButtonStyle(.neutral, size: .regular)
                }
                .accessibilityIdentifier("breath.endButton")
                .accessibilityLabel("End breath counting session")
                .padding(.bottom, SPSpacing.s5)
            }
        }
        .onAppear {
            // No session until the first tap; reflect actual running state.
            SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: vm.startedAt != nil)
        }
        .onDisappear {
            vm.stop()
            SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: false)
        }
        .onChange(of: vm.startedAt) { _, _ in
            // The session starts on the first tap — keep the screen awake from then on.
            SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: vm.startedAt != nil)
        }
        .onChange(of: appVM.keepScreenAwakeDuringSession) { _, _ in
            // Re-sync when the preference toggles while on screen.
            SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: vm.startedAt != nil)
        }
    }
}
