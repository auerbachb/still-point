import SwiftUI
import StillPointShared

struct HomeView: View {
    let appVM: AppViewModel

    @State private var breatheAnimation = false

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
                a: "In Settings, choose apps for Still Point to hold. They stay blocked until you complete the timer, then open for two hours. Ending early keeps them blocked."
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
