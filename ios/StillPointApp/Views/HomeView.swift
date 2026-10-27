import SwiftUI
import StillPointShared

struct HomeView: View {
    let appVM: AppViewModel

    @State private var breatheAnimation = false
    @State private var showAppGateOnboarding = false
    /// #240: dismiss the fork prompt for this session (may reappear on a later visit).
    @State private var forkDismissed = false
    /// #898: the "Combine today's sits?" confirmation is up.
    @State private var showCombineConfirmation = false

    /// Home hides content that would push the session buttons off-screen (or block
    /// the screen) while UI tests drive the app.
    private static var isUITestMode: Bool {
        ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1"
    }

    /// The primary track's cap, in whole minutes (the dual-track fork threshold).
    private static var maxDurationMinutes: Int { StillPoint.maxDuration / 60 }

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                welcomeHeader

                Spacer().frame(height: SPSpacing.s4)

                // #240: dual-track shows two independently-startable track cards;
                // single-track keeps the classic day readout.
                if appVM.dualTrackEnabled {
                    dualTrackCards
                } else {
                    singleTrackReadout
                }

                appGatePill

                // #240: fork choice once past the 10-minute mark (not yet opted in).
                // Suppressed during UI tests (would push the Begin button off-screen
                // for long-running fixture users, producing an invalid hit point).
                if appVM.dualTrackEligible && !appVM.dualTrackEnabled && !forkDismissed
                    && !Self.isUITestMode {
                    dualTrackForkCard
                }

                // L1–L5 lesson pathway preview (#525 / #587) — not tied to day count.
                // Suppressed during UI tests (extra vertical content can push Begin off-screen).
                if !Self.isUITestMode {
                    PathwayView()
                }

                aphorismSection

                Spacer().frame(height: SPSpacing.s4)

                sessionActions

