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
        let original = AudioEngine.SoundPrefs(tick: true, chime: false, completion: true, voiceCountdown: true)
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        XCTAssertEqual(original, decoded)
    }

    // MARK: - Defaults

    func testDefaultsMatchExpectedValues() {
        let d = AudioEngine.SoundPrefs.defaults
        XCTAssertFalse(d.tick)
        XCTAssertTrue(d.chime)
        XCTAssertTrue(d.completion)
        XCTAssertFalse(d.voiceCountdown)
    }
}
