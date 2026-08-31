import SwiftUI
import StillPointShared
import UIKit

struct SessionView: View {
    /// Space reserved when tracking info, secondary controls, and thumb-reach holds are visible.
    private static let bottomOverlayReserveWithControls: CGFloat = 300
    /// Minimum vertical hit target for hold-to-track controls (Apple HIG ~44pt+).
    private static let thumbReachHoldMinHeight: CGFloat = 56
    /// Minimum tap target for sound toggles and the bottom-bar icon buttons
    /// (Apple HIG 44pt). Shared with web through `SoundToggleAppearance` (#668).
    private static let minTapTarget = CGFloat(SoundToggleAppearance.minimumTapTarget)

    /// #669: long-press duration that opens thought capture from the minimal view.
    private static let minimalViewCapturePressDuration: Double = 0.5
    /// #669: no bottom chrome to clear in minimal view, so the capture card sits low.
    private static let minimalViewCaptureBottomPadding: CGFloat = 80

    let appVM: AppViewModel
    @State private var vm: SessionViewModel
    /// #669 "just the timer": seeded from the persisted preference so the choice
    /// carries into the next sit, and written back whenever it is toggled.
    @State private var minimalView: Bool
    /// Drives the fade-out "tap to come back" hint each time minimal view is entered.
    @State private var minimalHintVisible = false
    @State private var minimalHintToken = 0
    @State private var showSaveError = false
    @State private var showCaptureHelper = false
    @State private var showAttentionUnsupportedAlert = false
    @State private var showAttentionPermissionAlert = false
    @State private var showAttentionFailedAlert = false
    @State private var attentionManager = AttentionTrackingManager()
    @State private var attentionStartGeneration = 0
    @State private var gazeTrackingRanThisSession = false
    /// #563: ambient sound level sampler for solo sits.
    @State private var ambientSoundManager = AmbientSoundManager()
    @State private var guidedExerciseVM = GuidedExerciseViewModel()

