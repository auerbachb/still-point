import SwiftUI
import StillPointShared

struct BuddySessionContainerView: View {
    let appVM: AppViewModel
    let sessionId: String

    @State private var vm: BuddySessionViewModel
    @State private var didExitWithoutSaving = false

    init(appVM: AppViewModel, sessionId: String) {
        self.appVM = appVM
        self.sessionId = sessionId
        _vm = State(initialValue: BuddySessionViewModel(
            sessionId: sessionId,
            currentUserId: appVM.currentUser?.id ?? ""
        ))
    }

    var body: some View {
        Group {
            if let pollError = vm.pollError, vm.snapshot == nil {
                failureStateView(message: pollError)
            } else if vm.isLoading && vm.snapshot == nil {
                loadingStateView
            } else if let snapshot = vm.snapshot {
                switch snapshot.state {
                case "waiting", "ready_check":
                    BuddyWaitingRoomView(vm: vm) {
                        appVM.leaveBuddySession()
                    }
                case "active":
                    BuddyActiveSessionView(
                        vm: vm,
                        snapshot: snapshot,
                        onLeave: {
                            appVM.leaveBuddySession()
                        }
                    )
                case "completed":
                    completionStateView
                case "abandoned":
                    terminalStateView(message: "The host ended this shared session.")
                default:
                    terminalStateView(message: "This session is no longer available.")
                }
            } else {
                failureStateView(message: "Session could not be loaded.")
            }
        }
        .stillPointBackground()
        .task {
            vm.startPolling()
            await saveCompletionIfPossible()
        }
        .onDisappear {
            vm.stopPolling()
        }
        .onChange(of: vm.snapshot?.state) { _, newState in
            guard newState == "completed" else { return }
            Task { await saveCompletionIfPossible() }
        }
    }

    private var completionStateView: some View {
        VStack(spacing: SPSpacing.s4) {
            if vm.isSavingCompletion {
                ProgressView("Saving your personal session…")
                    .tint(Color(SPColor.fg2))
                    .font(SPFont.mono(12))
            } else {
                Text("Time is complete")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))

                if let error = vm.completionSaveError {
                    Text(error)
                        .font(SPFont.mono(12))
                        .foregroundStyle(SPColor.dangerMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)

                    Button("Try again") {
                        Task {
                            await saveCompletionIfPossible()
                        }
                    }
                    .font(SPFont.serifItalic(17, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                } else {
                    Text("Saving your personal session...")
                        .font(SPFont.mono(12))
                        .foregroundStyle(Color(SPColor.fg3))
                }
            }

            Button("Return home without saving") {
                guard !vm.isSavingCompletion else { return }
                Task {
                    let didLeave = await vm.leaveSession()
                    if didLeave {
                        didExitWithoutSaving = true
                        appVM.leaveBuddySession()
                    }
                }
            }
            .font(SPFont.mono(12, weight: .medium))
            .foregroundStyle(Color(SPColor.fg3))
            .disabled(vm.isSavingCompletion)
        }
        .padding(.horizontal, SPSpacing.s4)
        .padding(.top, SPSpacing.s6)
    }

    private func terminalStateView(message: String) -> some View {
        VStack(spacing: SPSpacing.s3) {
            Text(message)
                .font(SPFont.serif(16, weight: .light))
                .foregroundStyle(Color(SPColor.fg2))
                .multilineTextAlignment(.center)
            Button("Return home") {
                appVM.leaveBuddySession()
            }
            .font(SPFont.mono(12, weight: .medium))
            .foregroundStyle(Color(SPColor.fg3))
        }
        .padding(.horizontal, SPSpacing.s4)
        .padding(.top, SPSpacing.s6)
    }

    private func failureStateView(message: String) -> some View {
        VStack(spacing: SPSpacing.s3) {
            Text(message)
                .font(SPFont.mono(12))
                .foregroundStyle(Color(SPColor.fg2))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SPSpacing.s4)
            Button("Back") {
                appVM.leaveBuddySession()
            }
            .font(SPFont.mono(12, weight: .medium))
            .foregroundStyle(Color(SPColor.fg3))
        }
        .padding(.top, SPSpacing.s6)
    }

    private var loadingStateView: some View {
        VStack(spacing: SPSpacing.s3) {
            ProgressView("Loading session...")
                .tint(Color(SPColor.fg2))
                .font(SPFont.mono(12))
        }
        .padding(.top, SPSpacing.s6)
    }

    private func saveCompletionIfPossible() async {
        guard vm.snapshot?.state == "completed", !vm.isSavingCompletion else { return }
        guard !didExitWithoutSaving else { return }
        guard let saved = await vm.savePersonalSession() else { return }
        guard !didExitWithoutSaving else { return }
        appVM.completeSession(
            sessionId: saved.id,
            clearPercent: saved.clearPercent,
            thoughtCount: saved.thoughtCount,
            thoughts: vm.capturedThoughts,
            dayNumber: saved.dayNumber,
            duration: saved.duration
        )
    }
}
