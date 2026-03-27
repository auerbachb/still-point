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
                }
            } else {
                switch appVM.currentView {
                case .auth:
                    AuthView(appVM: appVM)
                        .transition(.opacity)

                case .session:
                    SessionView(appVM: appVM)
                        .transition(.opacity)

                case .completion(let clearPercent, let thoughtCount, let thoughts, let dayNumber, let duration):
                    CompletionView(
                        appVM: appVM,
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
        }
        .animation(.easeInOut(duration: 0.3), value: appVM.currentView)
        .task {
            await appVM.checkAuth()
        }
    }
}
