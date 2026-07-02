import SwiftUI
import StillPointShared

struct BuddyActiveSessionView: View {
    @Bindable var vm: BuddySessionViewModel
    let snapshot: BuddySnapshotDTO
    let onLeave: () -> Void

    @State private var now = Date()
    @State private var showThoughtCapture = false
    @State private var showExitConfirm = false
    @State private var didRequestCompletionRefresh = false

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s4) {
                Text("Shared session")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))

                timerCard
                participantsCard
                videoCard
                controlsCard
                hints
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.vertical, SPSpacing.s4)
        }
        .stillPointBackground()
        .onReceive(timer) { value in
            now = value
            let remaining = vm.currentRemainingSeconds(at: value)
            if remaining == 0 {
                guard !didRequestCompletionRefresh else { return }
                didRequestCompletionRefresh = true
                Task {
                    await vm.refreshSnapshot()
                }
            } else {
                didRequestCompletionRefresh = false
            }
        }
        .alert("Leave shared session?", isPresented: $showExitConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Leave", role: .destructive) {
                Task {
                    if await vm.leaveSession() {
                        onLeave()
                    }
                }
            }
        } message: {
            Text(snapshot.isHost ? "Leaving as host ends the shared session for everyone." : "You will leave this shared sit for your device.")
        }
    }

    private var timerCard: some View {
        VStack(spacing: SPSpacing.s2) {
            Text(vm.formattedRemaining(at: now))
                .font(SPFont.timerDisplay)
                .foregroundStyle(Color(SPColor.fg))
                .monospacedDigit()

            Text("Shared timer")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(1)

            ProgressView(value: Double(vm.currentElapsedSeconds(at: now)), total: Double(max(snapshot.durationSeconds, 1)))
                .tint(SPColor.green)
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SPColor.border2))
    }

    private var participantsCard: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("Participants")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            ForEach(snapshot.participants.filter { $0.leftAt == nil }, id: \.userId) { participant in
                HStack {
                    Text(participant.username + (participant.isHost ? " · host" : ""))
                        .font(SPFont.serifItalic(16, weight: .light))
                        .foregroundStyle(Color(SPColor.fg2))
                    Spacer()
                    Circle()
                        .fill(participant.connected ? SPColor.green : SPColor.fg4)
                        .frame(width: 8, height: 8)
                    Text(participant.connected ? "online" : "away")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SPColor.border1))
    }

    private var videoCard: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("Video")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if let roomURL = snapshot.dailyRoomUrl, !roomURL.isEmpty {
                Text("Room URL received")
                    .font(SPFont.serif(14, weight: .light))
                    .foregroundStyle(Color(SPColor.fg3))

                if vm.meetingToken != nil {
                    BuddyVideoWebView(roomURL: roomURL, meetingToken: vm.meetingToken ?? "")
                        .frame(height: 260)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
                } else if let tokenError = vm.meetingTokenError {
                    Text(tokenError)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.dangerMuted)
                } else {
                    Text("Preparing video token…")
                        .font(SPFont.mono(11))
                        .foregroundStyle(Color(SPColor.fg4))
                }

            } else {
                Text("Video is unavailable for this session.")
                    .font(SPFont.serif(14, weight: .light))
                    .foregroundStyle(Color(SPColor.fg3))
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SPColor.border1))
    }

    private var controlsCard: some View {
        VStack(spacing: SPSpacing.s3) {
            HStack(spacing: SPSpacing.s2) {
                Button {
                    if vm.mindState == "clear" {
                        vm.beginDistraction()
                    } else if vm.mindState == "thinking" {
                        vm.endMindStateHold()
                    }
                } label: {
                    Text(vm.mindState == "thinking" ? "Release distraction" : "Hold distraction")
                        .font(SPFont.mono(11, weight: .medium))
                        .spCapsuleButtonStyle(
                            vm.mindState == "thinking" ? .amber : .green,
                            size: .fullWidth
                        )
                        .foregroundStyle(vm.mindState == "thinking" ? SPColor.amber : SPColor.green)
                }

                Button {
                    if vm.mindState == "clear" {
                        vm.beginHyperfocus()
                    } else if vm.mindState == "hyperfocus" {
                        vm.endMindStateHold()
                    }
                } label: {
                    Text(vm.mindState == "hyperfocus" ? "Release hyperfocus" : "Hold hyperfocus")
                        .font(SPFont.mono(11, weight: .medium))
                        .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                        .foregroundStyle(Color(SPColor.fg3))
                }
            }

            Button {
                showThoughtCapture.toggle()
            } label: {
                Text(showThoughtCapture ? "Hide thought capture" : "Capture note")
                    .font(SPFont.mono(11, weight: .medium))
                    .spCapsuleButtonStyle(.amber, size: .regular, horizontalPadding: SPSpacing.s3)
            }

            if showThoughtCapture {
                VStack(spacing: SPSpacing.s2) {
                    TextField("What came up?", text: $vm.pendingThought, axis: .vertical)
                        .lineLimit(3...5)
                        .font(SPFont.serif(15, weight: .light))
                        .padding(SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))

                    Button {
                        vm.addPendingThought()
                        showThoughtCapture = false
                    } label: {
                        Text("Save note")
                            .font(SPFont.mono(11, weight: .medium))
                            .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                            .foregroundStyle(Color(SPColor.fg2))
                    }
                }
            }

            if vm.distractionSegmentCount > 0 || !vm.capturedThoughts.isEmpty {
                Text("\(vm.distractionSegmentCount) distraction segments · \(vm.capturedThoughts.count) captured notes")
                    .font(SPFont.mono(10))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
            }

            Button {
                showExitConfirm = true
            } label: {
                Text("Leave")
                    .font(SPFont.mono(11, weight: .medium))
                    .spCapsuleButtonStyle(.danger, size: .regular, horizontalPadding: SPSpacing.s3)
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SPColor.border1))
    }

    private var hints: some View {
        Text(snapshot.isHost
             ? "If you leave, the host departure ends the shared session for everyone."
             : "If you leave, only your device exits the shared session.")
        .font(SPFont.mono(10))
        .foregroundStyle(Color(SPColor.fg4))
        .multilineTextAlignment(.center)
        .padding(.horizontal, SPSpacing.s4)
    }

}
