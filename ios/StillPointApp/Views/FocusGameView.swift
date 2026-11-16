import SwiftUI
import StillPointShared

/// #1192: the grid-tap focus game, the iOS port of web `FocusGamesView.tsx` (#680).
/// A setup screen (duration, Start, Back), then a countdown over a three-column grid
/// where one square lights at a time. Tap the lit square within a second or the
/// countdown starts over. End saves the time played as a focus session under the
/// `game` category, and the game never touches meditation progression.
struct FocusGameView: View {
    private static let cellHeight: CGFloat = 44
    private static let gridGap: CGFloat = CGFloat(FocusGameLogic.gridGapPx)

    let appVM: AppViewModel
    /// The goal counter the game started on, from its route. Carried to the save.
    let focusActivityDay: Int
    @State private var vm = FocusGameViewModel()
    /// The space the view has for the grid; read at Start to fit the rows.
    @State private var viewportHeight = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            SPColor.bg
                .ignoresSafeArea()

            switch vm.phase {
            case .setup:
                setup
            case .playing:
                playing
            case .ended:
                finished
            }
        }
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear {
                        viewportHeight = Int(proxy.size.height)
                        // #1192: the UI-test launch flag starts the game at once.
                        if AppViewModel.uiTestStartsFocusGame(), vm.phase == .setup {
                            startGame()
                        }
                    }
                    .onChange(of: proxy.size.height) { _, height in viewportHeight = Int(height) }
            }
        )
        .onDisappear {
            vm.stop()
            appVM.focusGameInProgress = false
            syncSessionSideEffects(inProgress: false)
        }
        .onChange(of: vm.isPlaying) { _, playing in
            syncSessionSideEffects(inProgress: playing)
        }
        .onChange(of: appVM.keepScreenAwakeDuringSession) { _, _ in
            syncSessionSideEffects(inProgress: vm.isPlaying)
        }
    }

    // MARK: - Setup

    private var setup: some View {
        VStack(spacing: SPSpacing.s4) {
            Text("Focus game")
                .font(SPFont.serif(28, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .accessibilityIdentifier("focusGame.title")
                .accessibilityAddTraits(.isHeader)

            Text("Keep your eyes on the grid. When a square lights up, tap it within one second, or the countdown starts over.")
                .font(SPFont.mono(13))
                .foregroundStyle(Color(SPColor.fg3))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .frame(maxWidth: 320)

            HStack(spacing: SPSpacing.s2) {
                ForEach(FocusGameLogic.durationsSeconds, id: \.self) { seconds in
                    let selected = seconds == vm.durationSeconds
                    Button {
                        vm.durationSeconds = seconds
                    } label: {
                        Text("\(seconds / 60) min")
                            .font(SPFont.mono(13, weight: selected ? .medium : .regular))
                            .foregroundStyle(selected ? Color(SPColor.fg) : Color(SPColor.fg3))
                            .padding(.horizontal, SPSpacing.s3)
                            .frame(minHeight: Self.cellHeight)
                            .background(selected ? SPColor.surface2 : SPColor.surface1)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(selected ? SPColor.border2 : SPColor.border1))
                    }
                    .accessibilityIdentifier("focusGame.duration.\(seconds)")
                    .accessibilityLabel("\(seconds / 60) minutes")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }

            Button {
                startGame()
            } label: {
                Text("Start")
                    .font(SPFont.mono(13, weight: .medium))
                    .spCapsuleButtonStyle(.neutral, size: .regular)
            }
            .accessibilityIdentifier("focusGame.startButton")
            .accessibilityLabel("Start focus game")

            Button {
                withAnimation {
                    appVM.cancelFocusGame()
                }
            } label: {
                Text("Back")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg3))
                    .frame(minHeight: Self.cellHeight)
            }
            .accessibilityIdentifier("focusGame.backButton")
            .padding(.top, SPSpacing.s3)
        }
        .padding(.horizontal, SPSpacing.s4)
    }

    /// Shown from End until the save routes home, so the screen is never blank while
    /// the save settles. A failed save routes home like the focus timer's; the offline
    /// indicator carries the failure.
    private var finished: some View {
        VStack(spacing: SPSpacing.s4) {
            Text("Finished")
                .font(SPFont.serif(28, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .accessibilityIdentifier("focusGame.finished")
                .accessibilityAddTraits(.isHeader)
            ProgressView()
                .accessibilityLabel("Saving focus game")
                .accessibilityIdentifier("focusGame.saving")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("focusGame.ended")
    }

    /// Starts the game. The session is held from this instant, so a buddy invite that
    /// lands on Start is held back rather than shown over the countdown.
    private func startGame() {
        appVM.focusGameInProgress = true
        vm.start(viewportHeight: viewportHeight, onEnd: report)
    }

    // MARK: - Playing

    private var playing: some View {
        let remaining = vm.remainingSeconds
        let game = vm.game
        return VStack(spacing: SPSpacing.s4) {
            ScrollView {
                VStack(spacing: SPSpacing.s4) {
                    Text(FocusActivity.countdownDisplay(remaining))
                        .font(SPFont.mono(80, weight: .ultraLight))
                        .foregroundStyle(Color(SPColor.fg))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .contentTransition(.numericText(countsDown: true))
                        .accessibilityIdentifier("focusGame.countdown")
                        .accessibilityLabel("Time remaining")
                        .accessibilityValue(FocusActivity.spokenDuration(remaining))
                        .accessibilityAddTraits(.updatesFrequently)

                    Text(statusLine(game))
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg3))
                        .frame(minHeight: 20)
                        .accessibilityIdentifier("focusGame.status")

                    grid
                }
                .frame(maxWidth: .infinity)
                .padding(.top, SPSpacing.s4)
            }
            .scrollBounceBehavior(.basedOnSize)

            // Pinned outside the scroll area: End is always reachable.
            Button {
                vm.endPressed()
            } label: {
                Text("End")
                    .font(SPFont.mono(13, weight: .medium))
                    .spCapsuleButtonStyle(.neutral, size: .regular)
            }
            .disabled(vm.phase != .playing)
            .accessibilityIdentifier("focusGame.endButton")
            .accessibilityLabel("End focus game")
            .padding(.bottom, SPSpacing.s5)
        }
    }

    private func statusLine(_ game: FocusGameLogic.State?) -> String {
        if vm.showsResetNotice {
            return "Missed it. The countdown started over."
        }
        let hits = game?.hits ?? 0
        let streak = game?.streak ?? 0
        return "\(hits) hit\(hits == 1 ? "" : "s") · streak \(streak)"
    }

    private var grid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: Self.gridGap), count: FocusGameLogic.columns)
        return LazyVGrid(columns: columns, spacing: Self.gridGap) {
            ForEach(0..<vm.cellCount, id: \.self) { cell in
                gridCell(cell)
            }
        }
        .frame(maxWidth: 300)
        .padding(.horizontal, SPSpacing.s4)
        .accessibilityIdentifier("focusGame.grid")
    }

    private func gridCell(_ cell: Int) -> some View {
        let lit = vm.game?.lit?.cell == cell
        let flash = vm.flashCell(cell)
        return Button {
            vm.tap(cell)
        } label: {
            RoundedRectangle(cornerRadius: 10)
                .fill(fill(lit: lit, flash: flash))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(lit ? SPColor.greenText : SPColor.border1)
                )
                .shadow(color: lit && !reduceMotion ? SPColor.greenText.opacity(0.6) : .clear, radius: 12)
                .frame(maxWidth: .infinity, minHeight: Self.cellHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("focusGame.cell.\(cell)")
        .accessibilityLabel(lit ? "Lit square: tap it" : "Square")
        .accessibilityAddTraits(lit ? .isSelected : [])
    }

    private func fill(lit: Bool, flash: FocusGameViewModel.Flash.Kind?) -> Color {
        switch flash {
        case .hit?: return SPColor.greenText
        case .wrong?: return SPColor.surface2
        case nil: return lit ? SPColor.greenText : SPColor.surface1
        }
    }

    // MARK: - End and save

    /// Hands the game's end to the save. Called in the same turn as the End tap, or the
    /// tick that found the countdown run out.
    private func report(_ result: FocusSessionResult?) {
        // #854: read here, with the end; the save task runs a turn later.
        let generation = appVM.authGeneration
        let endedAt = Date()
        let end: FocusSessionEnd = result.map { .save($0) } ?? .nothingToSave
        Task {
            // The session stays held until the save settles: a buddy invite queued
            // meanwhile must not replace the route the save is about to leave. Cleared
            // on every path, success, failure, nothing-to-save and a stale generation,
            // since `completeFocusSession` returns on all of them.
            await appVM.completeFocusSession(
                end,
                category: .game,
                focusActivityDay: focusActivityDay,
                endedAt: endedAt,
                startedAtGeneration: generation
            )
            appVM.focusGameInProgress = false
            // Retry an invite that waited on the flag. The save already routed home.
            appVM.scheduleBuddyInviteConsume()
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
