import SwiftUI
import StillPointShared

struct BlockGridView: View {
    let blocks: [BlockDef]
    let elapsed: Double
    let totalSeconds: Int
    var availableHeight: CGFloat? = nil
    var availableWidth: CGFloat? = nil

    private let blockSpacing: CGFloat = 8
    private let blockRadius: CGFloat = 10

    private var minuteBlocks: [BlockDef] {
        blocks.filter { $0.type == .minute }
    }

    private var secondBlocks: [BlockDef] {
        blocks.filter { $0.type == .second }
    }

    private var useMinuteBlocks: Bool {
        totalSeconds > 120
    }

    /// Compute block size dynamically based on available height and block count.
    /// Falls back to 56pt when no height constraint is provided.
    private var blockSize: CGFloat {
        guard let availableHeight else { return 56 }
        let count = blocks.count
        guard count > 0 else { return 56 }

        let maxBlockWidth: CGFloat = 56
        let width = availableWidth ?? 350
        let columnsEstimate = max(1, floor(width / (maxBlockWidth + blockSpacing)))

        let rows: CGFloat
        if useMinuteBlocks {
            let minuteCount = CGFloat(minuteBlocks.count)
            let secondCount = CGFloat(secondBlocks.count)
            rows = ceil(minuteCount / columnsEstimate) + ceil(secondCount / columnsEstimate)
        } else {
            rows = ceil(CGFloat(count) / columnsEstimate)
        }

        let dividerSpace: CGFloat = useMinuteBlocks ? 40 : 0
        let totalSpacing = (rows - 1) * blockSpacing + dividerSpace
        let maxBlockHeight = max(0, availableHeight - totalSpacing) / rows

        // Clamp between 32pt minimum and 56pt maximum
        return min(56, max(32, maxBlockHeight))
    }

    var body: some View {
        if useMinuteBlocks {
            VStack(spacing: SPSpacing.s2) {
                // Minute blocks
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                    spacing: blockSpacing
                ) {
                    ForEach(minuteBlocks) { block in
                        blockView(block)
                    }
                }

                // Divider + "final minute" label
                VStack(spacing: SPSpacing.s1) {
                    Rectangle()
                        .fill(SPColor.border1)
                        .frame(height: 1)

                    Text("FINAL MINUTE")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    // 10-second blocks
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                        spacing: blockSpacing
                    ) {
                        ForEach(secondBlocks) { block in
                            blockView(block)
                        }
                    }
                }
            }
        } else {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                spacing: blockSpacing
            ) {
                ForEach(blocks) { block in
                    blockView(block)
                }
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: BlockDef) -> some View {
        let blockEnd = block.startTime + block.duration
        let isFilled = elapsed >= Double(blockEnd)
        let isCurrent = elapsed >= Double(block.startTime)
            && elapsed < Double(blockEnd)
            && elapsed < Double(totalSeconds)
        let progress = isCurrent
            ? (elapsed - Double(block.startTime)) / Double(block.duration)
            : isFilled ? 1.0 : 0.0

        let fontSize: CGFloat = blockSize < 40 ? 10 : 13

        ZStack {
            // Background
            RoundedRectangle(cornerRadius: blockRadius)
                .fill(SPColor.surface1)

            // Fill from bottom
            GeometryReader { geo in
                VStack {
                    Spacer()
                    Rectangle()
                        .fill(isFilled ? LinearGradient.greenFill : LinearGradient.amberFill)
                        .frame(height: geo.size.height * progress)
                        .opacity(isFilled ? 0.85 : 0.7)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: blockRadius))

            // Label
            Text(block.label)
                .font(SPFont.mono(fontSize, weight: .medium))
                .foregroundStyle(isFilled ? SPColor.overlayText : Color(SPColor.fg4))

            // Current block pulse border — uses phaseAnimator for continuous pulse
            if isCurrent {
                RoundedRectangle(cornerRadius: blockRadius)
                    .stroke(SPColor.amberDim, lineWidth: 1)
                    .phaseAnimator([false, true]) { content, phase in
                        content.opacity(phase ? 1.0 : 0.4)
                    } animation: { _ in
                        .easeInOut(duration: 1.0)
                    }
            }
        }
        .frame(width: blockSize, height: blockSize)
        .overlay(
            RoundedRectangle(cornerRadius: blockRadius)
                .stroke(
                    isFilled ? SPColor.greenBorder :
                    isCurrent ? SPColor.amberBorder :
                    SPColor.border1,
                    lineWidth: 1
                )
        )
    }
}
