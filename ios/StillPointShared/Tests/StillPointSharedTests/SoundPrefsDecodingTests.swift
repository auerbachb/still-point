import XCTest
@testable import StillPointShared

/// Guards the SoundPrefs custom decoder that merges over defaults.
/// Verifies that adding `voiceCountdown` does not wipe existing users'
/// persisted tick / chime / completion preferences on upgrade.
final class SoundPrefsDecodingTests: XCTestCase {

    // MARK: - Legacy JSON migration

    func testDecodeLegacyJSONWithoutVoiceCountdownPreservesExistingPrefs() throws {
        // Simulate JSON persisted before the voiceCountdown field existed.
        let legacyJSON = """
        {"tick":true,"chime":false,"completion":true}
        """
        let data = try XCTUnwrap(legacyJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertTrue(prefs.tick,        "tick should be preserved from legacy JSON")
        XCTAssertFalse(prefs.chime,      "chime should be preserved from legacy JSON")
        XCTAssertTrue(prefs.completion,  "completion should be preserved from legacy JSON")
        XCTAssertFalse(prefs.voiceCountdown, "voiceCountdown should default to false when absent")
    }

    func testDecodeLegacyJSONWithDefaultsOnlyReturnsDefaults() throws {
        // Empty JSON object: all fields absent → all fall back to the per-field defaults.
        let emptyJSON = "{}"
        let data = try XCTUnwrap(emptyJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertFalse(prefs.tick)
        XCTAssertTrue(prefs.chime)
        XCTAssertTrue(prefs.completion)
        XCTAssertFalse(prefs.voiceCountdown)
        XCTAssertFalse(prefs.haptics)
    }

    // MARK: - Full round-trip

    func testDecodeFullJSONWithVoiceCountdownTrue() throws {
        let json = """
        {"tick":false,"chime":true,"completion":false,"voiceCountdown":true}
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertFalse(prefs.tick)
        XCTAssertTrue(prefs.chime)
        XCTAssertFalse(prefs.completion)
        XCTAssertTrue(prefs.voiceCountdown)
    }

    func testDecodeFullJSONWithVoiceCountdownFalse() throws {
        let json = """
        {"tick":true,"chime":true,"completion":true,"voiceCountdown":false}
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertTrue(prefs.tick)
        XCTAssertTrue(prefs.chime)
        XCTAssertTrue(prefs.completion)
        XCTAssertFalse(prefs.voiceCountdown)
    }

    func testEncodeDecodeRoundTrip() throws {
        let original = AudioEngine.SoundPrefs(
            tick: true, chime: false, completion: true, voiceCountdown: true, haptics: true
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        XCTAssertEqual(original, decoded)
    }

    // MARK: - #712 haptics

    /// The same upgrade guarantee `voiceCountdown` needed: someone who has been
    /// using the app has JSON without a `haptics` key, and reading it must not
    /// wipe the sound prefs they actually set.
    func testDecodeJSONWithoutHapticsPreservesExistingPrefs() throws {
        let priorJSON = """
        {"tick":true,"chime":false,"completion":true,"voiceCountdown":true}
        """
        let data = try XCTUnwrap(priorJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertTrue(prefs.tick,           "tick should survive the haptics upgrade")
        XCTAssertFalse(prefs.chime,         "chime should survive the haptics upgrade")
        XCTAssertTrue(prefs.completion,     "completion should survive the haptics upgrade")
        XCTAssertTrue(prefs.voiceCountdown, "voiceCountdown should survive the haptics upgrade")
        XCTAssertFalse(prefs.haptics,       "haptics is opt-in: absent means off")
    }

    func testDecodeJSONWithHapticsTrue() throws {
        let json = """
        {"tick":false,"chime":true,"completion":true,"voiceCountdown":false,"haptics":true}
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        XCTAssertTrue(prefs.haptics)
    }

    // MARK: - Defaults

    func testDefaultsMatchExpectedValues() {
        let d = AudioEngine.SoundPrefs.defaults
        XCTAssertFalse(d.tick)
        XCTAssertTrue(d.chime)
        XCTAssertTrue(d.completion)
        XCTAssertFalse(d.voiceCountdown)
        // #712: a phone that has never been asked to vibrate must not start.
        XCTAssertFalse(d.haptics)
    }
}
