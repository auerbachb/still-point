import XCTest
@testable import StillPointShared

/// #668 — the sound toggles must read as buttons with an unmistakable on/off state.
///
/// Ported to `src/lib/soundToggleAppearance.test.ts` so both clients assert the
/// same rules; keep the two files in step.
final class SoundToggleAppearanceTests: XCTestCase {

    // MARK: - State is carried by more than colour

    func testOnStateFillsThePillAndUsesTheSoundingIcon() {
        let appearance = SoundToggleAppearance.appearance(isOn: true)

        XCTAssertTrue(appearance.isFilled)
        XCTAssertTrue(appearance.hasProminentBorder)
        XCTAssertFalse(appearance.isIconMuted)
        XCTAssertEqual(appearance.systemImageName, "speaker.wave.2.fill")
    }

    func testOffStateDropsTheFillAndUsesTheMutedIcon() {
        let appearance = SoundToggleAppearance.appearance(isOn: false)

        XCTAssertFalse(appearance.isFilled)
        XCTAssertFalse(appearance.hasProminentBorder)
        XCTAssertTrue(appearance.isIconMuted)
        XCTAssertEqual(appearance.systemImageName, "speaker.slash.fill")
    }

    /// The acceptance criterion the restyle exists for: on and off must differ in
    /// fill, border, *and* icon — not in text colour alone. A regression that
    /// collapses the state onto one channel fails here.
    func testEveryVisualChannelDistinguishesOnFromOff() {
        let on = SoundToggleAppearance.appearance(isOn: true)
        let off = SoundToggleAppearance.appearance(isOn: false)

        XCTAssertNotEqual(on.isFilled, off.isFilled)
        XCTAssertNotEqual(on.hasProminentBorder, off.hasProminentBorder)
        XCTAssertNotEqual(on.isIconMuted, off.isIconMuted)
        XCTAssertNotEqual(on.systemImageName, off.systemImageName)
    }

    // MARK: - Tap target

    func testMinimumTapTargetMeetsTheHumanInterfaceGuidelines() {
        XCTAssertGreaterThanOrEqual(SoundToggleAppearance.minimumTapTarget, 44)
    }

    // MARK: - Accessibility

    /// UI tests address the toggles by this identifier; the restyle must not move it.
    func testAccessibilityIdentifierKeepsTheExistingFormat() {
        XCTAssertEqual(
            SoundToggleAppearance.accessibilityIdentifier(label: "tick"),
            "session.soundToggle.tick"
        )
        XCTAssertEqual(
            SoundToggleAppearance.accessibilityIdentifier(label: "chime"),
            "session.soundToggle.chime"
        )
        XCTAssertEqual(
            SoundToggleAppearance.accessibilityIdentifier(label: "voice"),
            "session.soundToggle.voice"
        )
        XCTAssertEqual(
            SoundToggleAppearance.accessibilityIdentifier(label: "end"),
            "session.soundToggle.end"
        )
    }

    /// WCAG 2.5.3: the accessible name starts with the word shown on the control,
    /// so voice control matches what a sighted user would say.
    func testAccessibilityLabelStartsWithTheVisibleWord() {
        XCTAssertEqual(SoundToggleAppearance.accessibilityLabel(label: "tick"), "tick sound")
        XCTAssertTrue(
            SoundToggleAppearance.accessibilityLabel(label: "voice").hasPrefix("voice")
        )
    }

    func testAccessibilityValueAnnouncesStateRatherThanRelyingOnColour() {
        XCTAssertEqual(SoundToggleAppearance.accessibilityValue(isOn: true), "on")
        XCTAssertEqual(SoundToggleAppearance.accessibilityValue(isOn: false), "off")
    }

    // MARK: - #712 haptic cue

    /// The audio cue is the default, so every existing call site keeps the
    /// speaker it has always drawn.
    func testTheCueDefaultsToAudio() {
        XCTAssertEqual(SoundToggleAppearance.appearance(isOn: true).cue, .audio)
        XCTAssertEqual(SoundToggleAppearance.accessibilityLabel(label: "tick"), "tick sound")
    }

    /// A speaker glyph on the haptics pill would say the opposite of what the
    /// control does — its entire purpose is that nothing is heard.
    func testHapticCueNeverBorrowsTheSpeakerGlyph() {
        let on = SoundToggleAppearance.appearance(isOn: true, cue: .haptic)
        let off = SoundToggleAppearance.appearance(isOn: false, cue: .haptic)

        XCTAssertEqual(on.systemImageName, "iphone.radiowaves.left.and.right")
        XCTAssertEqual(off.systemImageName, "iphone.slash")
        XCTAssertFalse(on.systemImageName.contains("speaker"))
        XCTAssertFalse(off.systemImageName.contains("speaker"))
    }

    /// The #668 acceptance criterion holds for the new cue too: on and off must
    /// differ in fill, border, *and* icon.
    func testHapticCueStillDistinguishesOnFromOffOnEveryChannel() {
        let on = SoundToggleAppearance.appearance(isOn: true, cue: .haptic)
        let off = SoundToggleAppearance.appearance(isOn: false, cue: .haptic)

        XCTAssertNotEqual(on.isFilled, off.isFilled)
        XCTAssertNotEqual(on.hasProminentBorder, off.hasProminentBorder)
        XCTAssertNotEqual(on.isIconMuted, off.isIconMuted)
        XCTAssertNotEqual(on.systemImageName, off.systemImageName)
    }

    /// VoiceOver must not announce the haptics pill as a sound. The visible word
    /// still comes first, so WCAG 2.5.3 holds either way.
    func testHapticAccessibilityLabelDoesNotClaimToBeASound() {
        let label = SoundToggleAppearance.accessibilityLabel(label: "haptics", cue: .haptic)

        XCTAssertEqual(label, "haptics feedback")
        XCTAssertTrue(label.hasPrefix("haptics"))
        XCTAssertFalse(label.contains("sound"))
    }

    /// The identifier is cue-independent — UI tests address the new pill exactly
    /// the way they address the other four.
    func testHapticAccessibilityIdentifierFollowsTheExistingFormat() {
        XCTAssertEqual(
            SoundToggleAppearance.accessibilityIdentifier(label: "haptics"),
            "session.soundToggle.haptics"
        )
    }
}
