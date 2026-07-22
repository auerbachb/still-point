import SwiftUI
import StillPointShared

// Mirrors SessionView.swift for idle-timer wiring (~lines 109-154) and
// AppViewModel / BreathCountingViewModel integration patterns.

struct BreathCountingView: View {
    let appVM: AppViewModel
    @State private var vm = BreathCountingViewModel()
    // iPad external-keyboard support (#529): tracks whether the full-screen breath
    // surface holds keyboard focus. True on appear; becomes false when the user Tabs
    // to the End button, at which point Space/Right Arrow activates End normally
    // instead of recording a breath — mirrors web's `event.target` guard (#460).
    @FocusState private var breathSurfaceFocused: Bool

    var body: some View {
        ZStack {
            // Full-screen tap target — a tap anywhere (eyes-closed) registers a breath.
            // On iPad with an external keyboard, Space and Right Arrow also register a
            // breath (parity with web breathKeyBinding.ts, PR #460). `phases: .down`
            // suppresses auto-repeat so a held key counts exactly once, matching the
            // web's `event.repeat` guard. The handler only fires when this surface has
            // focus; when the user Tabs to End, the End button receives Space instead.
            SPColor.bg
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .focusable()
                .focusEffectDisabled()
                .focused($breathSurfaceFocused)
                .onTapGesture {
                    vm.recordTap()
                }
                .onKeyPress(keys: [.space, .rightArrow], phases: .down) { _ in
                    vm.recordTap()
                    return .handled
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
            // Claim keyboard focus so hardware-key input works immediately on iPad
            // without requiring the user to tap first.
            breathSurfaceFocused = true
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

    private func syncSessionSideEffects(inProgress: Bool) {
        SessionIdleTimerController.syncLocalSession(appVM: appVM, isRunning: inProgress)
        SessionNotificationSuppressionController.syncLocalSession(
            appVM: appVM,
            inProgress: inProgress
        )
    }
}
