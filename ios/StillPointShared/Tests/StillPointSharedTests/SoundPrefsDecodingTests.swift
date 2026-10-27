import Foundation
import Testing
@testable import StillPointShared

/// Guards the SoundPrefs custom decoder that merges over defaults.
/// Verifies that adding `voiceCountdown` does not wipe existing users'
/// persisted tick / chime / completion preferences on upgrade.
struct SoundPrefsDecodingTests {

    // MARK: - Legacy JSON migration

    @Test func testDecodeLegacyJSONWithoutVoiceCountdownPreservesExistingPrefs() throws {
        // Simulate JSON persisted before the voiceCountdown field existed.
        let legacyJSON = """
        {"tick":true,"chime":false,"completion":true}
        """
        let data = try #require(legacyJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(prefs.tick, "tick should be preserved from legacy JSON")
        #expect(!prefs.chime, "chime should be preserved from legacy JSON")
        #expect(prefs.completion, "completion should be preserved from legacy JSON")
        #expect(!prefs.voiceCountdown, "voiceCountdown should default to false when absent")
    }

    @Test func testDecodeLegacyJSONWithDefaultsOnlyReturnsDefaults() throws {
        // Empty JSON object: all fields absent → all fall back to the per-field defaults.
        let emptyJSON = "{}"
        let data = try #require(emptyJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(!prefs.tick)
        #expect(prefs.chime)
        #expect(prefs.completion)
        #expect(!prefs.voiceCountdown)
        #expect(!prefs.haptics)
    }

    // MARK: - Full round-trip

    @Test func testDecodeFullJSONWithVoiceCountdownTrue() throws {
        let json = """
        {"tick":false,"chime":true,"completion":false,"voiceCountdown":true}
        """
        let data = try #require(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(!prefs.tick)
        #expect(prefs.chime)
        #expect(!prefs.completion)
        #expect(prefs.voiceCountdown)
    }

    @Test func testDecodeFullJSONWithVoiceCountdownFalse() throws {
        let json = """
        {"tick":true,"chime":true,"completion":true,"voiceCountdown":false}
        """
        let data = try #require(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(prefs.tick)
        #expect(prefs.chime)
        #expect(prefs.completion)
        #expect(!prefs.voiceCountdown)
    }

    @Test func testEncodeDecodeRoundTrip() throws {
        let original = AudioEngine.SoundPrefs(
            tick: true, chime: false, completion: true, voiceCountdown: true, haptics: true
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        #expect(original == decoded)
    }

    // MARK: - #712 haptics

    /// The same upgrade guarantee `voiceCountdown` needed: someone who has been
    /// using the app has JSON without a `haptics` key, and reading it must not
    /// wipe the sound prefs they actually set.
    @Test func testDecodeJSONWithoutHapticsPreservesExistingPrefs() throws {
        let priorJSON = """
        {"tick":true,"chime":false,"completion":true,"voiceCountdown":true}
        """
        let data = try #require(priorJSON.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(prefs.tick, "tick should survive the haptics upgrade")
        #expect(!prefs.chime, "chime should survive the haptics upgrade")
        #expect(prefs.completion, "completion should survive the haptics upgrade")
        #expect(prefs.voiceCountdown, "voiceCountdown should survive the haptics upgrade")
        #expect(!prefs.haptics, "haptics is opt-in: absent means off")
    }

    @Test func testDecodeJSONWithHapticsTrue() throws {
        let json = """
        {"tick":false,"chime":true,"completion":true,"voiceCountdown":false,"haptics":true}
        """
        let data = try #require(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)

        #expect(prefs.haptics)
    }

    // MARK: - Defaults

    @Test func testDefaultsMatchExpectedValues() {
        let d = AudioEngine.SoundPrefs.defaults
        #expect(d.tick)
        #expect(d.chime)
        #expect(d.completion)
        #expect(!d.voiceCountdown)
        // #712: a phone that has never been asked to vibrate must not start.
        #expect(!d.haptics)
    }
}
