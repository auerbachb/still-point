import AVFoundation
import SwiftUI
import StillPointShared
import UIKit

/// The Settings "SESSION" card: the long-session period (dual-track accounts only),
/// keep screen on, the session intro overlay, the hold-cluster hide preference, gaze
/// attention tracking, and ambient sound.
///
/// Owns the camera and microphone prompts and the three alerts they can raise.
/// Everything the parent's `syncFromCurrentUser()` writes is lifted in: the
/// long-session, gaze and ambient values with their in-flight flags, which the parent
/// folds into `isSavingSettings`, and the intro overlay's value, which it re-reads
/// from `SessionIntroPrefs`. Keep screen on and the hide preference bind straight to
/// `appVM`'s local stores. Those two and the intro overlay are not settings writes,
/// so they stay enabled while one is in flight.
struct SettingsSessionSection: View {
    let appVM: AppViewModel
    /// True while any Settings write is in flight. Disables the account-backed
    /// controls here, matching the rest of the screen.
    let isSavingSettings: Bool
    @Binding var longSessionPeriod: SessionPeriod
    @Binding var isUpdatingLongSessionPeriod: Bool
    @Binding var sessionIntroEnabled: Bool
    @Binding var attentionTrackingEnabled: Bool
    @Binding var isUpdatingAttentionTracking: Bool
    @Binding var ambientSoundEnabled: Bool
    @Binding var isUpdatingAmbientSound: Bool

    @State private var showAttentionUnsupportedAlert = false
    @State private var showAttentionPermissionDeniedAlert = false
    @State private var showAmbientSoundPermissionDeniedAlert = false

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SESSION")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if appVM.dualTrackEnabled {
                VStack(alignment: .leading, spacing: 2) {
                    Picker("Long session", selection: $longSessionPeriod) {
                        ForEach(SessionPeriod.allCases, id: \.self) { period in
                            Text(period.settingsLabel).tag(period)
                        }
                    }
                    .font(SPFont.mono(13))
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.longSessionPeriodPicker")
                    .onChange(of: longSessionPeriod) { _, newValue in
                        guard !isUpdatingLongSessionPeriod else { return }
                        guard appVM.currentUser?.longSessionPeriod != newValue else { return }
                        let previous = appVM.currentUser?.longSessionPeriod ?? .am
                        appVM.saveSettingsControl(
                            saving: $isUpdatingLongSessionPeriod,
                            send: { try await APIClient.shared.updateSettings(longSessionPeriod: newValue) },
                            revert: { longSessionPeriod = previous }
                        )
                    }
                    Text("The 10-minute track is this sitting. The shorter track is the other one. You can still do either sit at any time of day.")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }

            Toggle(isOn: Bindable(appVM).keepScreenAwakeDuringSession) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Keep screen on during session")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("On by default: prevents auto-lock while a sit timer is running. Turn it off to let the screen sleep as usual.")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
            .tint(SPColor.green)
            .accessibilityIdentifier("settings.keepScreenAwakeDuringSessionToggle")

            Toggle(isOn: $sessionIntroEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Session intro overlay")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("Show a brief intro before each session countdown begins")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
            .tint(SPColor.green)
            .accessibilityIdentifier("settings.sessionIntroToggle")
            .onChange(of: sessionIntroEnabled) { _, newValue in
                SessionIntroPrefs.setIntroOverlayHidden(!newValue)
            }

            // #526: local hide preference for distraction/hyperfocus hold cluster.
            Toggle(isOn: Bindable(appVM.trackingControlPrefsManager).hideDistractionHyperfocusControls) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hide distraction & hyperfocus controls")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("Remove hold buttons during solo sessions. The timer is unchanged.")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
            .tint(SPColor.green)
            .accessibilityIdentifier("settings.hideDistractionHyperfocusToggle")

            Toggle(isOn: $attentionTrackingEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Gaze attention tracking")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("Uses the front camera during sessions to log when your gaze leaves the screen. Off by default.")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
            .tint(SPColor.green)
            .disabled(isSavingSettings)
            .accessibilityIdentifier("settings.attentionTrackingToggle")
            .onChange(of: attentionTrackingEnabled) { _, newValue in
                guard !isUpdatingAttentionTracking else { return }
                guard appVM.currentUser?.attentionTrackingEnabled != newValue else { return }
                // The camera prompt runs inside the save, so it holds the save's
                // place in line while it is up (#697).
                appVM.saveSettingsControl(
                    saving: $isUpdatingAttentionTracking,
                    authorize: { await authorizeAttentionTracking(enabling: newValue) },
                    send: { try await APIClient.shared.updateSettings(attentionTrackingEnabled: newValue) },
                    revert: { attentionTrackingEnabled = !newValue }
                )
            }

            // #563: ambient sound level capture
            Toggle(isOn: $ambientSoundEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ambient sound level")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("Samples mic volume during solo sits to log quiet vs. loud environments. No audio is stored. Off by default.")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
            .tint(SPColor.green)
            .disabled(isSavingSettings)
            .accessibilityIdentifier("settings.ambientSoundToggle")
            .onChange(of: ambientSoundEnabled) { _, newValue in
                guard !isUpdatingAmbientSound else { return }
                guard appVM.currentUser?.ambientSoundEnabled != newValue else { return }
                // The microphone prompt runs inside the save, so it holds the save's
                // place in line while it is up (#697).
                appVM.saveSettingsControl(
                    saving: $isUpdatingAmbientSound,
                    authorize: { await authorizeAmbientSound(enabling: newValue) },
                    send: { try await APIClient.shared.updateSettings(ambientSoundEnabled: newValue) },
                    revert: { ambientSoundEnabled = !newValue }
                )
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(SPColor.border1)
        )
        .alert("Microphone access required", isPresented: $showAmbientSoundPermissionDeniedAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Ambient sound level tracking needs microphone access. Allow microphone access in Settings to enable this feature.")
        }
        .alert("Gaze tracking unavailable", isPresented: $showAttentionUnsupportedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This device does not support TrueDepth face tracking. Gaze attention tracking requires an iPhone or iPad with a front-facing TrueDepth camera.")
        }
        .alert("Camera access required", isPresented: $showAttentionPermissionDeniedAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Gaze attention tracking needs front camera access. Allow camera access in Settings to enable this feature.")
        }
    }

    /// Asks for the camera when tracking is being turned on; turning it off needs
    /// nothing. A device without TrueDepth, or a denied prompt, turns the toggle
    /// back off and raises the matching alert instead of saving.
    private func authorizeAttentionTracking(enabling: Bool) async -> Bool {
        guard enabling else { return true }
        let capability = await AttentionTrackingCapability.requestCameraAccessIfNeeded()
        switch capability {
        case .unsupported:
            attentionTrackingEnabled = false
            showAttentionUnsupportedAlert = true
            return false
        case .permissionDenied:
            attentionTrackingEnabled = false
            showAttentionPermissionDeniedAlert = true
            return false
        default:
            return true
        }
    }

    /// Asks for the microphone when ambient sound is being turned on; turning it off
    /// needs nothing. A denied prompt turns the toggle back off and raises the alert
    /// instead of saving.
    private func authorizeAmbientSound(enabling: Bool) async -> Bool {
        guard enabling else { return true }
        let granted = await AVAudioApplication.requestRecordPermission()
        if !granted {
            ambientSoundEnabled = false
            showAmbientSoundPermissionDeniedAlert = true
            return false
        }
        return true
    }
}
