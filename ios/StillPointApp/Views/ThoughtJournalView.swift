import SwiftUI
import StillPointShared

struct ThoughtJournalView: View {
    @State private var vm = ThoughtJournalViewModel()

    var body: some View {
        // Compute the grouped collection once per render — it does a
        // Dictionary grouping + sort + map, so avoid recomputing it per access.
        let groups = vm.groupedThoughts

        return ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Text("Thought Journal")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .padding(.top, SPSpacing.s4)
                    .accessibilityIdentifier("journal.title")

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

                // Grouped thoughts — a flat, left-aligned log: no cards, hairline
                // dividers between date groups, tight vertical rhythm.
                if !groups.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(groups, id: \.dayNumber) { group in
                            // Thin hairline separating one date's entry from the
                            // next — rendered above every group except the first,
                            // so there's none above the first or below the last.
                            if group.dayNumber != groups[0].dayNumber {
                                Rectangle()
                                    .fill(SPColor.border1)
                                    .frame(height: 1)
                            }

                            VStack(alignment: .leading, spacing: SPSpacing.s2) {
                                Text("DAY \(group.dayNumber)")
                                    .font(SPFont.mono(11, weight: .medium))
                                    .foregroundStyle(Color(SPColor.fg4))
                                    .tracking(2)

                                ForEach(group.thoughts, id: \.id) { thought in
                                    HStack(alignment: .firstTextBaseline, spacing: SPSpacing.s2) {
                                        Text(thought.timeInSession == -1 ? "note" : "@\(thought.timeInSession)s")
                                            .font(SPFont.mono(11))
                                            .foregroundStyle(SPColor.amberText)
                                            .frame(width: 44, alignment: .leading)

                                        Text(thought.text)
                                            .font(SPFont.serifItalic(15))
                                            .foregroundStyle(Color(SPColor.fg2))
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, SPSpacing.s2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if groups.isEmpty && !vm.isLoading {
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
