import SwiftUI
import StillPointShared
import UIKit

struct SessionView: View {
    /// Space reserved when both distraction hold bar and controls are visible (includes persistent Capture row).
    private static let bottomOverlayReserveWithControls: CGFloat = 324

    let appVM: AppViewModel
    @State private var vm: SessionViewModel
    @State private var showSaveError = false
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    init(appVM: AppViewModel, sessionType: SessionType = .standard) {
        self.appVM = appVM
        self._vm = State(initialValue: SessionViewModel(dayNumber: appVM.currentDay, sessionType: sessionType))
    }

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()

            GeometryReader { geo in
                let contentHeight = max(0, geo.size.height - bottomOverlayReserve)

                VStack(spacing: 0) {
                    // Main content — fits in viewport above controls
                    VStack(spacing: SPSpacing.s3) {
                        // Timer display
                        Text(vm.timeString)
                            .font(SPFont.timerDisplay)
                            .foregroundStyle(
                                vm.isComplete ? SPColor.green : Color(SPColor.fg)
                            )
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .accessibilityIdentifier("session.timerLabel")
                            .accessibilityLabel("Time remaining \(vm.timeString)")

                        // 60-second progress bar
                        progressBar

                        // Block grid — dynamic sizing to fill available space
                        BlockGridView(
                            blocks: vm.blocks,
                            elapsed: vm.elapsed,
                            totalSeconds: vm.totalSeconds,
                            availableHeight: contentHeight * 0.4,
                            availableWidth: geo.size.width - SPSpacing.s2 * 2
                        )
                        .padding(.horizontal, SPSpacing.s2)

                        // Mind state bar
                        MindStateBarView(
                            elapsed: vm.elapsed,
                            totalSeconds: vm.totalSeconds,
                            mindStateLog: vm.mindStateLog,
                            currentMindState: vm.mindState
                        )

                        // Status label
                        Text(vm.statusLabel.uppercased())
                            .font(SPFont.mono(14))
                            .foregroundStyle(Color(SPColor.fg3))
                            .tracking(2)
                    }
                    .frame(height: contentHeight)
                    .padding(.top, SPSpacing.s2)
                }
            }

            // Bottom chrome: hold tracking never collapses; secondary controls dim while running.
            VStack {
                Spacer()
                if sessionInProgress {
                    persistentDistractionBar
                }
                controlPanel
                    .opacity(secondaryChromeDimmed ? 0.32 : 1)
                    .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityIdentifier("session.secondaryChromeMarker")
                    .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
            }
            .animation(.easeInOut(duration: 0.3), value: vm.controlsVisible)

