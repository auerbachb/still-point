import Foundation

/// Pure decision logic for the mid-session sound toggles (tick / chime / end / voice).
///
/// A sit can begin with every sound off, which leaves the shared audio session
/// inactive — nothing ever called `AudioEngine.warmUp()`. Re-enabling a sound
/// mid-sit then had nothing to play through and stayed silent for the rest of the
/// session (#667). Any off→on transition must reactivate the audio session so the
/// next scheduled sound is audible without restarting the sit.
///
/// Free of AVFoundation / UIKit so it compiles and runs under `swift test` on macOS.
public enum SoundToggleLogic {

    /// The audio side effects a single toggle requires.
    public struct Effects: Equatable {
        /// Reactivate the audio session so the next sound is audible (#667).
        public let warmUp: Bool
        /// Prime the voice-countdown buffer cache.
        public let preloadVoiceCountdown: Bool
        /// Stop any in-flight voice-countdown clip.
        public let cancelVoiceCountdown: Bool
        /// Clear the announced-second dedup so re-enabling during the same
        /// remaining second announces correctly (#554).
        public let resetVoiceDedup: Bool

        public init(
            warmUp: Bool,
            preloadVoiceCountdown: Bool,
            cancelVoiceCountdown: Bool,
            resetVoiceDedup: Bool
        ) {
            self.warmUp = warmUp
            self.preloadVoiceCountdown = preloadVoiceCountdown
            self.cancelVoiceCountdown = cancelVoiceCountdown
            self.resetVoiceDedup = resetVoiceDedup
        }
    }

    /// Computes the side effects for one toggle.
    ///
    /// The toggled-key parameters describe whichever of the four sounds the user
    /// tapped; the `voiceCountdown` parameters describe the voice pref before and
    /// after the same toggle. When voice itself is the toggled key both pairs
    /// carry the same values.
    ///
    /// - Parameters:
    ///   - toggledKeyWasEnabled: Value of the toggled pref before the tap.
    ///   - toggledKeyIsEnabled: Value of the toggled pref after the tap.
    ///   - voiceCountdownWasEnabled: Value of `voiceCountdown` before the tap.
    ///   - voiceCountdownIsEnabled: Value of `voiceCountdown` after the tap.
    /// - Returns: The side effects the caller must apply, in `warmUp` →
    ///   `preloadVoiceCountdown` → dedup-reset → cancel order.
    public static func effects(
        toggledKeyWasEnabled: Bool,
        toggledKeyIsEnabled: Bool,
        voiceCountdownWasEnabled: Bool,
        voiceCountdownIsEnabled: Bool
    ) -> Effects {
        // #667: only an off→on transition needs the audio session reactivated.
        // Turning a sound off must stay a pure preference write.
        let didEnable = !toggledKeyWasEnabled && toggledKeyIsEnabled
        let voiceDidEnable = !voiceCountdownWasEnabled && voiceCountdownIsEnabled
        let voiceDidDisable = voiceCountdownWasEnabled && !voiceCountdownIsEnabled

        return Effects(
            warmUp: didEnable,
            preloadVoiceCountdown: voiceDidEnable,
            // #554: disabling voice stops the in-flight clip and clears the dedup
            // so a re-enable inside the same remaining second still announces.
            cancelVoiceCountdown: voiceDidDisable,
            resetVoiceDedup: voiceDidDisable
        )
    }
}
