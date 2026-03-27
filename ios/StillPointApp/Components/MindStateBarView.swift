import SwiftUI
import StillPointShared

/// Horizontal segmented bar showing clear (green) and thinking (amber) periods.
struct MindStateBarView: View {
    let elapsed: Double
    let totalSeconds: Int
    let mindStateLog: [MindStateEntry]

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let safeTotalSeconds = max(totalSeconds, 1)

            ZStack(alignment: .leading) {
                // Background track
                RoundedRectangle(cornerRadius: 4)
                    .fill(SPColor.surface2)

                // Segments
                ForEach(Array(mindStateLog.enumerated()), id: \.offset) { index, entry in
                    let startFraction = entry.time / Double(safeTotalSeconds)
                    let endTime: Double = {
                        if index + 1 < mindStateLog.count {
                            return mindStateLog[index + 1].time
                        }
                        return min(elapsed, Double(safeTotalSeconds))
                    }()
                    let endFraction = endTime / Double(safeTotalSeconds)

                    let segmentX = width * startFraction
                    let segmentWidth = max(0, width * (endFraction - startFraction))

                    Rectangle()
                        .fill(entry.isClear ? SPColor.green : SPColor.amber)
                        .opacity(entry.isClear ? 0.5 : 0.6)
                        .frame(width: segmentWidth)
                        .offset(x: segmentX)
                }
            }
        }
        .frame(height: 8)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(.horizontal, SPSpacing.s4)
    }
}
