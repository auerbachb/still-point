import Foundation

/// When a voice-countdown clip that is still playing gives way to the next one,
/// and which voice player the next one plays on (#941). The stop rule mirrors
/// web's `playVoiceCountdown` in `src/lib/audio.ts` (#922).
///
/// The countdown steps once a second, and several bundled clips still speak
/// past 1 s ("27" runs to 1.15 s), so the clip from the second before plays
/// out. Only a clip that started less than `voiceBurstWindowSeconds` before the
/// next one stops: it belongs to a burst — a late entry into the final minute, a
/// clock that jumped, a clip that loaded late — and the newer number is the
/// right one.
///
/// Free of AVFoundation dependencies — testable on macOS with `swift test`.
public enum VoiceBurstLogic {

    /// A clip that started less than this long before the next one stops for it.
    /// Mirrors `VOICE_BURST_WINDOW_S` in `src/lib/audio.ts`.
    public static let voiceBurstWindowSeconds: TimeInterval = 0.5

    /// Voice players `AudioEngine` keeps, so every clip outside the burst
    /// window plays out while later ones start, as on web. A new clip stops
    /// any clip that started less than `voiceBurstWindowSeconds` before it, so
    /// the clips still holding a player started at least that far apart. When
    /// all four hold one, the clip that started first is at least 2 s old, and
    /// the longest bundled clip lasts 1.7 s, so it has always ended.
    public static let playerCount = 4

    /// Whether a clip that started at `startedAt` stops when the next one starts
    /// at `nextStart`. Same comparison as web's
    /// `stopVoiceSources(now - VOICE_BURST_WINDOW_S)`, so a clip exactly
    /// `voiceBurstWindowSeconds` old plays out.
    public static func shouldStopClip(
        startedAt: TimeInterval,
        whenNextStartsAt nextStart: TimeInterval
    ) -> Bool {
        startedAt > nextStart - voiceBurstWindowSeconds
    }

    /// What starting one new clip does to the voice players.
    public struct Plan: Equatable {
        /// Players whose clip stops before the new one starts.
        public let stop: [Int]
        /// Player the new clip plays on. It replaces whatever that player
        /// still holds.
        public let playOn: Int

        public init(stop: [Int], playOn: Int) {
            self.stop = stop
            self.playOn = playOn
        }
    }

    /// The clip each voice player holds, by start time. Times come from the
    /// monotonic clock the caller reads for `start(at:)` and `moveStart(of:to:)`.
    public struct Clips {
        /// When each player's clip started, or nil while the player is free.
        private var startTimes: [TimeInterval?] = Array(
            repeating: nil,
            count: VoiceBurstLogic.playerCount
        )

        public init() {}

        /// Records a clip that starts at `now` and returns how to play it.
        ///
        /// Every clip inside the burst window stops and frees its player. The
        /// new clip takes the first free player or, when every player holds a
        /// clip, the one whose clip started first, which has already ended
        /// (see `playerCount`).
        public mutating func start(at now: TimeInterval) -> Plan {
            var stop: [Int] = []
            for (player, startedAt) in startTimes.enumerated() {
                guard let startedAt,
                      VoiceBurstLogic.shouldStopClip(startedAt: startedAt, whenNextStartsAt: now) else {
                    continue
                }
                stop.append(player)
                startTimes[player] = nil
            }
            // A free player sorts before any clip, and ties keep the lowest index.
            let playOn = startTimes.indices.min {
                (startTimes[$0] ?? -.infinity) < (startTimes[$1] ?? -.infinity)
            } ?? 0
            startTimes[playOn] = now
            return Plan(stop: stop, playOn: playOn)
        }

        /// Moves the start of the clip on `player` to `now`, for a clip that
        /// began to play later than `start(at:)` recorded. `AudioEngine` plans
        /// a clip before it restarts a stopped engine, which can take a while,
        /// and the next clip's burst window has to count from when this one
        /// really started. A player that holds no clip stays free.
        public mutating func moveStart(of player: Int, to now: TimeInterval) {
            guard startTimes.indices.contains(player), startTimes[player] != nil else { return }
            startTimes[player] = now
        }

        /// Frees every player and returns the ones that held a clip, so a
        /// cancel stops all of them at once.
        public mutating func stopAll() -> [Int] {
            let holding = startTimes.indices.filter { startTimes[$0] != nil }
            startTimes = Array(repeating: nil, count: startTimes.count)
            return holding
        }
    }
}