                if let inviteError = appVM.buddyInviteError {
                    Text(inviteError)
                        .font(SPFont.mono(12))
                        .foregroundStyle(Color(SPColor.fg2))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)
                }

                Spacer().frame(height: SPSpacing.s6)

                // FAQ section
                Divider()
                    .background(SPColor.border1)

                faqSection
            }
            .padding(.horizontal, SPSpacing.s4)
            .safeAreaPadding(.bottom, SPSpacing.s4)
        }
        .stillPointBackground()
        .onAppear {
            maybePresentAppGateOnboarding()
        }
        .sheet(isPresented: $showAppGateOnboarding) {
            AppGateOnboardingSheet(appVM: appVM, isPresented: $showAppGateOnboarding)
        }
    }

    @ViewBuilder
    private var welcomeHeader: some View {
        if let username = appVM.currentUser?.username {
            Text("WELCOME, \(username.uppercased())")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(3)
                .padding(.top, SPSpacing.s4)
        }
    }

    /// #240: both track cards, plus the #898 combine action under Track Two.
    private var dualTrackCards: some View {
        VStack(spacing: SPSpacing.s3) {
            trackCard(
                label: "TRACK ONE · \(Self.maxDurationMinutes) MIN",
                day: appVM.currentDay,
                duration: appVM.todayDuration,
                blocks: appVM.todayBlockCount,
                doneToday: appVM.primaryDoneToday,
                recovery: appVM.activeRecovery,
                identifier: "home.trackOne",
                onBegin: { appVM.beginSession(track: .primary) }
            )
            trackCard(
                label: "TRACK TWO",
                day: appVM.secondTrackDay,
                duration: appVM.secondTrackDuration,
                blocks: appVM.secondTrackBlockCount,
                doneToday: appVM.secondDoneToday,
                recovery: nil,
                identifier: "home.trackTwo",
                onBegin: { appVM.beginSession(track: .second) }
            )
            // #898: today's two sits as one, directly under Track Two.
            // Absent, not disabled, when not offered. Suppressed during
            // UI tests, as the fork card is: it would push the quick
            // minute, breath and buddy buttons down.
            if appVM.combineOffered && !Self.isUITestMode {
                combineSitsAction
            }
        }
        .padding(.horizontal, SPSpacing.s2)
    }

    /// Single-track day readout: breathing day number, length, recovery badge.
    @ViewBuilder
    private var singleTrackReadout: some View {
        // Day number with breathing animation
        Text("\(appVM.currentDay)")
            .font(SPFont.dayNumber)
            .foregroundStyle(Color(SPColor.fg))
            .scaleEffect(breatheAnimation ? 1.02 : 1.0)
            .opacity(breatheAnimation ? 1.0 : 0.6)
            .animation(
                .easeInOut(duration: 4).repeatForever(autoreverses: true),
                value: breatheAnimation
            )
            .onAppear { breatheAnimation = true }

        // Day info
        Text("day · \(appVM.todayDuration)s · \(appVM.todayBlockCount) blocks")
            .font(SPFont.mono(14, weight: .light))
            .foregroundStyle(Color(SPColor.fg3))
            .tracking(2)

        if let recovery = appVM.activeRecovery {
            recoveryProgressLabel(recovery)
                .accessibilityIdentifier("home.recoveryBadge")
        }
    }

    /// Begin (single-track only), then quick minute, breath counting, focus and buddy.
    private var sessionActions: some View {
        VStack(spacing: SPSpacing.s2) {
            // Primary Begin lives inside the track cards in dual-track mode.
            if !appVM.dualTrackEnabled {
                Button {
                    withAnimation {
                        appVM.beginSession()
                    }
                } label: {
                    Text("Begin")
                        .font(SPFont.serifItalic(22, weight: .light))
                        .spCapsuleButtonStyle(.neutral, size: .regular, prominent: true, tall: true, horizontalPadding: SPSpacing.s6)
                }
                .accessibilityIdentifier("home.beginButton")
                .accessibilityLabel("Start session")
            }

            Button {
                withAnimation {
                    appVM.beginSession(type: .quick)
                }
            } label: {
                secondaryActionLabel("Quick minute · \(StillPoint.quickDuration)s", color: .green)
            }
            .accessibilityIdentifier("home.quickMinuteButton")
            .accessibilityLabel("Start quick minute")

            Button {
                withAnimation {
                    appVM.beginBreathCounting()
                }
            } label: {
                secondaryActionLabel("Breath counting", color: .neutral)
            }
            .accessibilityIdentifier("home.breathCountingButton")
            .accessibilityLabel("Start breath counting")

            // #840: today's focus goal, one for every category.
            Button {
                withAnimation {
                    appVM.beginFocusActivity()
                }
            } label: {
                secondaryActionLabel("Focus activity · \(FocusActivity.formatGoal(appVM.focusGoalSeconds))", color: .neutral)
            }
            .accessibilityIdentifier("home.focusActivityButton")
            .accessibilityLabel("Start focus activity, \(FocusActivity.spokenDuration(appVM.focusGoalSeconds)) goal")

            Button {
                withAnimation {
                    appVM.beginBuddySession()
                }
            } label: {
                Text("Meditate with a friend")
                    .font(SPFont.serifItalic(18, weight: .light))
                    .spCapsuleButtonStyle(.neutral, size: .regular, horizontalPadding: SPSpacing.s5)
                    .foregroundStyle(Color(SPColor.fg2))
            }
            .accessibilityIdentifier("home.buddySessionButton")
        }
    }

    /// The small mono capsule label shared by the quick minute, breath counting
    /// and focus activity buttons.
    private func secondaryActionLabel(_ title: String, color: SPCapsuleButtonColor) -> some View {
        Text(title)
            .font(SPFont.mono(11, weight: .medium))
            .tracking(1.4)
            .spCapsuleButtonStyle(color, size: .regular)
    }

    /// Miss-a-day recovery ramp progress, shared by the single-track readout and
    /// the Track One card.
    private func recoveryProgressLabel(_ recovery: DurationRecovery.ActiveRecovery) -> some View {
        Text(DurationRecovery.recoveryProgressText(recovery))
            .font(SPFont.mono(11, weight: .medium))
            .foregroundStyle(SPColor.amberText)
            .tracking(1)
            .multilineTextAlignment(.center)
    }

    /// Persistent app-gate status indicator. Hidden until the user has picked apps
    /// to block; tapping jumps to the Settings tab where the gate is configured.
    @ViewBuilder
    private var appGatePill: some View {
        let manager = appVM.appBlockingManager
        if manager.hasSelection {
            Button {
                appVM.selectedTab = MainTab.settings.rawValue
            } label: {
                HStack(spacing: SPSpacing.s2) {
                    Image(systemName: manager.isUnlocked ? "lock.open" : "lock")
                        .font(.system(size: 11, weight: .medium))
                    Text(manager.isUnlocked ? "Apps unlocked until midnight" : "Apps locked — meditate to unlock")
                        .font(SPFont.mono(11, weight: .medium))
                        .tracking(1)
                }
                .spCapsuleButtonStyle(
                    manager.isUnlocked ? .green : .amber,
                    size: .regular,
                    horizontalPadding: SPSpacing.s3
                )
            }
            .accessibilityIdentifier("home.appGatePill")
            .accessibilityLabel(manager.isUnlocked ? "Apps unlocked until midnight" : "Apps locked, meditate to unlock")
        }
    }

    /// Opt-in pre-session inspiration quote (#88). Hidden unless the user has
    /// enabled aphorisms in Settings.
    @ViewBuilder
    private var aphorismSection: some View {
        if appVM.currentUser?.aphorismsEnabled == true {
            let aphorism = Aphorisms.forDay(appVM.currentDay)
            VStack(spacing: SPSpacing.s2) {
                Text("\u{201C}\(aphorism.text)\u{201D}")
                    .font(SPFont.serifItalic(15, weight: .light))
                    .foregroundStyle(Color(SPColor.fg2))
                    .multilineTextAlignment(.center)
                Text("— \(aphorism.author)")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(1.5)
                    .textCase(.uppercase)
            }
            .padding(.horizontal, SPSpacing.s4)
            .accessibilityIdentifier("home.aphorism")
            .accessibilityElement(children: .combine)
        }
    }

    /// #240: one track's Home card — day number, planned length, completion badge
    /// and its own Begin button so either track can be started independently.
    private func trackCard(
        label: String,
        day: Int,
        duration: Int,
        blocks: Int,
        doneToday: Bool,
        recovery: DurationRecovery.ActiveRecovery?,
        identifier: String,
        onBegin: @escaping () -> Void
    ) -> some View {
        VStack(spacing: SPSpacing.s2) {
            HStack(spacing: SPSpacing.s2) {
                Text(label)
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(1.5)
                if doneToday {
                    Text("\u{2713} DONE TODAY")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(SPColor.greenText)
                        .tracking(1)
                }
            }

            Text("\(day)")
                .font(SPFont.mono(48, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .monospacedDigit()

            Text("day · \(duration)s · \(blocks) blocks")
                .font(SPFont.mono(13, weight: .light))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(2)

            if let recovery {
                recoveryProgressLabel(recovery)
            }

            Button {
                withAnimation { onBegin() }
            } label: {
                Text(doneToday ? "Sit again" : "Begin")
                    .font(SPFont.serifItalic(20, weight: .light))
                    .spCapsuleButtonStyle(.neutral, size: .regular, prominent: true, horizontalPadding: 40)
            }
            .padding(.top, SPSpacing.s1)
            .accessibilityIdentifier("\(identifier).beginButton")
            .accessibilityLabel(doneToday ? "\(label) sit again" : "\(label) begin")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SPSpacing.s4)
        .padding(.horizontal, SPSpacing.s3)
        .homeCardChrome()
        .accessibilityIdentifier(identifier)
    }

    /// #898: today's two sits done as one (#769), offered quietly. The tap starts
    /// nothing: it asks first, says splitting the sits is better, and makes "Keep
    /// them separate" the prominent choice. Only "Combine anyway" starts the sit.
    /// The wording is web's (#895), character for character.
    ///
    /// An alert rather than a `confirmationDialog`: a dialog drops its cancel-role
    /// button when it shows as a popover, and "Keep them separate" is the choice
    /// that must always be on screen.
    private var combineSitsAction: some View {
        Button {
            showCombineConfirmation = true
        } label: {
            Text("Combine today's sits")
                .font(SPFont.mono(12))
                .tracking(1)
                .foregroundStyle(Color(SPColor.fg3))
                .underline()
                .frame(minHeight: 44)
        }
        .accessibilityIdentifier("home.combineButton")
        .alert("Combine today's sits?", isPresented: $showCombineConfirmation) {
            Button("Keep them separate", role: .cancel) {}
                .accessibilityIdentifier("home.combineKeepSeparateButton")
            Button("Combine anyway") {
                // The offer can lapse while the alert is up (a refresh lands);
                // nothing starts unless it still stands.
                guard appVM.combineOffered else { return }
                withAnimation { appVM.beginSession(combined: true) }
            }
            .accessibilityIdentifier("home.combineConfirmButton")
        } message: {
            Text(Self.combineConfirmationMessage(duration: appVM.combinedDuration))
        }
    }

    /// The confirmation's text, length as minutes and seconds ("14:10").
    private static func combineConfirmationMessage(duration: Int) -> String {
        "Splitting your sits is better. Two separate sits suit your practice more than one long one, so combine only if you can't sit twice today."
            + "\n\n"
            + "This will be one \(BreathCounting.elapsedDisplay(duration)) sit, and it counts for both tracks."
    }

    /// #240: fork choice presented once the primary track passes the 10-minute mark.
    private var dualTrackForkCard: some View {
        VStack(spacing: SPSpacing.s3) {
            Text("\(Self.maxDurationMinutes)-MINUTE MARK REACHED")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(SPColor.greenText)
                .tracking(1.5)

            Text("Add a second daily track?")
                .font(SPFont.serifItalic(22, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .multilineTextAlignment(.center)

            Text("Your sits have grown to \(Self.maxDurationMinutes) minutes. Keep that daily sit and start a second one that restarts at 1 minute and grows +10s a day — two tracks, run independently.")
                .font(SPFont.serif(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg3))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SPSpacing.s2)

            Button {
                Task { await appVM.enableDualTrack() }
            } label: {
                Text("Add second track")
                    .font(SPFont.mono(12, weight: .medium))
                    .tracking(1.4)
                    .spCapsuleButtonStyle(.green, size: .fullWidth, tall: true)
            }
            .accessibilityIdentifier("home.addSecondTrackButton")

            Button {
                forkDismissed = true
            } label: {
                Text("Keep one track")
                    .font(SPFont.mono(12, weight: .medium))
                    .tracking(1.4)
                    .spCapsuleButtonStyle(.neutral, size: .fullWidth, tall: true)
            }
            .accessibilityIdentifier("home.keepOneTrackButton")
        }
        .padding(SPSpacing.s4)
        .homeCardChrome()
        .padding(.horizontal, SPSpacing.s2)
    }

    /// First-run prompt asking whether to set up the app gate. Shown at most once,
    /// and never during UI tests (it would block the home screen).
    private func maybePresentAppGateOnboarding() {
        guard !Self.isUITestMode else { return }
        let key = "appBlocking.onboardingShown.v1"
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: key) else { return }
        defaults.set(true, forKey: key)
        if !appVM.appBlockingManager.hasSelection {
            showAppGateOnboarding = true
        }
    }

    private var faqSection: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s4) {
            faqItem(
                q: "What do I do?",
                a: "Watch the timer count down. That's it. When you notice you're thinking, tap the button. You can capture the thought if you like. Then go back to watching."
            )
            faqItem(
                q: "How long are sessions?",
                a: "Day 1 starts at 60 seconds. Each day adds 10 seconds. The duration grows with your practice."
            )
            faqItem(
                q: "What are the blocks?",
                a: "Visual markers of time passing. Short sessions use 10-second blocks. Longer sessions use minute blocks with a final minute of 10-second blocks."
            )
            faqItem(
                q: "How does the app gate work?",
                a: "In Settings, choose apps for Still Point to hold. They stay blocked until you complete today's session, then open for the rest of the day and re-lock at midnight. Ending early keeps them blocked."
            )
            faqItem(
                q: "This app is incredibly boring. What's the point?",
                a: "That is the point."
            )
        }
    }

    private func faqItem(q: String, a: String) -> some View {
        VStack(alignment: .leading, spacing: SPSpacing.s1) {
            Text(q)
                .font(SPFont.serifItalic(16, weight: .medium))
                .foregroundStyle(Color(SPColor.fg2))
            Text(a)
                .font(SPFont.serif(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg3))
        }
    }
}

