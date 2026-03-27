import SwiftUI
import StillPointShared

struct SessionView: View {
    let appVM: AppViewModel
    @State private var vm: SessionViewModel

    init(appVM: AppViewModel) {
        self.appVM = appVM
        self._vm = State(initialValue: SessionViewModel(dayNumber: appVM.currentDay))
    }

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: SPSpacing.s5) {
                    Spacer().frame(height: SPSpacing.s3)

                    // Timer display
                    Text(vm.timeString)
                        .font(SPFont.timerDisplay)
                        .foregroundStyle(
                            vm.isComplete ? SPColor.green : Color(SPColor.fg)
                        )
                        .monospacedDigit()
                        .contentTransition(.numericText())

                    // 60-second progress bar
                    progressBar

                    // Block grid
                    BlockGridView(
                        blocks: vm.blocks,
                        elapsed: vm.elapsed,
                        totalSeconds: vm.totalSeconds
                    )
                    .padding(.horizontal, SPSpacing.s2)

                    // Mind state bar
                    MindStateBarView(
                        elapsed: vm.elapsed,
                        totalSeconds: vm.totalSeconds,
                        mindStateLog: vm.mindStateLog,
                        currentState: vm.mindState
                    )

                    // Status label
                    Text(vm.statusLabel.uppercased())
                        .font(SPFont.mono(14))
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(2)

                    Spacer().frame(height: SPSpacing.s3)
                }
            }
            .scrollIndicators(.hidden)

            // Controls overlay (auto-hide)
            VStack {
                Spacer()
                if vm.controlsVisible || !vm.isActive {
                    controlPanel
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.3), value: vm.controlsVisible)

            // Thought capture overlay
            if vm.showThoughtCapture {
                VStack {
                    Spacer()
                    ThoughtCaptureView(
                        onCapture: { text in
                            vm.captureThought(text)
                        },
                        onDismiss: {
                            vm.dismissThoughtCapture()
                        }
                    )
                    .padding(.horizontal, SPSpacing.s4)
                    .padding(.bottom, 160)
                }
                .transition(.opacity)
            }
        }
        .onTapGesture {
            vm.userInteracted()
        }
        .onAppear {
            vm.start()
        }
        .onChange(of: vm.isComplete) { _, isComplete in
            if isComplete {
                handleCompletion()
            }
        }
    }

    // MARK: - Progress Bar

    private var progressBar: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let progress: Double = {
                if vm.elapsed >= Double(vm.totalSeconds) { return 1.0 }
                return vm.elapsed.truncatingRemainder(dividingBy: 60) / 60.0
            }()

            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(SPColor.surface2)

                RoundedRectangle(cornerRadius: 4)
                    .fill(
                        vm.elapsed >= Double(vm.totalSeconds)
                            ? LinearGradient.greenHorizontal
                            : LinearGradient.amberHorizontal
                    )
                    .frame(width: width * progress)
                    .opacity(0.7)
            }
        }
        .frame(height: 8)
        .padding(.horizontal, SPSpacing.s5)
    }

    // MARK: - Control Panel

    private var controlPanel: some View {
        VStack(spacing: SPSpacing.s3) {
            // Mind state toggle
            Button {
                vm.toggleMindState()
            } label: {
                HStack(spacing: SPSpacing.s2) {
                    Circle()
                        .fill(vm.mindState == "clear" ? SPColor.green : SPColor.amber)
                        .frame(width: 8, height: 8)

                    Text(vm.mindState == "clear" ? "I'm thinking" : "Clear mind")
                        .font(SPFont.serifItalic(17))
                        .foregroundStyle(Color(SPColor.fg))

                    if vm.thoughtCount > 0 {
                        Text("\(vm.thoughtCount)")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(SPColor.amberText)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(SPColor.amberBgFaint)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, SPSpacing.s4)
                .padding(.vertical, SPSpacing.s2)
                .background(
                    vm.mindState == "clear"
                        ? SPColor.greenBgFaint
                        : SPColor.amberBgFaint
                )
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(
                        vm.mindState == "clear"
                            ? SPColor.greenBorderSubtle
                            : SPColor.amberBorderSubtle
                    )
                )
            }

            // Action buttons
            HStack(spacing: SPSpacing.s3) {
                // Pause / Resume
                Button {
                    if vm.isPaused {
                        vm.resume()
                    } else {
                        vm.pause()
                    }
                } label: {
                    Text(vm.isPaused ? "Resume" : "Pause")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border1))
                }

                // End Early
                Button {
                    let result = vm.endEarly()
                    Task {
                        _ = await vm.saveSession(completed: false)
                    }
                    appVM.completeSession(
                        clearPercent: result.clearPercent,
                        thoughtCount: result.thoughtCount,
                        thoughts: result.thoughts,
                        dayNumber: vm.dayNumber,
                        duration: vm.totalSeconds
                    )
                } label: {
                    Text("End Early")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border1))
                }

                // Abandon
                Button {
                    vm.abandon()
                    appVM.returnHome()
                } label: {
                    Text("Abandon")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(SPColor.dangerMuted)
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.dangerBorderSubtle))
                }
            }

            // Sound toggles
            HStack(spacing: SPSpacing.s3) {
                soundToggle("tick", isOn: vm.soundPrefs.tick) {
                    vm.toggleSound(\.tick)
                }
                soundToggle("chime", isOn: vm.soundPrefs.chime) {
                    vm.toggleSound(\.chime)
                }
                soundToggle("end", isOn: vm.soundPrefs.completion) {
                    vm.toggleSound(\.completion)
                }
            }
        }
        .padding(.horizontal, SPSpacing.s4)
        .padding(.vertical, SPSpacing.s3)
        .background(
            SPColor.bg.opacity(0.9)
                .background(.ultraThinMaterial)
        )
    }

    private func soundToggle(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: isOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 10))
                Text(label)
                    .font(SPFont.mono(10))
            }
            .foregroundStyle(isOn ? Color(SPColor.fg3) : Color(SPColor.fg4))
        }
    }

    // MARK: - Completion Handler

    private func handleCompletion() {
        Task {
            _ = await vm.saveSession(completed: true)
        }
        appVM.completeSession(
            clearPercent: vm.clearPercent,
            thoughtCount: vm.thoughtCount,
            thoughts: vm.capturedThoughts,
            dayNumber: vm.dayNumber,
            duration: vm.totalSeconds
        )
    }
}
