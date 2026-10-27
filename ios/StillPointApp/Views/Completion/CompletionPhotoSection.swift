import SwiftUI
import UIKit

/// The optional session environment photo (local-only MVP). Owns the picker
/// sheet and the captured image; the photo itself is kept by
/// `SessionPhotoStore` under the session id.
struct CompletionPhotoSection: View {
    let sessionId: String

    @State private var capturedPhoto: UIImage?
    @State private var showPhotoPicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SESSION PHOTO")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if let photo = capturedPhoto {
                // Thumbnail with retake / remove controls
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: 180)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .clipped()
                        .accessibilityIdentifier("completion.photoThumbnail")

                    HStack {
                        Button {
                            showPhotoPicker = true
                        } label: {
                            Text("Retake")
                                .font(SPFont.mono(11, weight: .medium))
                                .foregroundStyle(Color(SPColor.fg3))
                        }
                        .accessibilityIdentifier("completion.retakePhotoButton")

                        Spacer()

                        Button {
                            removePhoto()
                        } label: {
                            Text("Remove")
                                .font(SPFont.mono(11, weight: .medium))
                                .foregroundStyle(SPColor.dangerMuted)
                        }
                        .accessibilityIdentifier("completion.removePhotoButton")
                    }
                }
            } else {
                // Dashed "add" affordance — intentionally low-prominence so it never feels mandatory.
                // Disabled until sessionId is assigned by the server (mirrors isSaveDisabled guard).
                Button {
                    showPhotoPicker = true
                } label: {
                    HStack(spacing: SPSpacing.s2) {
                        Image(systemName: "camera")
                            .font(.system(size: 15))
                        Text("Add photo of your environment")
                            .font(SPFont.serifItalic(15, weight: .light))
                    }
                    .foregroundStyle(Color(SPColor.fg3))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s3)
                    .background(Color(SPColor.surface1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                    )
                }
                .disabled(sessionId.isEmpty)
                .accessibilityIdentifier("completion.addPhotoButton")
            }
        }
        .sheet(isPresented: $showPhotoPicker) {
            SessionPhotoPicker { image in
                handlePhotoSelected(image)
            }
        }
    }

    private func handlePhotoSelected(_ image: UIImage) {
        guard !sessionId.isEmpty else { return }
        guard SessionPhotoStore.shared.save(image, forSessionId: sessionId) != nil else { return }
        capturedPhoto = image
    }

    private func removePhoto() {
        SessionPhotoStore.shared.delete(forSessionId: sessionId)
        capturedPhoto = nil
    }
}