private struct AppGateOnboardingSheet: View {
    let appVM: AppViewModel
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: SPSpacing.s4) {
            Spacer()
            Image(systemName: "lock.shield")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(SPColor.greenText)
            Text("Block distracting apps until you meditate?")
                .font(SPFont.serifItalic(24, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .multilineTextAlignment(.center)
            Text("Pick a few apps for Still Point to hold. They stay blocked until you complete today's session, then open for the rest of the day and re-lock at midnight.")
                .font(SPFont.serif(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg3))
                .multilineTextAlignment(.center)
                .padding(.horizontal, SPSpacing.s4)
            Spacer()
            VStack(spacing: SPSpacing.s2) {
                Button {
                    isPresented = false
                    appVM.selectedTab = MainTab.settings.rawValue
                } label: {
                    Text("Choose apps")
                        .font(SPFont.mono(13, weight: .medium))
                        .spCapsuleButtonStyle(.greenSolid, size: .fullWidth, tall: true)
                }
                .accessibilityIdentifier("onboarding.appGate.chooseApps")

                Button {
                    isPresented = false
                } label: {
                    Text("Not now")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .padding(.vertical, SPSpacing.s2)
                }
                .accessibilityIdentifier("onboarding.appGate.notNow")
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.bottom, SPSpacing.s4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .stillPointBackground()
    }
}

private extension View {
    /// The rounded surface shared by Home's track cards and the dual-track fork card.
    func homeCardChrome() -> some View {
        let shape = RoundedRectangle(cornerRadius: 16)
        return background(SPColor.surface1)
            .clipShape(shape)
            .overlay(shape.stroke(SPColor.border1))
    }
}
