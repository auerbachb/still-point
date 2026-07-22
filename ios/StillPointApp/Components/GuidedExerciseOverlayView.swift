import SwiftUI
import StillPointShared

/// Full-screen guided exercise overlay during an active sit (#519).
struct GuidedExerciseOverlayView: View {
    private static let minTapTarget: CGFloat = 44

    @Bindable var vm: GuidedExerciseViewModel
    let onClose: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            SPColor.bg.opacity(0.94)
                .background(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: SPSpacing.s4) {
                Spacer(minLength: SPSpacing.s4)

                contentCard

                Spacer(minLength: SPSpacing.s4)
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.top, SPSpacing.s6)
            .padding(.bottom, SPSpacing.s4)

            VStack {
                HStack {
                    Spacer()
                    Button {
                        vm.reset()
                        onClose()
                    } label: {
                        Text("close")
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
                    .accessibilityIdentifier("guidedExercise.closeButton")
                }
                Spacer()
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.top, SPSpacing.s2)
        }
        .accessibilityIdentifier("guidedExercise.overlay")
        .onDisappear {
            vm.stop()
        }
    }

    @ViewBuilder
    private var contentCard: some View {
        switch vm.phase {
        case .picker:
            pickerContent
        case .running:
            if let exercise = vm.exercise, let step = vm.currentStep {
                runningContent(exercise: exercise, step: step)
            }
        case .complete:
            if let exercise = vm.exercise {
                completeContent(exercise: exercise)
            }
        }
    }

    private var pickerContent: some View {
        VStack(spacing: SPSpacing.s3) {
            VStack(spacing: SPSpacing.s2) {
                Text("Guided exercise")
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(1.8)
                    .textCase(.uppercase)

                Text("Choose a focus")
                    .font(SPFont.serif(18, weight: .light))
                    .foregroundStyle(Color(SPColor.fg2))

                Text("Your sit keeps running. Each prompt advances gently on its own — tap next anytime.")
                    .font(SPFont.mono(12))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }

            VStack(spacing: SPSpacing.s2) {
                ForEach(GuidedExerciseContent.all, id: \.id) { item in
                    Button {
                        vm.start(item.id)
                    } label: {
                        VStack(alignment: .leading, spacing: SPSpacing.s1) {
                            Text(item.shortLabel)
                                .font(SPFont.mono(12, weight: .medium))
                                .foregroundStyle(SPColor.greenText)
                                .tracking(1.2)
                                .textCase(.uppercase)

                            Text(item.label)
                                .font(SPFont.mono(13, weight: .medium))
                                .foregroundStyle(Color(SPColor.fg2))

                            Text(item.description)
                                .font(SPFont.mono(11))
                                .foregroundStyle(Color(SPColor.fg4))
                                .lineSpacing(3)

                            Text("\(item.steps.count) prompts")
                                .font(SPFont.mono(10))
                                .foregroundStyle(Color(SPColor.fg4))
                                .tracking(0.8)
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
                    .accessibilityIdentifier("guidedExercise.option.\(item.id.rawValue)")
                }
            }
        }
        .frame(maxWidth: 440)
    }

    private func runningContent(exercise: GuidedExerciseDefinition, step: GuidedExerciseStep) -> some View {
        VStack(spacing: SPSpacing.s3) {
            VStack(spacing: SPSpacing.s2) {
                Text("\(exercise.shortLabel) · \(vm.stepIndex + 1) / \(exercise.steps.count)")
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(1.6)
                    .textCase(.uppercase)

                Text(step.title)
                    .font(SPFont.serif(22, weight: .light))
                    .foregroundStyle(SPColor.greenText)
                    .tracking(0.8)
                    .accessibilityIdentifier("guidedExercise.stepTitle")
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(SPColor.border2)
                    Capsule()
                        .fill(SPColor.green)
                        .frame(width: max(0, geo.size.width * vm.progress))
                        .animation(reduceMotion ? nil : .linear(duration: 0.25), value: vm.progress)
                }
            }
            .frame(height: 3)
            .accessibilityIdentifier("guidedExercise.stepProgress")

            Text(step.prompt)
                .font(SPFont.serif(14, weight: .light))
                .foregroundStyle(Color(SPColor.fg2))
                .multilineTextAlignment(.center)
                .lineSpacing(5)
                .frame(maxWidth: 280)
                .accessibilityIdentifier("guidedExercise.stepPrompt")

            HStack(spacing: SPSpacing.s2) {
                secondaryButton("back") { vm.back() }
                secondaryButton(vm.isPaused ? "resume" : "pause") { vm.togglePause() }
                secondaryButton(vm.isLastStep ? "finish" : "next") { vm.nextOrFinish() }
            }
        }
        .frame(maxWidth: 440)
    }

    private func completeContent(exercise: GuidedExerciseDefinition) -> some View {
        VStack(spacing: SPSpacing.s3) {
            VStack(spacing: SPSpacing.s2) {
                Text("\(exercise.shortLabel) complete")
                    .font(SPFont.mono(10, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(1.6)
                    .textCase(.uppercase)

                Text("Return to your sit")
                    .font(SPFont.serif(20, weight: .light))
                    .foregroundStyle(Color(SPColor.fg2))

                Text("Let the exercise dissolve. Your timer and tracking continue as before.")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }

            HStack(spacing: SPSpacing.s2) {
                secondaryButton("repeat") { vm.repeatExercise() }
                secondaryButton("choose another") { vm.chooseAnother() }
                Button {
                    vm.reset()
                    onClose()
                } label: {
                    Text("back to sit")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(SPColor.greenText)
                        .tracking(1.2)
                        .textCase(.uppercase)
                        .padding(.horizontal, SPSpacing.s3)
                        .frame(minHeight: Self.minTapTarget)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(SPColor.greenBorder)
                        )
                }
            }
        }
        .frame(maxWidth: 440)
    }

    private func secondaryButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg2))
                .tracking(1.2)
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
    }
}
