import Foundation

/// Presentation rules for the mid-session sound toggles (tick / chime / voice / end).
///
/// The row used to be four bare lowercase words whose only state cue was a shift
/// between two muted greys — `fg3` when on, `fg4` when off (#668). Mid-sit, on a
/// phone, that is neither obviously tappable nor obviously on.
///
/// This type owns the *appearance* decision so both clients derive it from one
/// place: iOS renders it in `SessionView.soundToggle`, web in
/// `src/components/SessionView.tsx` via the port at
/// `src/lib/soundToggleAppearance.ts`. Nothing here touches audio — the toggle
/// side effects still live in `SoundToggleLogic` (#667) and are untouched by the
/// restyle.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum SoundToggleAppearance {

    /// Minimum tap target for a sound toggle (Apple HIG 44pt / WCAG 2.5.5 44px).
    ///
    /// This is the size of the *visible* pill, not an invisible target wrapped
    /// around a small glyph: the fill and border are drawn at this height so what
    /// you see is what you can hit.
    public static let minimumTapTarget: Double = 44

    /// The visual channels that carry on/off state.
    ///
    /// Three redundant cues, deliberately: an off state that only differs in text
    /// colour is unreadable at a glance and fails "does not rely on a subtle
    /// two-grey color difference alone". Anything that collapses these back into a
    /// single channel breaks `SoundToggleAppearanceTests`.
    public struct Appearance: Equatable {
        /// Pill is filled (on) rather than transparent (off).
        public let isFilled: Bool
        /// Pill border is the stronger tier (on) rather than the faint tier (off).
        public let hasProminentBorder: Bool
        /// Icon shows a muted speaker (off) rather than a sounding one (on).
        public let isIconMuted: Bool

        public init(isFilled: Bool, hasProminentBorder: Bool, isIconMuted: Bool) {
            self.isFilled = isFilled
            self.hasProminentBorder = hasProminentBorder
            self.isIconMuted = isIconMuted
        }

        /// SF Symbol for the icon half of the control.
        public var systemImageName: String {
            isIconMuted ? "speaker.slash.fill" : "speaker.wave.2.fill"
        }
    }

    /// Resolves every visual channel from the single on/off input.
    public static func appearance(isOn: Bool) -> Appearance {
        Appearance(isFilled: isOn, hasProminentBorder: isOn, isIconMuted: !isOn)
    }

    /// UI-test hook. Unchanged by the restyle — `StillPointAppUITests` and the web
    /// e2e suite both address the toggles through this identifier.
    public static func accessibilityIdentifier(label: String) -> String {
        "session.soundToggle.\(label)"
    }

    /// Accessible name. Keeps the visible word first so speech input ("tap tick")
    /// still matches the label a sighted user reads (WCAG 2.5.3 Label in Name).
    public static func accessibilityLabel(label: String) -> String {
        "\(label) sound"
    }

    /// Accessible value, so VoiceOver announces the state change rather than
    /// leaving it to colour alone. Read as "tick sound, on, button".
    public static func accessibilityValue(isOn: Bool) -> String {
        isOn ? "on" : "off"
    }
}
