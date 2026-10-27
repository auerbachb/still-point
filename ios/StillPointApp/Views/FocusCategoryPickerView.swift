import SwiftUI
import StillPointShared

/// #840: choose what a focus session is for before its timer starts. Mirrors web
/// `FocusCategoryPicker.tsx`: three cards (Reading, Writing, Listening) under the
/// one goal they share, and a Cancel that returns Home. The card styling follows
/// the guided-exercise picker (`GuidedExerciseOverlayView`).
struct FocusCategoryPickerView: View {
    private static let minTapTarget: CGFloat = 44

    let appVM: AppViewModel

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // Scrolls rather than clipping the cards on a short (landscape) screen,
            // and centres them whenever they fit.
            GeometryReader { proxy in
                ScrollView {
                    content
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }

            Button {
                withAnimation {
                    appVM.cancelFocusActivity()
                }
            } label: {
                Text("cancel")
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(1.4)
                    .textCase(.uppercase)
                    .padding(.horizontal, SPSpacing.s3)
                    .frame(minHeight: Self.minTapTarget)
                    .background(SPColor.surface1)
                    .clipShape(Capsule())
                    .overlay(
                        Capsule()
                            .stroke(SPColor.border2)
                    )
            }
            // Escape on an iPad keyboard, as on web.
            .keyboardShortcut(.cancelAction)
            .accessibilityIdentifier("focusPicker.cancelButton")
            .accessibilityLabel("Cancel focus activity")
            .padding(.horizontal, SPSpacing.s4)
            .padding(.top, SPSpacing.s2)
        }
        .stillPointBackground()
        .accessibilityIdentifier("focusPicker")
    }

    private var content: some View {
        VStack(spacing: SPSpacing.s4) {
            VStack(spacing: SPSpacing.s2) {
                Text("Focus activity")
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(1.8)
                    .textCase(.uppercase)

                Text("What are you focusing on?")
                    .font(SPFont.serif(18, weight: .light))
                    .foregroundStyle(Color(SPColor.fg2))
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)

                Text("One goal for all three: \(FocusActivity.formatGoal(appVM.focusGoalSeconds)). The timer starts when you choose.")
                    .font(SPFont.mono(12))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .accessibilityIdentifier("focusPicker.goal")
                    .accessibilityLabel("One goal for all three: \(FocusActivity.spokenDuration(appVM.focusGoalSeconds)). The timer starts when you choose.")
            }

            VStack(spacing: SPSpacing.s2) {
                ForEach(FocusCategory.allCases, id: \.self) { category in
                    card(for: category)
                }
            }
        }
        // Caps the column on iPad, as the guided-exercise picker does.
        .frame(maxWidth: 440)
        .padding(.horizontal, SPSpacing.s4)
        // Clears the Cancel button above.
        .padding(.top, SPSpacing.s6 + SPSpacing.s2)
        .padding(.bottom, SPSpacing.s4)
    }

    private func card(for category: FocusCategory) -> some View {
        Button {
            withAnimation {
                appVM.startFocusSession(category: category)
            }
        } label: {
            VStack(alignment: .leading, spacing: SPSpacing.s1) {
                Text(category.displayLabel)
                    .font(SPFont.mono(12, weight: .medium))
                    .foregroundStyle(SPColor.greenText)
                    .tracking(1.4)
                    .textCase(.uppercase)

                Text(category.pickerDescription)
                    .font(SPFont.mono(11))
                    .foregroundStyle(Color(SPColor.fg4))
                    .lineSpacing(3)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(SPSpacing.s3)
            .background(SPColor.surface1)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(SPColor.greenBorderSubtle)
            )
        }
        .accessibilityIdentifier("focusPicker.option.\(category.rawValue)")
        .accessibilityLabel("\(category.displayLabel). \(category.pickerDescription)")
        .accessibilityHint("Starts the \(FocusActivity.spokenDuration(appVM.focusGoalSeconds)) timer.")
    }
}
