import SwiftUI
#if !targetEnvironment(simulator)
import FamilyControls
#endif

struct AppBlockingSettingsView: View {
    @Bindable var manager: AppBlockingManager
    @State private var showPicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s3) {
            VStack(alignment: .leading, spacing: SPSpacing.s1) {
                Text("APP GATE")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(2)

                Text("Pick apps to hold behind today's sit.")
                    .font(SPFont.serif(15, weight: .light))
                    .foregroundStyle(Color(SPColor.fg3))
            }

            VStack(alignment: .leading, spacing: SPSpacing.s1) {
                Text(manager.statusText)
                    .font(SPFont.mono(12))
                    .foregroundStyle(Color(SPColor.fg2))
                    .accessibilityIdentifier("appBlocking.statusText")

                Text("A completed timer unlocks them for \(manager.unlockWindowText). Ending early keeps the gate closed.")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }

            if let error = manager.lastErrorMessage {
                Text(error)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
                    .accessibilityIdentifier("appBlocking.errorText")
            }

            HStack(spacing: SPSpacing.s2) {
                Button {
                    Task {
                        await manager.requestAuthorizationIfNeeded()
                        if manager.isAuthorizationApproved {
                            showPicker = true
                        }
                    }
                } label: {
                    Text(manager.hasSelection ? "Edit blocked apps" : "Choose apps")
                        .font(SPFont.mono(13, weight: .medium))
                        .foregroundStyle(Color(SPColor.bg))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.green)
                        .clipShape(Capsule())
                }
                .accessibilityIdentifier("appBlocking.chooseAppsButton")

                if manager.hasSelection && !manager.isUnlocked {
                    Text("\(manager.selectedItemCount)")
                        .font(SPFont.mono(13, weight: .medium))
                        .foregroundStyle(SPColor.amberText)
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.amberBgFaint)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.amberBorderSubtle))
                        .accessibilityIdentifier("appBlocking.selectedCount")
                }
            }

            if manager.isUnlocked {
                Button {
                    manager.lockNow()
                } label: {
                    Text("Lock now")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(SPColor.amberText)
                }
                .accessibilityIdentifier("appBlocking.lockNowButton")
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(manager.hasSelection && !manager.isUnlocked ? SPColor.amberBorderSubtle : SPColor.border1)
        )
        #if !targetEnvironment(simulator)
        .familyActivityPicker(isPresented: $showPicker, selection: $manager.selection)
        #endif
        .onChange(of: showPicker) { _, isPresented in
            if !isPresented {
                manager.persistSelectionAndRefreshShielding()
            }
        }
        .onAppear {
            manager.refreshShielding()
        }
    }
}
