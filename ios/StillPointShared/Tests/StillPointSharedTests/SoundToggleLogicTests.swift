import Foundation
import Testing
@testable import StillPointShared

struct SoundToggleLogicTests {

    /// Convenience for the three non-voice sounds: the toggled key changes while
    /// `voiceCountdown` stays put.
    private func effectsForNonVoiceToggle(
        wasEnabled: Bool,
        voiceCountdown: Bool = false
    ) -> SoundToggleLogic.Effects {
        SoundToggleLogic.effects(
            toggledKeyWasEnabled: wasEnabled,
            toggledKeyIsEnabled: !wasEnabled,
            voiceCountdownWasEnabled: voiceCountdown,
            voiceCountdownIsEnabled: voiceCountdown
        )
    }

    /// Convenience for the voice toggle itself: both pairs move together.
    private func effectsForVoiceToggle(wasEnabled: Bool) -> SoundToggleLogic.Effects {
        SoundToggleLogic.effects(
            toggledKeyWasEnabled: wasEnabled,
            toggledKeyIsEnabled: !wasEnabled,
            voiceCountdownWasEnabled: wasEnabled,
            voiceCountdownIsEnabled: !wasEnabled
        )
    }

    // MARK: - warmUp (#667)

    @Test func testOffToOnTransitionWarmsUp() {
        #expect(effectsForNonVoiceToggle(wasEnabled: false).warmUp)
    }

    @Test func testOnToOffTransitionDoesNotWarmUp() {
        #expect(!effectsForNonVoiceToggle(wasEnabled: true).warmUp)
    }

    /// All four toggles route through the single `toggleSound` path, so one
    /// decision function has to cover tick, chime, end, and voice alike.
    @Test func testEveryKeyWarmsUpOnEnableAndNotOnDisable() {
        // tick / chime / end: voiceCountdown is untouched by the toggle.
        for voiceState in [false, true] {
            #expect(
                effectsForNonVoiceToggle(wasEnabled: false, voiceCountdown: voiceState).warmUp,
                "off→on must warm up (voiceCountdown = \(voiceState))"
            )
            #expect(
                !effectsForNonVoiceToggle(wasEnabled: true, voiceCountdown: voiceState).warmUp,
                "on→off must not warm up (voiceCountdown = \(voiceState))"
            )
        }

        // voice: the toggled key and voiceCountdown move together.
        #expect(effectsForVoiceToggle(wasEnabled: false).warmUp)
        #expect(!effectsForVoiceToggle(wasEnabled: true).warmUp)
    }

    @Test func testNoTransitionDoesNotWarmUp() {
        // Defensive: identical before/after values are not an off→on transition.
        let unchanged = SoundToggleLogic.effects(
            toggledKeyWasEnabled: true,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: true,
            voiceCountdownIsEnabled: true
        )
        #expect(!unchanged.warmUp)
        #expect(!unchanged.preloadVoiceCountdown)
        #expect(!unchanged.cancelVoiceCountdown)
        #expect(!unchanged.resetVoiceDedup)
    }

    // MARK: - Voice countdown (#554 behavior preserved)

    @Test func testVoiceOffToOnPreloadsAndDoesNotResetDedup() {
        let effects = effectsForVoiceToggle(wasEnabled: false)
        #expect(effects.preloadVoiceCountdown)
        #expect(!effects.cancelVoiceCountdown)
        #expect(!effects.resetVoiceDedup)
    }

    @Test func testVoiceOnToOffCancelsAndResetsDedup() {
        let effects = effectsForVoiceToggle(wasEnabled: true)
        #expect(effects.cancelVoiceCountdown)
        #expect(effects.resetVoiceDedup)
        #expect(!effects.preloadVoiceCountdown)
    }

    @Test func testTogglingANonVoiceSoundLeavesVoiceEffectsUntouched() {
        // Enabling tick while voice is already on must not re-preload or cancel it.
        let whileVoiceOn = effectsForNonVoiceToggle(wasEnabled: false, voiceCountdown: true)
        #expect(whileVoiceOn.warmUp)
        #expect(!whileVoiceOn.preloadVoiceCountdown)
        #expect(!whileVoiceOn.cancelVoiceCountdown)
        #expect(!whileVoiceOn.resetVoiceDedup)

        // Disabling tick while voice is off must be a no-op beyond the pref write.
        let whileVoiceOff = effectsForNonVoiceToggle(wasEnabled: true, voiceCountdown: false)
        #expect(
            whileVoiceOff == SoundToggleLogic.Effects(
                warmUp: false,
                preloadVoiceCountdown: false,
                cancelVoiceCountdown: false,
                resetVoiceDedup: false
            )
        )
    }

    // MARK: - Rapid toggling

    @Test func testRapidOffOnOffOnSequenceWarmsOnlyOnEnables() {
        // Simulates four fast taps on the same control starting from off.
        var enabled = false
        var warmUps = 0
        for _ in 0..<4 {
            let effects = effectsForNonVoiceToggle(wasEnabled: enabled)
            if effects.warmUp { warmUps += 1 }
            enabled.toggle()
        }
        // off→on, on→off, off→on, on→off ⇒ exactly two warm-ups.
        #expect(warmUps == 2)
    }

    // MARK: - #712 haptics is not an audio channel

    /// Turning haptics on must not activate the audio session. The pill exists
    /// for someone who wants silence, and an AVAudioSession activation is not a
    /// harmless no-op on iOS — it can duck or interrupt whatever else the phone
    /// is playing. Enabling vibration should never touch their music.
    @Test func testEnablingHapticsDoesNotWarmTheAudioSession() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: false,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false,
            toggledKeyUsesAudio: false
        )

        #expect(!effects.warmUp, "haptics needs no audio session")
        #expect(!effects.preloadVoiceCountdown)
        #expect(!effects.cancelVoiceCountdown)
        #expect(!effects.resetVoiceDedup)
    }

    /// The guard above must be specific to the non-audio toggle — the same
    /// off→on transition on a real sound still has to warm up (#667).
    @Test func testTheAudioDefaultStillWarmsUpOnEnable() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: false,
            toggledKeyIsEnabled: true,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false
        )

        #expect(effects.warmUp, "audio toggles keep the #667 warm-up")
    }

    @Test func testDisablingHapticsStaysAPurePreferenceWrite() {
        let effects = SoundToggleLogic.effects(
            toggledKeyWasEnabled: true,
            toggledKeyIsEnabled: false,
            voiceCountdownWasEnabled: false,
            voiceCountdownIsEnabled: false,
            toggledKeyUsesAudio: false
        )

        #expect(!effects.warmUp)
    }
}
