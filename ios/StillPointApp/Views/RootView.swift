import SwiftUI
import StillPointShared

struct RootView: View {
    @State private var appVM = AppViewModel()

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()

            if appVM.isLoading {
                // Loading state — brand lockup
                VStack(spacing: SPSpacing.s2) {
                    Text("Still Point")
                        .font(SPFont.brandTitle)
                        .foregroundStyle(Color(SPColor.fg))
                    Text("ATTENTION TRAINING")
                        .font(SPFont.brandSubtitle)
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(4)
                    if let authStatusMessage = appVM.authStatusMessage {
                        Text(authStatusMessage)
                            .font(SPFont.mono(12))
                            .foregroundStyle(SPColor.dangerMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, SPSpacing.s4)
                            .padding(.top, SPSpacing.s3)
                            .accessibilityIdentifier("root.authStatusMessage")
                    }
                }
            } else {
                switch appVM.currentView {
                case .auth:
                    AuthView(appVM: appVM, launchAuthStatusMessage: appVM.authStatusMessage)
                        .transition(.opacity)

                case .session:
                    SessionView(appVM: appVM)
                        .transition(.opacity)

                case .buddyHub:
                    BuddySessionHubView(appVM: appVM)
                        .transition(.opacity)

                case .buddySession(let sessionId):
                    BuddySessionContainerView(appVM: appVM, sessionId: sessionId)
                        .id(sessionId)
                        .transition(.opacity)

                case .completion(let sessionId, let clearPercent, let thoughtCount, let thoughts, let dayNumber, let duration):
                    CompletionView(
                        appVM: appVM,
                        sessionId: sessionId,
                        clearPercent: clearPercent,
                        thoughtCount: thoughtCount,
                        thoughts: thoughts,
                        dayNumber: dayNumber,
                        duration: duration
                    )
                    .transition(.opacity)

                default:
                    MainTabView(appVM: appVM)
                        .transition(.opacity)
                }
            }

            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier("root.currentView.\(viewAccessibilitySlug)")
                .accessibilityValue(coldStartMetricAccessibilityValue)
        }
        .animation(.easeInOut(duration: 0.3), value: appVM.currentView)
        .task {
            await appVM.checkAuth()
        }
        .onOpenURL { url in
            appVM.handleIncomingURL(url)
        }
    }

    private var viewAccessibilitySlug: String {
        switch appVM.currentView {
        case .auth:
            return "auth"
        case .home:
            return "home"
        case .session:
            return "session"
        case .buddyHub:
            return "buddyHub"
        case .buddySession:
            return "buddySession"
        case .completion:
            return "completion"
        case .history:
            return "history"
        case .journal:
            return "journal"
        case .board:
            return "board"
        case .settings:
            return "settings"
        }
    }

    private var coldStartMetricAccessibilityValue: String {
        guard let ms = appVM.lastColdStartAuthCheckMs else { return "coldStartAuthCheckMs=unknown" }
        return "coldStartAuthCheckMs=\(ms)"
    }
}
