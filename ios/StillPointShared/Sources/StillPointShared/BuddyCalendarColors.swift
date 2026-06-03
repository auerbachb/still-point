import SwiftUI

/// Client-safe buddy accent colors (#350). Matches `src/lib/buddyCalendarColors.ts`.
public let BUDDY_CALENDAR_PALETTE: [String] = [
    "#5B8C7A",
    "#7A6B8C",
    "#8C7A5B",
    "#5B6F8C",
    "#8C5B6B",
    "#6B8C5B",
    "#8C6B5B",
    "#5B8C8C",
]

/// Deterministic palette index from buddy user id.
func buddyColorIndexFromUserId(_ userId: String) -> Int {
    var hash: UInt32 = 0
    for byte in userId.utf8 {
        hash = hash &* 31 &+ UInt32(byte)
    }
    return Int(hash % UInt32(BUDDY_CALENDAR_PALETTE.count))
}

/// Deterministic accent color from buddy user id (stable across unified + per-buddy views).
public func buddyColorFromUserId(_ userId: String) -> Color {
    return colorFromHex(BUDDY_CALENDAR_PALETTE[buddyColorIndexFromUserId(userId)])
}

private func colorFromHex(_ hex: String) -> Color {
    var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if cleaned.hasPrefix("#") {
        cleaned.removeFirst()
    }
    guard cleaned.count == 6, let value = UInt64(cleaned, radix: 16) else {
        return Color.gray
    }
    let r = Double((value >> 16) & 0xFF) / 255.0
    let g = Double((value >> 8) & 0xFF) / 255.0
    let b = Double(value & 0xFF) / 255.0
    return Color(red: r, green: g, blue: b)
}
