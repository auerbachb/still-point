import Foundation
import Testing
@testable import StillPointShared

/// #668 — the sound toggles must read as buttons with an unmistakable on/off state.
///
/// Ported to `src/lib/soundToggleAppearance.test.ts` so both clients assert the
/// same rules; keep the two files in step.
struct SoundToggleAppearanceTests {

    // MARK: - State is carried by more than colour

    @Test func testOnStateFillsThePillAndUsesTheSoundingIcon() {
        let appearance = SoundToggleAppearance.appearance(isOn: true)

        #expect(appearance.isFilled)
        #expect(appearance.hasProminentBorder)
        #expect(!appearance.isIconMuted)
        #expect(appearance.systemImageName == "speaker.wave.2.fill")
    }

    @Test func testOffStateDropsTheFillAndUsesTheMutedIcon() {
        let appearance = SoundToggleAppearance.appearance(isOn: false)

        #expect(!appearance.isFilled)
        #expect(!appearance.hasProminentBorder)
        #expect(appearance.isIconMuted)
        #expect(appearance.systemImageName == "speaker.slash.fill")
    }

    /// The acceptance criterion the restyle exists for: on and off must differ in
    /// fill, border, *and* icon — not in text colour alone. A regression that
    /// collapses the state onto one channel fails here.
    @Test func testEveryVisualChannelDistinguishesOnFromOff() {
        let on = SoundToggleAppearance.appearance(isOn: true)
        let off = SoundToggleAppearance.appearance(isOn: false)

        #expect(on.isFilled != off.isFilled)
        #expect(on.hasProminentBorder != off.hasProminentBorder)
        #expect(on.isIconMuted != off.isIconMuted)
        #expect(on.systemImageName != off.systemImageName)
    }

    // MARK: - Tap target

    @Test func testMinimumTapTargetMeetsTheHumanInterfaceGuidelines() {
        #expect(SoundToggleAppearance.minimumTapTarget >= 44)
    }

    // MARK: - Accessibility

    /// UI tests address the toggles by this identifier; the restyle must not move it.
    @Test func testAccessibilityIdentifierKeepsTheExistingFormat() {
        #expect(SoundToggleAppearance.accessibilityIdentifier(label: "tick") == "session.soundToggle.tick")
        #expect(SoundToggleAppearance.accessibilityIdentifier(label: "chime") == "session.soundToggle.chime")
        #expect(SoundToggleAppearance.accessibilityIdentifier(label: "voice") == "session.soundToggle.voice")
        #expect(SoundToggleAppearance.accessibilityIdentifier(label: "end") == "session.soundToggle.end")
    }

    /// WCAG 2.5.3: the accessible name starts with the word shown on the control,
    /// so voice control matches what a sighted user would say.
    @Test func testAccessibilityLabelStartsWithTheVisibleWord() {
        #expect(SoundToggleAppearance.accessibilityLabel(label: "tick") == "tick sound")
        #expect(SoundToggleAppearance.accessibilityLabel(label: "voice").hasPrefix("voice"))
    }

    @Test func testAccessibilityValueAnnouncesStateRatherThanRelyingOnColour() {
        #expect(SoundToggleAppearance.accessibilityValue(isOn: true) == "on")
        #expect(SoundToggleAppearance.accessibilityValue(isOn: false) == "off")
    }

    // MARK: - #712 haptic cue

    /// The audio cue is the default, so every existing call site keeps the
    /// speaker it has always drawn.
    @Test func testTheCueDefaultsToAudio() {
        #expect(SoundToggleAppearance.appearance(isOn: true).cue == .audio)
        #expect(SoundToggleAppearance.accessibilityLabel(label: "tick") == "tick sound")
    }

    /// A speaker glyph on the haptics pill would say the opposite of what the
    /// control does — its entire purpose is that nothing is heard.
    @Test func testHapticCueNeverBorrowsTheSpeakerGlyph() {
        let on = SoundToggleAppearance.appearance(isOn: true, cue: .haptic)
        let off = SoundToggleAppearance.appearance(isOn: false, cue: .haptic)

        #expect(on.systemImageName == "iphone.radiowaves.left.and.right")
        #expect(off.systemImageName == "iphone.slash")
        #expect(!on.systemImageName.contains("speaker"))
        #expect(!off.systemImageName.contains("speaker"))
    }

    /// The #668 acceptance criterion holds for the new cue too: on and off must
    /// differ in fill, border, *and* icon.
    @Test func testHapticCueStillDistinguishesOnFromOffOnEveryChannel() {
        let on = SoundToggleAppearance.appearance(isOn: true, cue: .haptic)
        let off = SoundToggleAppearance.appearance(isOn: false, cue: .haptic)

        #expect(on.isFilled != off.isFilled)
        #expect(on.hasProminentBorder != off.hasProminentBorder)
        #expect(on.isIconMuted != off.isIconMuted)
        #expect(on.systemImageName != off.systemImageName)
    }

    /// VoiceOver must not announce the haptics pill as a sound. The visible word
    /// still comes first, so WCAG 2.5.3 holds either way.
    @Test func testHapticAccessibilityLabelDoesNotClaimToBeASound() {
        let label = SoundToggleAppearance.accessibilityLabel(label: "haptics", cue: .haptic)

        #expect(label == "haptics feedback")
        #expect(label.hasPrefix("haptics"))
        #expect(!label.contains("sound"))
    }

    /// The identifier is cue-independent — UI tests address the new pill exactly
    /// the way they address the other four.
    @Test func testHapticAccessibilityIdentifierFollowsTheExistingFormat() {
        #expect(SoundToggleAppearance.accessibilityIdentifier(label: "haptics") == "session.soundToggle.haptics")
    }
}