    init(appVM: AppViewModel, sessionType: SessionType = .standard, track: Track = .primary) {
        self.appVM = appVM
        // #240: the second track uses its own day counter; the primary track uses currentDay.
        let day = track == .second ? appVM.secondTrackDay : appVM.currentDay
        let recovery = track == .second ? DurationRecovery.RecoveryFields.none : appVM.recoveryFields
        self._vm = State(initialValue: SessionViewModel(
            dayNumber: day,
            sessionType: sessionType,
            track: track,
            recovery: recovery
        ))
        // #669: restore the last-used view mode before the first frame so a sit
        // that should start minimal never flashes the full screen first.
        self._minimalView = State(initialValue: MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()

            GeometryReader { geo in
                let contentHeight = max(0, geo.size.height - bottomOverlayReserve)

                VStack(spacing: 0) {
                    // Main content — fits in viewport above controls
                    VStack(spacing: SPSpacing.s3) {
                        if minimalView {
                            Spacer(minLength: 0)
                        }

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

                        // #669: minimal view is the countdown alone — everything below
                        // it is chrome and goes away until the user taps to come back.
                        if minimalView {
                            minimalViewHint
                            Spacer(minLength: 0)
                        } else {
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
                    }
                    .frame(height: contentHeight)
                    .padding(.top, SPSpacing.s1)
                }
            }

            // Bottom chrome: secondary controls above; primary hold targets pinned to thumb-reach zone.
            // #669: all of it is hidden in minimal view.
            if !minimalView {
                VStack(spacing: 0) {
                    Spacer()
                    if sessionInProgress {
                        sessionTrackingInfoBar
                    }
                    controlPanel
                        .opacity(secondaryChromeDimmed ? 0.32 : 1)
                        .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
                    if sessionInProgress {
                        // #526: show hold cluster only when unlocked and not hidden by the user.
                        if appVM.trackingControlPrefsManager.showDistractionHyperfocusCluster {
                            thumbReachHoldControls
                        } else if !appVM.trackingControlPrefsManager.trackingControlsUnlocked {
                            trackingUnlockExplainer
                        }
                        // else: unlocked but hidden by user preference — show nothing.
                    }
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement(children: .ignore)
                        .accessibilityIdentifier("session.secondaryChromeMarker")
                        .accessibilityValue(secondaryChromeDimmed ? "dimmed" : "visible")
                }
                .allowsHitTesting(!vm.showIntroOverlay)
                .animation(.easeInOut(duration: 0.3), value: vm.controlsVisible)
            }

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

            // Guided exercise overlay — sit timer keeps running underneath (#519)
            if vm.showGuidedExercise {
                GuidedExerciseOverlayView(
                    vm: guidedExerciseVM,
                    onClose: {
                        guidedExerciseVM.reset()
                        vm.closeGuidedExercise()
                    }
                )
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
        // #669: while minimal the whole screen is the affordance — a tap brings the
        // session screen back, a long press opens thought capture *without* leaving
        // minimal view. Tap-anywhere is not a capture gesture in the full view
        // either, so the two never compete for the same tap.
        .onTapGesture {
            if minimalView, minimalGesturesEnabled {
                setMinimalView(false)
            } else {
                vm.userInteracted()
            }
        }
        // `including: .subviews` makes this recognizer inert outside minimal view, so it
        // can never compete with the hold-to-track drag gestures in the full screen.
        .simultaneousGesture(
            LongPressGesture(minimumDuration: Self.minimalViewCapturePressDuration)
                .onEnded { _ in
                    guard minimalView, minimalGesturesEnabled else { return }
                    vm.openThoughtCapture()
                },
            including: minimalView ? .all : .subviews
        )
        .task(id: MinimalHintTrigger(token: minimalHintToken, introVisible: vm.showIntroOverlay)) {
            guard minimalView, !vm.showIntroOverlay else { return }
            minimalHintVisible = true
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.7)) {
                minimalHintVisible = false
            }
        }
        .onAppear {
            let skipIntro = ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1"
            vm.prepareSession(
                introHiddenPermanently: SessionIntroPrefs.isIntroOverlayHidden,
                skipIntroForUITest: skipIntro
            )
            syncAttentionTracking()
            syncAmbientSound()
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
            ambientSoundManager.stop()
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
                ambientSoundManager.stop()
            } else {
                syncAttentionTracking()
                syncAmbientSound()
            }
        }
        .onChange(of: attentionManager.status) { _, status in
            if status == .running {
                gazeTrackingRanThisSession = true
            }
            guard appVM.currentUser?.attentionTrackingEnabled == true else { return }
            // Surface permission/failure/unsupported alerts regardless of whether the
            // session is still in progress; a status change at a session boundary would
            // otherwise be silently swallowed by the sessionInProgress guard (#628).
            guard !vm.showIntroOverlay else { return }
            switch status {
            case .unsupported, .permissionDenied, .failed:
                presentAttentionStatusAlert(for: status)
            case .idle, .running, .paused:
                break
            }
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
            if appVM.currentUser?.ambientSoundEnabled == true {
                if isPaused {
                    ambientSoundManager.pause()
                } else {
                    ambientSoundManager.resume()
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
        .onChange(of: vm.isAbandoned) { _, isAbandoned in
            if isAbandoned {
                guidedExerciseVM.reset()
                vm.closeGuidedExercise()
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
        .onChange(of: vm.isComplete) { _, isComplete in
            if isComplete {
                guidedExerciseVM.reset()
                vm.closeGuidedExercise()
                let shouldIncludeGazeSummary = appVM.currentUser?.attentionTrackingEnabled == true
                    && gazeTrackingRanThisSession
                let gazeLog = shouldIncludeGazeSummary ? attentionManager.attentionLog : nil
                attentionManager.stop()
                if shouldIncludeGazeSummary {
                    vm.attentionLog = gazeLog
                }
                gazeTrackingRanThisSession = false
                // #563: stop mic tap and persist the level summary into the view model.
                ambientSoundManager.stop()
                vm.ambientSoundSummary = ambientSoundManager.summary
            } else {
                attentionManager.stop()
                ambientSoundManager.stop()
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
                    track: vm.track,
                    duration: vm.plannedSeconds,
                    bonusSeconds: vm.bonusSeconds,
                    unlockAppGate: vm.completedNaturally,
                    ambientSoundSummary: vm.ambientSoundSummary
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

    /// #563: start ambient sound capture when the user has opted in and the sit is running.
    /// No-ops gracefully when the feature is disabled, mic was denied, or on simulator.
    private func syncAmbientSound() {
        guard appVM.currentUser?.ambientSoundEnabled == true else { return }
        guard !vm.showIntroOverlay, sessionTimerRunning else { return }
        Task {
            await ambientSoundManager.start { vm.elapsed }
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
        // #669: minimal view has no bottom chrome, so the timer gets the whole screen.
        minimalView ? 0 : Self.bottomOverlayReserveWithControls
    }

    private var thoughtCaptureBottomPadding: CGFloat {
        // Keep capture card stable while typing even if controls auto-hide.
        if minimalView {
            return Self.minimalViewCaptureBottomPadding
        }
        if vm.showPostDistractionCapture {
            return Self.bottomOverlayReserveWithControls + SPSpacing.s2
        }
        return bottomOverlayReserve + SPSpacing.s2
    }

    // MARK: - Minimal View (#669)

    /// Identity for the minimal-view hint task. Re-runs on every entry *and* once the
    /// intro overlay clears, so a sit restored straight into minimal view from the
    /// persisted preference still gets its "how to come back" hint — the overlay is
    /// up when the view first appears, and the hint would otherwise never flash.
    private struct MinimalHintTrigger: Equatable {
        let token: Int
        let introVisible: Bool
    }

    /// Screen-wide tap/long-press only apply while a sit is running with no overlay on top.
    private var minimalGesturesEnabled: Bool {
        sessionInProgress
            && !vm.showPostDistractionCapture
            && !vm.showGuidedExercise
            && !vm.showIntroOverlay
    }

    /// Enters or leaves minimal view and persists the choice for the next sit.
    private func setMinimalView(_ enabled: Bool) {
        guard minimalView != enabled else { return }
        if enabled {
            // The hold targets are about to be removed from the hierarchy, so their
            // `DragGesture.onEnded` would never fire for a hold that is active right
            // now (two-finger: hold with one thumb, tap the toggle with the other) —
            // the sit would stay stuck in `thinking`/`hyperfocus` and skew
            // `clearPercent`. Both calls are guarded no-ops when nothing is held.
            // Mirrors web's `enterMinimalView`, which finalizes the same way.
            vm.endDistraction()
            vm.endHyperfocus()
        }
        withAnimation(.easeInOut(duration: 0.3)) {
            minimalView = enabled
        }
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(enabled)
        if enabled {
            // Re-flash the "how to get back" hint on every entry.
            minimalHintVisible = false
            minimalHintToken += 1
        } else {
            minimalHintVisible = false
            vm.userInteracted()
        }
    }

    /// Fades out after a few seconds so the minimal screen really is just the timer.
    private var minimalViewHint: some View {
        Text("Tap anywhere to bring the session back · press and hold to capture a note")
            .font(SPFont.mono(11))
            .foregroundStyle(Color(SPColor.fg4))
            .multilineTextAlignment(.center)
            .padding(.horizontal, SPSpacing.s4)
            .opacity(minimalHintVisible ? 1 : 0)
            .accessibilityIdentifier("session.minimalViewHint")
            .accessibilityHidden(!minimalHintVisible)
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

            if !vm.showPostDistractionCapture, !vm.showGuidedExercise, vm.isActive || vm.isPaused {
                HStack(spacing: SPSpacing.s1) {
                    if vm.isActive {
                        Button {
                            vm.openGuidedExercise()
                        } label: {
                            Text("Guided exercise")
                                .font(SPFont.mono(12, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                                .spCapsuleButtonStyle(.green, size: .fullWidth, minHeight: 44)
                        }
                        .accessibilityIdentifier("session.guidedExerciseButton")
                    }

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
                            .frame(width: Self.minTapTarget, height: Self.minTapTarget)
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

                    // #669: collapse to the countdown alone. Kept as an icon so it
                    // stays an affordance rather than becoming more chrome.
                    Button {
                        setMinimalView(true)
                    } label: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg3))
                            .frame(width: Self.minTapTarget, height: Self.minTapTarget)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Show only the timer")
                    .accessibilityIdentifier("session.minimalViewToggle")
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

    // MARK: - Pre-unlock Explainer (#526)

    /// Shown in place of `thumbReachHoldControls` until the user completes a qualifying
    /// 5+ minute sit. Mirrors web's copy and placement in `SessionView.tsx`.
    private var trackingUnlockExplainer: some View {
        Text("Distraction and hyperfocus tracking unlock after you complete one sit of five minutes or longer.")
            .font(SPFont.mono(11))
            .foregroundStyle(Color(SPColor.fg4))
            .multilineTextAlignment(.center)
            .padding(.horizontal, SPSpacing.s4)
            .padding(.vertical, SPSpacing.s3)
            .frame(maxWidth: .infinity)
            .background(
                SPColor.bg.opacity(0.95)
                    .background(.ultraThinMaterial)
                    .ignoresSafeArea(edges: .bottom)
            )
            .accessibilityIdentifier("session.trackingUnlockExplainer")
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

                if !(sessionInProgress && !vm.showPostDistractionCapture && !vm.showGuidedExercise && (vm.isActive || vm.isPaused)) {
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
                .disabled(vm.showPostDistractionCapture || vm.showGuidedExercise || vm.isComplete || vm.isAbandoned || !vm.isActive)
                .opacity(vm.showPostDistractionCapture || vm.showGuidedExercise || vm.isComplete || vm.isAbandoned || !vm.isActive ? 0.45 : 1)
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
                .disabled(vm.showPostDistractionCapture || vm.showGuidedExercise || vm.isComplete || vm.isAbandoned || !vm.isActive)
                .opacity(vm.showPostDistractionCapture || vm.showGuidedExercise || vm.isComplete || vm.isAbandoned || !vm.isActive ? 0.45 : 1)
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

            // Sound toggles. #668: the pills are wider than the bare words they
            // replaced, so the row tightens to s1 to keep all four on one line on
            // the narrowest supported iPhone.
            HStack(spacing: SPSpacing.s1) {
                soundToggle("tick", isOn: vm.soundPrefs.tick) {
                    vm.toggleSound(\.tick)
                }
                soundToggle("chime", isOn: vm.soundPrefs.chime) {
                    vm.toggleSound(\.chime)
                }
                soundToggle("end", isOn: vm.soundPrefs.completion) {
                    vm.toggleSound(\.completion)
                }
                // #554: voice countdown — spoken numbers in the final minute.
                soundToggle("voice", isOn: vm.soundPrefs.voiceCountdown) {
                    vm.toggleSound(\.voiceCountdown)
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

    /// #668: a real pill button rather than a bare word.
    ///
    /// On/off is carried by three redundant channels — fill, border, and the
    /// speaker icon — so the state reads at a glance instead of resting on a
    /// shift between two muted greys. `SoundToggleAppearance` owns those rules and
    /// web reads the same ones, so the two clients stay in step. The pill itself
    /// is 44pt tall, so the visible control *is* the tap target.
    private func soundToggle(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        let appearance = SoundToggleAppearance.appearance(isOn: isOn)

        return Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: appearance.systemImageName)
                    .font(.system(size: 12))
                Text(label)
                    .font(SPFont.mono(11))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isOn ? Color(SPColor.fg2) : Color(SPColor.fg4))
            .padding(.horizontal, SPSpacing.s2)
            .frame(minHeight: Self.minTapTarget)
            .background(appearance.isFilled ? SPColor.surface3 : Color.clear)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(
                    appearance.hasProminentBorder ? SPColor.border2 : SPColor.border1
                )
            )
            .contentShape(Capsule())
        }
        .animation(.easeInOut(duration: 0.2), value: isOn)
        .accessibilityIdentifier(SoundToggleAppearance.accessibilityIdentifier(label: label))
        // VoiceOver reads "tick sound, on, button" — the state is announced, not
        // left to the colour of the pill.
        .accessibilityLabel(Text(SoundToggleAppearance.accessibilityLabel(label: label)))
        .accessibilityValue(Text(SoundToggleAppearance.accessibilityValue(isOn: isOn)))
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
                // #703: the alert below already blocks the false-success
                // completion; the flag additionally withdraws the offline
                // strip's "sits are saved" promise, which stays on screen after
                // the user picks "Continue without saving".
                appVM.localSaveFailed = true
                showSaveError = true
                return
            }
            appVM.localSaveFailed = false
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
                attentionElapsed: vm.attentionLog != nil ? vm.elapsed : nil,
                ambientSoundSummary: vm.ambientSoundSummary
            )
        }
    }
}
