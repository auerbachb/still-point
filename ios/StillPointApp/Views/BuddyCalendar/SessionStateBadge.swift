import SwiftUI

struct SessionStateBadge: View {
    let state: String

    var body: some View {
        Text(label)
            .font(SPFont.mono(10, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(background)
            .clipShape(Capsule())
    }

    private var label: String {
        switch state {
        case "completed":
            return "Completed"
        case "active":
            return "In progress"
        case "abandoned":
            return "Abandoned"
        case "waiting", "ready_check":
            return "Scheduled"
        default:
            return state
        }
    }

    private var foreground: Color {
        switch state {
        case "completed", "active":
            return SPColor.greenText
        case "abandoned":
            return Color(SPColor.fg4)
        default:
            return Color(SPColor.fg3)
        }
    }

    private var background: Color {
        switch state {
        case "completed", "active":
            return SPColor.greenBgFaint
        case "abandoned":
            return Color(SPColor.surface1)
        default:
            return Color(SPColor.surface2)
        }
    }
}
