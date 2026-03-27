import SwiftUI
import StillPointShared

struct ThoughtJournalView: View {
    @State private var vm = ThoughtJournalViewModel()

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Text("Thought Journal")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .padding(.top, SPSpacing.s4)

                if vm.totalCount > 0 {
                    Text("\(vm.totalCount) thoughts captured")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg3))
                }

                // Reflective prompt
                Text("Every thought that felt urgent in the moment. Looking back — how many actually needed your attention right then?")
                    .font(SPFont.serifItalic(15, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SPSpacing.s3)

                // Grouped thoughts
                ForEach(vm.groupedThoughts, id: \.dayNumber) { group in
                    VStack(alignment: .leading, spacing: SPSpacing.s2) {
                        Text("DAY \(group.dayNumber)")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .tracking(2)

                        ForEach(group.thoughts, id: \.id) { thought in
                            HStack(alignment: .top, spacing: SPSpacing.s2) {
                                Text(thought.timeInSession == -1 ? "note" : "@\(thought.timeInSession)s")
                                    .font(SPFont.mono(11))
                                    .foregroundStyle(SPColor.amberText)
                                    .frame(width: 44, alignment: .trailing)

                                Text(thought.text)
                                    .font(SPFont.serifItalic(15))
                                    .foregroundStyle(Color(SPColor.fg2))
                            }
                        }
                    }
                    .padding(SPSpacing.s3)
                    .background(SPColor.surface1)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(SPColor.border1)
                    )
                }

                if vm.groupedThoughts.isEmpty && !vm.isLoading {
                    Text("No thoughts captured yet")
                        .font(SPFont.serifItalic(15))
                        .foregroundStyle(Color(SPColor.fg4))
                        .padding(.top, SPSpacing.s6)
                }

                Spacer().frame(height: SPSpacing.s6)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .task {
            await vm.load()
        }
    }
}
