import Foundation

// MARK: - Block Definitions (matches web BlockTimer.tsx)

public struct BlockDef: Identifiable, Sendable {
    public let id: String
    public let duration: Int
    public let startTime: Int
    public let label: String
    public let type: BlockType

    public enum BlockType: Sendable {
        case minute
        case second
    }
}

public enum SessionLogic {

    /// Whether this duration should render/use minute-sized blocks before final ten-second blocks.
    public static func usesMinuteBlocks(totalSeconds: Int) -> Bool {
        totalSeconds > 120
    }

    /// Number of full 60-second blocks before the final-minute ten-second blocks.
    public static func minuteBlockCount(totalSeconds: Int) -> Int {
        guard usesMinuteBlocks(totalSeconds: totalSeconds) else { return 0 }
        let fullMinutes = totalSeconds / 60
        let remainingSeconds = totalSeconds % 60
        return remainingSeconds > 0 ? fullMinutes : fullMinutes - 1
    }

    /// Highest completed minute-block index at a given elapsed time.
    /// Returns -1 when no minute block is completed yet or minute blocks are not in use.
    public static func completedMinuteBlockIndex(elapsed: Double, totalSeconds: Int) -> Int {
        let count = minuteBlockCount(totalSeconds: totalSeconds)
        guard count > 0 else { return -1 }
        let rawIndex = Int(floor(elapsed / 60.0)) - 1
        return min(count - 1, rawIndex)
    }

    /// Chime count for a completed minute block.
    /// Returns nil when there is less than one full minute left (including final-minute ten-second blocks).
    public static func chimeCountForCompletedMinuteBlock(
        blockIndex: Int,
        totalSeconds: Int
    ) -> Int? {
        guard blockIndex >= 0 else { return nil }
        let blockEnd = (blockIndex + 1) * 60
        let chimeCount = (totalSeconds - blockEnd) / 60
        return chimeCount >= 1 ? chimeCount : nil
    }

    public struct MinuteChimeUpdate: Sendable, Equatable {
        public let updatedCompletedBlockIndex: Int
        public let chimeCount: Int?
    }

    /// Advances minute-block completion and returns optional chime payload.
    /// This should run regardless of mute state so progress does not replay after unmute.
    public static func nextMinuteChimeUpdate(
        elapsed: Double,
        totalSeconds: Int,
        lastCompletedBlockIndex: Int
    ) -> MinuteChimeUpdate {
        let completedBlockIndex = completedMinuteBlockIndex(elapsed: elapsed, totalSeconds: totalSeconds)
        guard completedBlockIndex > lastCompletedBlockIndex else {
            return MinuteChimeUpdate(
                updatedCompletedBlockIndex: lastCompletedBlockIndex,
                chimeCount: nil
            )
        }

        return MinuteChimeUpdate(
            updatedCompletedBlockIndex: completedBlockIndex,
            chimeCount: chimeCountForCompletedMinuteBlock(
                blockIndex: completedBlockIndex,
                totalSeconds: totalSeconds
            )
        )
    }

    /// Build block definitions for a session of given duration.
    /// Matches the web app's BlockTimer.tsx block-building algorithm exactly.
    public static func buildBlocks(totalSeconds: Int) -> [BlockDef] {
        let useMinuteBlocks = usesMinuteBlocks(totalSeconds: totalSeconds)
        var blocks: [BlockDef] = []

        if useMinuteBlocks {
            let minuteBlockCount = minuteBlockCount(totalSeconds: totalSeconds)

            for i in 0..<minuteBlockCount {
                blocks.append(BlockDef(
                    id: "minute-\(i * 60)",
                    duration: 60,
                    startTime: i * 60,
                    label: "\(i + 1)m",
                    type: .minute
                ))
            }

            let lastMinuteStart = minuteBlockCount * 60
            let lastMinuteDuration = totalSeconds - lastMinuteStart
            let tenSecCount = Int(ceil(Double(lastMinuteDuration) / Double(StillPoint.blockDuration)))

            for i in 0..<tenSecCount {
                blocks.append(BlockDef(
                    id: "second-\(lastMinuteStart + i * StillPoint.blockDuration)",
                    duration: StillPoint.blockDuration,
                    startTime: lastMinuteStart + i * StillPoint.blockDuration,
                    label: "\((i + 1) * StillPoint.blockDuration)s",
                    type: .second
                ))
            }
        } else {
            let totalBlocks = Int(ceil(Double(totalSeconds) / Double(StillPoint.blockDuration)))
            for i in 0..<totalBlocks {
                blocks.append(BlockDef(
                    id: "second-\(i * StillPoint.blockDuration)",
                    duration: StillPoint.blockDuration,
                    startTime: i * StillPoint.blockDuration,
                    label: "\((i + 1) * StillPoint.blockDuration)s",
                    type: .second
                ))
            }
        }

        return blocks
    }

    /// Calculate clear mind percentage from a mind state log.
    public static func calculateClearPercent(
        mindStateLog: [MindStateEntry],
        totalElapsed: Double
    ) -> Int {
        guard totalElapsed > 0 else { return 100 }

        // If log is empty, the entire session was clear (no state changes)
        guard !mindStateLog.isEmpty else { return 100 }

        // Ensure we account for time from 0 to the first entry
        var effectiveLog = mindStateLog
        if effectiveLog[0].time > 0 {
            effectiveLog.insert(MindStateEntry(time: 0, state: "clear"), at: 0)
        }

        var clearTime: Double = 0
        for (index, entry) in effectiveLog.enumerated() {
            let endTime: Double
            if index + 1 < effectiveLog.count {
                endTime = effectiveLog[index + 1].time
            } else {
                endTime = totalElapsed
            }
            if entry.isClear {
                clearTime += endTime - entry.time
            }
        }

        return Int(round((clearTime / totalElapsed) * 100))
    }

    /// Generate a status label matching the web app's logic.
    public static func statusLabel(
        elapsed: Double,
        totalSeconds: Int,
        blocks: [BlockDef]
    ) -> String {
        let minuteBlocks = blocks.filter { $0.type == .minute }
        let secondBlocks = blocks.filter { $0.type == .second }
        let useMinuteBlocks = usesMinuteBlocks(totalSeconds: totalSeconds)
        let totalMinuteCount = minuteBlocks.count + (secondBlocks.isEmpty ? 0 : 1)

        if useMinuteBlocks {
            if elapsed >= Double(totalSeconds) {
                return "minute \(totalMinuteCount) of \(totalMinuteCount)"
            }

            let lastMinuteStart = minuteBlocks.count * 60
            if elapsed < Double(lastMinuteStart) {
                let minIdx = Int(elapsed) / 60
                return "minute \(minIdx + 1) of \(totalMinuteCount)"
            } else {
                return "minute \(minuteBlocks.count) of \(totalMinuteCount)"
            }
        } else if elapsed >= Double(totalSeconds) {
            return "session complete"
        } else {
            let blockIdx = Int(elapsed) / StillPoint.blockDuration
            return "block \(blockIdx + 1) of \(blocks.count)"
        }
    }
}
