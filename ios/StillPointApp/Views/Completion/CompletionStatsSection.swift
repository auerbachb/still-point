import SwiftUI
import StillPointShared

/// The recap's stat cards: awareness and distraction, captured notes, and —
/// when they were recorded — the gaze-tracking and ambient sound summaries.
/// Display only.
struct CompletionStatsSection: View {
    let clearPercent: Int
    let thoughtCount: Int
    let attentionSummary: AttentionTrackingLogic.AttentionSummary?
    /// #563: nil when capture was off or the mic was denied.
    let ambientSoundSummary: AmbientSoundSummary?

    var body: some View {
        VStack(spacing: SPSpacing.s3) {
            HStack(spacing: SPSpacing.s3) {
                CompletionStatCard(value: "\(clearPercent)%", label: "AWARENESS", tone: .green)
                CompletionStatCard(value: "\(max(0, 100 - clearPercent))%", label: "DISTRACTION", tone: .amber)
            }

            CompletionStatCard(value: "\(thoughtCount)", label: "CAPTURED NOTES", tone: .amber)

            if let attentionSummary {
                HStack(spacing: SPSpacing.s3) {
                    CompletionStatCard(
                        value: "\(attentionSummary.attentivePercent)%",
                        label: "GAZE ON SCREEN",
                        tone: .green
                    )
                    CompletionStatCard(
                        value: "\(attentionSummary.awayPercent)%",
                        label: "GAZE AWAY",
                        tone: .amber
                    )
                }
                .accessibilityIdentifier("completion.attentionSummary")
            }

            if let ambient = ambientSoundSummary {
                HStack(spacing: SPSpacing.s3) {
                    CompletionStatCard(value: "\(ambient.quietPercent)%", label: "QUIET TIME", tone: .green)
                    CompletionStatCard(
                        value: String(format: "%.0f dBFS", ambient.avgDb),
                        label: "AVG LEVEL",
                        tone: .amber
                    )
                }
                .accessibilityIdentifier("completion.ambientSoundSummary")
            }
        }
    }
}

/// One recap stat: a large value over a small tracked label, in a tinted card.
struct CompletionStatCard: View {
    /// Every card is one of two palettes, so the color, fill and border are
    /// picked together rather than passed one by one.
    enum Tone {
        case green
        case amber

        var color: Color {
            switch self {
            case .green: return SPColor.green
            case .amber: return SPColor.amber
            }
        }

        var background: Color {
            switch self {
            case .green: return SPColor.greenBgFaint
            case .amber: return SPColor.amberBgFaint
            }
        }

        var border: Color {
            switch self {
            case .green: return SPColor.greenBorderSubtle
            case .amber: return SPColor.amberBorderSubtle
            }
        }
    }

    let value: String
    let label: String
    let tone: Tone

    var body: some View {
        VStack(spacing: SPSpacing.s1) {
            Text(value)
                .font(SPFont.statValue)
                .foregroundStyle(tone.color)
            Text(label)
                .font(SPFont.statLabel)
                .foregroundStyle(tone.color.opacity(0.6))
                .tracking(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SPSpacing.s3)
        .background(tone.background)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(tone.border)
        )
    }
}
