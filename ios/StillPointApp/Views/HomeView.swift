import SwiftUI
import StillPointShared

struct HomeView: View {
    let appVM: AppViewModel

    @State private var breatheAnimation = false
    @State private var showAppGateOnboarding = false

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                // Welcome header
                if let username = appVM.currentUser?.username {
                    Text("WELCOME, \(username.uppercased())")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(3)
                        .padding(.top, SPSpacing.s4)
                }

                Spacer().frame(height: SPSpacing.s4)

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

                appGatePill

                Spacer().frame(height: SPSpacing.s4)

                // Begin button
                VStack(spacing: SPSpacing.s2) {
                    Button {
                        withAnimation {
                            appVM.beginSession()
                        }
                    } label: {
                        Text("Begin")
                            .font(SPFont.serifItalic(22, weight: .light))
                            .foregroundStyle(Color(SPColor.fg))
                            .padding(.horizontal, 48)
                            .padding(.vertical, SPSpacing.s3)
                            .background(SPColor.surface2)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.border2))
                    }
                    .accessibilityIdentifier("home.beginButton")
                    .accessibilityLabel("Start session")

                    Button {
                        withAnimation {
                            appVM.beginSession(type: .quick)
                        }
                    } label: {
                        Text("Quick minute · \(StillPoint.quickDuration)s")
                            .font(SPFont.mono(11, weight: .medium))
                            .tracking(1.4)
                            .foregroundStyle(SPColor.greenText)
                            .padding(.horizontal, 24)
                            .padding(.vertical, SPSpacing.s2)
                            .background(SPColor.greenBgFaint)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.greenBorderSubtle))
                    }
                    .accessibilityIdentifier("home.quickMinuteButton")
                    .accessibilityLabel("Start quick minute")

                    Button {
                        withAnimation {
                            appVM.beginBreathCounting()
                        }
                    } label: {
                        Text("Breath counting")
                            .font(SPFont.mono(11, weight: .medium))
                            .tracking(1.4)
                            .foregroundStyle(Color(SPColor.fg3))
                            .padding(.horizontal, 24)
                            .padding(.vertical, SPSpacing.s2)
                            .background(SPColor.surface1)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.border1))
                    }
                    .accessibilityIdentifier("home.breathCountingButton")
                    .accessibilityLabel("Start breath counting")

                    Button {
                        withAnimation {
                            appVM.beginBuddySession()
                        }
                    } label: {
                        Text("Meditate with a friend")
                            .font(SPFont.serifItalic(18, weight: .light))
                            .foregroundStyle(Color(SPColor.fg2))
                            .padding(.horizontal, 32)
                            .padding(.vertical, SPSpacing.s2)
                            .background(SPColor.surface1)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.border1))
                    }
                    .accessibilityIdentifier("home.buddySessionButton")
                }

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

    /// Persistent app-gate status indicator. Hidden until the user has picked apps
    /// to block; tapping jumps to the Settings tab where the gate is configured.
    @ViewBuilder
    private var appGatePill: some View {
        let manager = appVM.appBlockingManager
        if manager.hasSelection {
            Button {
                appVM.selectedTab = 4
            } label: {
                HStack(spacing: SPSpacing.s2) {
                    Image(systemName: manager.isUnlocked ? "lock.open" : "lock")
                        .font(.system(size: 11, weight: .medium))
                    Text(manager.isUnlocked ? "Apps unlocked until midnight" : "Apps locked — meditate to unlock")
                        .font(SPFont.mono(11, weight: .medium))
                        .tracking(1)
                }
                .foregroundStyle(manager.isUnlocked ? SPColor.greenText : SPColor.amberText)
                .padding(.horizontal, SPSpacing.s3)
                .padding(.vertical, SPSpacing.s2)
                .background(manager.isUnlocked ? SPColor.greenBgFaint : SPColor.amberBgFaint)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(manager.isUnlocked ? SPColor.greenBorderSubtle : SPColor.amberBorderSubtle)
                )
            }
            .accessibilityIdentifier("home.appGatePill")
            .accessibilityLabel(manager.isUnlocked ? "Apps unlocked until midnight" : "Apps locked, meditate to unlock")
        }
    }

    /// First-run prompt asking whether to set up the app gate. Shown at most once,
    /// and never during UI tests (it would block the home screen).
    private func maybePresentAppGateOnboarding() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
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
                    appVM.selectedTab = 4
                } label: {
                    Text("Choose apps")
                        .font(SPFont.mono(13, weight: .medium))
                        .foregroundStyle(Color(SPColor.bg))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SPSpacing.s3)
                        .background(SPColor.green)
                        .clipShape(Capsule())
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