            // Thought capture after releasing a distraction hold
            if vm.showPostDistractionCapture {
                VStack {
                    Spacer()
                    ThoughtCaptureView(
                        onCapture: { text in
                            vm.captureThought(text)
                        },
                        onDismiss: {
                            vm.dismissPostDistractionCapture()
                        }
                    )
                    .padding(.horizontal, SPSpacing.s4)
                    .padding(.bottom, thoughtCaptureBottomPadding)
                }
                .transition(.opacity)
            }
        }
        .onTapGesture {
            vm.userInteracted()
        }
        .onAppear {
            vm.start()
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
        }
        .onDisappear {
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: false
            )
        }
        .onChange(of: appVM.keepScreenAwakeDuringSession) { _, _ in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
        }
        .onChange(of: vm.isActive) { _, _ in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
        }
        .onChange(of: vm.isPaused) { _, _ in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
        }
        .onChange(of: vm.isAbandoned) { _, _ in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
        }
        .onChange(of: vm.isComplete) { _, isComplete in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
            if isComplete && !vm.isAbandoned {
                handleCompletion()
            }
        }
        .alert("Session could not be saved", isPresented: $showSaveError) {
            Button("Retry") { handleCompletion() }
            Button("Continue without saving", role: .destructive) {
                appVM.completeSession(
                    sessionId: "",
                    clearPercent: vm.clearPercent,
                    thoughtCount: vm.thoughtCount,
                    thoughts: vm.capturedThoughts,
                    dayNumber: vm.dayNumber,
                    sessionType: vm.sessionType,
                    duration: vm.plannedSeconds,
                    bonusSeconds: vm.bonusSeconds,
                    unlockAppGate: vm.completedNaturally
                )
            }
        } message: {
            Text("Your session data couldn't be saved. You can retry or continue without saving.")
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

    private var sessionInProgress: Bool {
        !vm.isComplete && !vm.isAbandoned && (vm.isActive || vm.isPaused)
    }

    /// Active sit timer only (not paused); idle timer may lock while paused.
    private var sessionTimerRunning: Bool {
        vm.isActive && !vm.isPaused && !vm.isComplete && !vm.isAbandoned
    }

    private var bottomOverlayReserve: CGFloat {
        Self.bottomOverlayReserveWithControls
    }

    private var controlsShouldBeVisible: Bool {
        vm.controlsVisible || !vm.isActive || verticalSizeClass == .compact
    }

    private var thoughtCaptureBottomPadding: CGFloat {
        // Keep capture card stable while typing even if controls auto-hide.
        if vm.showPostDistractionCapture {
            return Self.bottomOverlayReserveWithControls + SPSpacing.s2
        }
        return bottomOverlayReserve + SPSpacing.s2
    }

    private var secondaryChromeDimmed: Bool {
        vm.isActive && !vm.controlsVisible
    }

    /// Hold control + state dot: visible for the whole active sit path (not hidden with other chrome).
    private var persistentDistractionBar: some View {
        VStack(spacing: SPSpacing.s2) {
            HStack(spacing: SPSpacing.s2) {
                Circle()
                    .fill(
                        vm.mindState == "clear"
                            ? SPColor.green
                            : vm.mindState == "hyperfocus"
                                ? Color(red: 0.38, green: 0.65, blue: 0.98)
                                : SPColor.amber
                    )
                    .frame(width: 10, height: 10)
                    .shadow(
                        color: vm.mindState == "clear"
                            ? .clear
                            : vm.mindState == "hyperfocus"
                                ? Color.blue.opacity(0.45)
                                : SPColor.amber.opacity(0.45),
                        radius: vm.mindState == "clear" ? 0 : 6
                    )

                Text(vm.mindState == "thinking" ? "Distracted" : vm.mindState == "hyperfocus" ? "Hyperfocus" : "Aware")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(1)

                Spacer(minLength: 0)

                if vm.distractionSegmentCount > 0 {
                    Text("\(vm.distractionSegmentCount) light")
                        .font(SPFont.mono(10, weight: .medium))
                        .foregroundStyle(SPColor.amberText)
                }

                if !vm.capturedThoughts.isEmpty {
                    Text("\(vm.capturedThoughts.count) captured")
                        .font(SPFont.mono(10, weight: .medium))
                        .foregroundStyle(SPColor.amberText)
                }
            }
            .padding(.horizontal, SPSpacing.s3)

            if appVM.appBlockingManager.hasSelection {
                Text("Complete the timer to open your selected app gate. Ending early keeps those apps held.")
                    .font(SPFont.mono(10))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SPSpacing.s4)
            }

            Text("Hold a button, or hold Space (light distraction) or Comma (hyperfocus) on an external keyboard.")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SPSpacing.s4)

            Text("Light distraction holds only log segments. Use explicit capture paths to save notes.")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SPSpacing.s4)

            if !vm.showPostDistractionCapture, vm.isActive || vm.isPaused {
                Button {
                    vm.openThoughtCapture()
                } label: {
                    Text("Capture")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(SPColor.amberText)
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .frame(minHeight: 44)
                        .background(SPColor.amberBgFaint)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.amberBorderSubtle))
                }
                .accessibilityIdentifier("session.captureButton")
                .opacity(vm.isActive && !vm.controlsVisible ? 0.48 : 0.88)
                .animation(.easeInOut(duration: 0.3), value: vm.controlsVisible)
                .padding(.top, SPSpacing.s1)
            }

            HStack(spacing: SPSpacing.s2) {
                Text("Hold — light distraction")
                    .font(SPFont.serifItalic(15))
                    .foregroundStyle(Color(SPColor.fg))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SPSpacing.s3)
                    .padding(.vertical, SPSpacing.s2)
                    .frame(maxWidth: .infinity)
                    .background(
                        vm.mindState == "thinking"
                            ? SPColor.amberBgFaint
                            : SPColor.greenBgFaint
                    )
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(
                            vm.mindState == "thinking"
                                ? SPColor.amberBorderSubtle
                                : SPColor.greenBorderSubtle
                        )
                    )
                    .opacity(vm.isActive ? 1 : 0.45)
                    .accessibilityValue(vm.mindState == "thinking" ? "active" : "inactive")
                    .accessibilityLabel("Hold for light distraction. Release when aware again.")
                    .accessibilityIdentifier("session.lightDistractionHoldButton")
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { _ in
                                if vm.isActive { vm.beginDistraction() }
                            }
                            .onEnded { _ in
                                vm.endDistraction()
                            }
                    )

                Text("Hold — hyperfocus")
                    .font(SPFont.serifItalic(15))
                    .foregroundStyle(Color(SPColor.fg))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SPSpacing.s3)
                    .padding(.vertical, SPSpacing.s2)
                    .frame(maxWidth: .infinity)
                    .background(
                        vm.mindState == "hyperfocus"
                            ? Color(red: 0.15, green: 0.22, blue: 0.38).opacity(0.55)
                            : SPColor.surface2
                    )
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(
                            vm.mindState == "hyperfocus"
                                ? Color.blue.opacity(0.45)
                                : SPColor.border2
                        )
                    )
                    .opacity(vm.isActive ? 1 : 0.45)
                    .accessibilityValue(vm.mindState == "hyperfocus" ? "active" : "inactive")
                    .accessibilityLabel("Hold for hyperfocus. Release to return to aware.")
                    .accessibilityIdentifier("session.hyperfocusHoldButton")
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { _ in
                                if vm.isActive { vm.beginHyperfocus() }
                            }
                            .onEnded { _ in
                                vm.endHyperfocus()
                            }
                    )
            }
            .padding(.horizontal, SPSpacing.s2)
        }
        .padding(.vertical, SPSpacing.s3)
        .background(
            SPColor.bg.opacity(0.92)
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: - Control Panel

    private var controlPanel: some View {
        VStack(spacing: SPSpacing.s3) {
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
                .accessibilityIdentifier("session.pauseResumeButton")

                // End Early — sets isComplete, onChange handles save + navigation
                Button {
                    _ = vm.endEarly()
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
                .accessibilityIdentifier("session.endEarlyButton")

                if !(sessionInProgress && !vm.showPostDistractionCapture && (vm.isActive || vm.isPaused)) {
                    Button {
                        vm.openThoughtCapture()
                    } label: {
                        Text("Capture")
                            .font(SPFont.mono(12, weight: .medium))
                            .foregroundStyle(SPColor.amberText)
                            .padding(.horizontal, SPSpacing.s3)
                            .padding(.vertical, SPSpacing.s1)
                            .background(SPColor.amberBgFaint)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.amberBorderSubtle))
                    }
                    .accessibilityIdentifier("session.captureButton")
                    .disabled(!vm.isActive)
                    .opacity(vm.isActive ? 1 : 0.45)
                }

                Button {
                    vm.extendBonus(seconds: 60)
                } label: {
                    Text("+1 min")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg2))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border1))
                }
                .disabled(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive)
                .opacity(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive ? 0.45 : 1)
                .accessibilityIdentifier("session.extendOneMinuteButton")

                Button {
                    vm.extendBonus(seconds: 300)
                } label: {
                    Text("+5 min")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg2))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s1)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border1))
                }
                .disabled(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive)
                .opacity(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive ? 0.45 : 1)
                .accessibilityIdentifier("session.extendFiveMinuteButton")

                // Abandon
                Button {
                    vm.abandon()
                    Task { await appVM.returnHome() }
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
                .accessibilityIdentifier("session.abandonButton")
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
        .padding(.top, SPSpacing.s3)
        .padding(.bottom, SPSpacing.s2)
        .background(
            SPColor.bg.opacity(0.9)
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
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
            // Persist session before navigating to completion screen
            guard let session = await vm.saveSession(completed: vm.completedNaturally) else {
                showSaveError = true
                return
            }
            appVM.completeSession(
                sessionId: session.id,
                clearPercent: vm.clearPercent,
                thoughtCount: vm.thoughtCount,
                thoughts: vm.capturedThoughts,
                dayNumber: session.dayNumber,
                sessionType: session.sessionType,
                duration: vm.plannedSeconds,
                bonusSeconds: vm.bonusSeconds,
                unlockAppGate: vm.completedNaturally
            )
        }
    }
}
