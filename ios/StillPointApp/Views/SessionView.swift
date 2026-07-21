import SwiftUI
import StillPointShared
import UIKit

struct SessionView: View {
    /// Space reserved when tracking info, secondary controls, and thumb-reach holds are visible.
    private static let bottomOverlayReserveWithControls: CGFloat = 300
    /// Minimum vertical hit target for hold-to-track controls (Apple HIG ~44pt+).
    private static let thumbReachHoldMinHeight: CGFloat = 56
    /// Minimum tap target for sound toggles (Apple HIG 44pt).
    private static let soundToggleMinSize: CGFloat = 44

    let appVM: AppViewModel
    @State private var vm: SessionViewModel
    @State private var showSaveError = false
    @State private var showCaptureHelper = false
    @State private var showAttentionUnsupportedAlert = false
    @State private var showAttentionPermissionAlert = false
    @State private var showAttentionFailedAlert = false
    @State private var attentionManager = AttentionTrackingManager()
    @State private var attentionStartGeneration = 0
    @State private var gazeTrackingRanThisSession = false

    init(appVM: AppViewModel, sessionType: SessionType = .standard, track: Track = .primary) {
        self.appVM = appVM
        // #240: the second track uses its own day counter; the primary track uses currentDay.
        let day = track == .second ? appVM.secondTrackDay : appVM.currentDay
        self._vm = State(initialValue: SessionViewModel(dayNumber: day, sessionType: sessionType, track: track))
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
                    .padding(.top, SPSpacing.s1)
                }
            }

            // Bottom chrome: secondary controls above; primary hold targets pinned to thumb-reach zone.
            VStack(spacing: 0) {
                Spacer()
                if sessionInProgress {
                    sessionTrackingInfoBar
                }
                controlPanel
                    .opacity(secondaryChromeDimmed ? 0.32 : 1)
                    .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
                if sessionInProgress {
                    thumbReachHoldControls
                }
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityIdentifier("session.secondaryChromeMarker")
                    .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
            }
            .allowsHitTesting(!vm.showIntroOverlay)
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

            // Pre-session intro gates the countdown (#560) — topmost layer blocks chrome interaction.
            if vm.showIntroOverlay {
                SessionIntroOverlayView(
                    onBegin: { vm.dismissIntroOverlay(dontShowAgain: false) },
                    onDontShowAgain: { vm.dismissIntroOverlay(dontShowAgain: true) }
                )
                .transition(.opacity)
            }
        }
        .onTapGesture {
            vm.userInteracted()
        }
        .onAppear {
            let skipIntro = ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1"
            vm.prepareSession(
                introHiddenPermanently: SessionIntroPrefs.isIntroOverlayHidden,
                skipIntroForUITest: skipIntro
            )
            syncAttentionTracking()
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: sessionInProgress
            )
        }
        .onDisappear {
            attentionStartGeneration += 1
            attentionManager.stop()
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: false
            )
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: false
            )
        }
        .onChange(of: vm.showIntroOverlay) { _, showIntro in
            if showIntro {
                attentionStartGeneration += 1
                attentionManager.stop()
            } else {
                syncAttentionTracking()
            }
        }
        .onChange(of: attentionManager.status) { _, status in
            if status == .running {
                gazeTrackingRanThisSession = true
            }
            guard appVM.currentUser?.attentionTrackingEnabled == true else { return }
            guard sessionInProgress, !vm.showIntroOverlay else { return }
            presentAttentionStatusAlert(for: status)
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
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: sessionInProgress
            )
        }
        .onChange(of: vm.isPaused) { _, isPaused in
            if appVM.currentUser?.attentionTrackingEnabled == true {
                if isPaused {
                    attentionManager.pause()
                } else {
                    attentionManager.resume()
                }
            }
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: sessionInProgress
            )
        }
        .onChange(of: vm.isAbandoned) { _, _ in
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: sessionInProgress
            )
        }
        .onChange(of: vm.isComplete) { _, isComplete in
            if isComplete {
                let shouldIncludeGazeSummary = appVM.currentUser?.attentionTrackingEnabled == true
                    && gazeTrackingRanThisSession
                let gazeLog = shouldIncludeGazeSummary ? attentionManager.attentionLog : nil
                attentionManager.stop()
                if shouldIncludeGazeSummary {
                    vm.attentionLog = gazeLog
                }
                gazeTrackingRanThisSession = false
            } else {
                attentionManager.stop()
            }
            SessionIdleTimerController.syncLocalSession(
                appVM: appVM,
                isRunning: sessionTimerRunning
            )
            SessionNotificationSuppressionController.syncLocalSession(
                appVM: appVM,
                inProgress: sessionInProgress
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
                    clientSessionId: UUID(),
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
            Text("Your session couldn't be saved on this device. You can retry or continue without saving.")
        }
        .alert("Gaze tracking unavailable", isPresented: $showAttentionUnsupportedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This device does not support TrueDepth face tracking. Gaze attention tracking requires an iPhone or iPad with a front-facing TrueDepth camera.")
        }
        .alert("Camera access required", isPresented: $showAttentionPermissionAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Continue without gaze tracking", role: .cancel) {}
        } message: {
            Text("Gaze attention tracking needs front camera access. Allow camera access in Settings to use this feature during sessions.")
        }
        .alert("Gaze tracking failed", isPresented: $showAttentionFailedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(attentionManager.lastFailureMessage ?? "The ARKit session stopped unexpectedly. Your sit continues without gaze tracking.")
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

    private func syncAttentionTracking() {
        guard appVM.currentUser?.attentionTrackingEnabled == true else { return }
        guard !vm.showIntroOverlay, sessionTimerRunning else { return }
        attentionStartGeneration += 1
        let generation = attentionStartGeneration
        Task {
            await attentionManager.start { vm.elapsed }
            guard generation == attentionStartGeneration else { return }
            guard !vm.showIntroOverlay, sessionTimerRunning else {
                attentionManager.stop()
                return
            }
            presentAttentionStatusAlert(for: attentionManager.status)
        }
    }

    private func presentAttentionStatusAlert(for status: AttentionTrackingStatus) {
        switch status {
        case .unsupported:
            showAttentionUnsupportedAlert = true
        case .permissionDenied:
            showAttentionPermissionAlert = true
        case .failed:
            showAttentionFailedAlert = true
        case .idle, .running, .paused:
            break
        }
    }

    private var showsLiveGazeIndicator: Bool {
        appVM.currentUser?.attentionTrackingEnabled == true
            && attentionManager.status == .running
            && !vm.isPaused
            && attentionManager.didReceiveSample
    }

    private var bottomOverlayReserve: CGFloat {
        Self.bottomOverlayReserveWithControls
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

    /// Status + capture action above the thumb zone; hold controls live in `thumbReachHoldControls`.
    private var sessionTrackingInfoBar: some View {
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

            if showsLiveGazeIndicator {
                HStack(spacing: SPSpacing.s2) {
                    Circle()
                        .fill(
                            attentionManager.currentAttentionState == "attentive"
                                ? SPColor.green
                                : SPColor.amber
                        )
                        .frame(width: 8, height: 8)

                    Text(
                        attentionManager.currentAttentionState == "attentive"
                            ? "Gaze on screen"
                            : "Gaze away"
                    )
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(1)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, SPSpacing.s3)
                .accessibilityIdentifier("session.gazeIndicator")
                .accessibilityValue(attentionManager.currentAttentionState)
            }

            if !vm.showPostDistractionCapture, vm.isActive || vm.isPaused {
                HStack(spacing: SPSpacing.s1) {
                    Button {
                        vm.openThoughtCapture()
                    } label: {
                        Text("Capture intrusive thought")
                            .font(SPFont.mono(12, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                            .spCapsuleButtonStyle(.amber, size: .fullWidth, minHeight: 44)
                    }
                    .accessibilityIdentifier("session.captureButton")

                    Button {
                        showCaptureHelper = true
                    } label: {
                        Image(systemName: "info.circle")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .frame(width: Self.soundToggleMinSize, height: Self.soundToggleMinSize)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Capture intrusive thought help")
                    .accessibilityIdentifier("session.captureHelperButton")
                    .popover(isPresented: $showCaptureHelper, arrowEdge: .bottom) {
                        Text("Tap to save a note about what you were thinking. Hold buttons only log awareness segments — they do not save notes.")
                            .font(SPFont.serif(14, weight: .light))
                            .foregroundStyle(Color(SPColor.fg2))
                            .padding(SPSpacing.s3)
                            .frame(maxWidth: 280)
                            .presentationCompactAdaptation(.popover)
                    }
                }
                .opacity(vm.isActive && !vm.controlsVisible ? 0.48 : 0.88)
                .animation(.easeInOut(duration: 0.3), value: vm.controlsVisible)
                .padding(.horizontal, SPSpacing.s3)
            }
        }
        .padding(.top, SPSpacing.s2)
        .padding(.bottom, SPSpacing.s1)
        .background(
            SPColor.bg.opacity(0.92)
                .background(.ultraThinMaterial)
        )
    }

    /// Primary hold targets pinned to the lower third + home-indicator safe area.
    private var thumbReachHoldControls: some View {
        HStack(spacing: SPSpacing.s2) {
            Text("\(vm.mindState == "thinking" ? "Release" : "Hold") — light distraction")
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .spCapsuleButtonStyle(
                    vm.mindState == "thinking" ? .amber : .green,
                    size: .fullWidth,
                    tall: true,
                    minHeight: Self.thumbReachHoldMinHeight,
                    horizontalPadding: SPSpacing.s3
                )
                .foregroundStyle(Color(SPColor.fg))
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

            Text("\(vm.mindState == "hyperfocus" ? "Release" : "Hold") — hyperfocus")
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, SPSpacing.s3)
                .frame(maxWidth: .infinity, minHeight: Self.thumbReachHoldMinHeight)
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
        .padding(.top, SPSpacing.s2)
        .padding(.bottom, SPSpacing.s2)
        .safeAreaPadding(.bottom, SPSpacing.s1)
        .background(
            SPColor.bg.opacity(0.95)
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .spCapsuleButtonStyle(.neutral, size: .compact)
                }
                .accessibilityIdentifier("session.pauseResumeButton")

                // End Early — sets isComplete, onChange handles save + navigation
                Button {
                    _ = vm.endEarly()
                } label: {
                    Text("End Early")
                        .font(SPFont.mono(12, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .spCapsuleButtonStyle(.neutral, size: .compact)
                }
                .accessibilityIdentifier("session.endEarlyButton")

                if !(sessionInProgress && !vm.showPostDistractionCapture && (vm.isActive || vm.isPaused)) {
                    Button {
                        vm.openThoughtCapture()
                    } label: {
                        Text("Capture intrusive thought")
                            .font(SPFont.mono(12, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                            .spCapsuleButtonStyle(.amber, size: .compact)
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .spCapsuleButtonStyle(.neutral, size: .compact)
                        .foregroundStyle(Color(SPColor.fg2))
                }
                .disabled(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive)
                .opacity(vm.showPostDistractionCapture || vm.isComplete || vm.isAbandoned || !vm.isActive ? 0.45 : 1)
                .accessibilityIdentifier("session.extendOneMinuteButton")

                Button {
                    vm.extendBonus(seconds: 300)
                } label: {
                    Text("+5 min")
                        .font(SPFont.mono(12, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .spCapsuleButtonStyle(.neutral, size: .compact)
                        .foregroundStyle(Color(SPColor.fg2))
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .spCapsuleButtonStyle(.danger, size: .compact)
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
        )
    }

    private func soundToggle(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: isOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 12))
                Text(label)
                    .font(SPFont.mono(11))
                    .lineLimit(1)
            }
            .foregroundStyle(isOn ? Color(SPColor.fg3) : Color(SPColor.fg4))
            .frame(minWidth: Self.soundToggleMinSize, minHeight: Self.soundToggleMinSize)
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("session.soundToggle.\(label)")
    }

    // MARK: - Completion Handler

    private func handleCompletion() {
        Task {
            guard let ownerUserId = appVM.currentUser?.id else {
                showSaveError = true
                return
            }
            // Persist session before navigating to completion screen
            guard let session = await vm.saveSession(
                completed: vm.completedNaturally,
                ownerUserId: ownerUserId
            ) else {
                showSaveError = true
                return
            }
            appVM.completeSession(
                sessionId: session.id,
                clientSessionId: vm.lastClientSessionId ?? UUID(uuidString: session.id) ?? UUID(),
                clearPercent: vm.clearPercent,
                thoughtCount: vm.thoughtCount,
                thoughts: vm.capturedThoughts,
                dayNumber: session.dayNumber,
                sessionType: session.sessionType,
                track: vm.track,
                duration: vm.plannedSeconds,
                bonusSeconds: vm.bonusSeconds,
                unlockAppGate: vm.completedNaturally,
                attentionLog: vm.attentionLog,
                attentionElapsed: vm.attentionLog != nil ? vm.elapsed : nil
            )
        }
    }
}
