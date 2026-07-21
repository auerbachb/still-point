import SwiftUI
import PhotosUI
import AVFoundation

/// Reusable photo capture / picker sheet.
///
/// Present this view as a sheet to give the user a "Take Photo" button (camera, gated
/// through `CameraPermissionHelper`) and a "Choose from Library" button
/// (`PhotosPicker`, no additional permission key required). Returns the selected
/// image via `onImageSelected` and dismisses itself automatically.
struct SessionPhotoPicker: View {
    /// Called on the main thread when the user selects or captures a photo.
    let onImageSelected: (UIImage) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var showCameraCapture = false
    @State private var showPermissionDeniedAlert = false
    @State private var photoPickerItem: PhotosPickerItem?
    /// Holds an image captured by the camera until the fullScreenCover has dismissed.
    @State private var pendingCameraImage: UIImage?

    var body: some View {
        VStack(spacing: SPSpacing.s4) {
            Spacer().frame(height: SPSpacing.s3)

            Text("ADD PHOTO")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            // Camera
            Button {
                handleCameraTap()
            } label: {
                Label("Take Photo", systemImage: "camera")
                    .font(SPFont.serifItalic(18, weight: .light))
                    .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
            }
            .accessibilityIdentifier("photoPicker.cameraButton")

            // Library — system picker via PhotosUI (no NSPhotoLibraryUsageDescription needed)
            PhotosPicker(
                selection: $photoPickerItem,
                matching: .images,
                photoLibrary: .shared()
            ) {
                Label("Choose from Library", systemImage: "photo.on.rectangle")
                    .font(SPFont.serifItalic(18, weight: .light))
                    .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
            }
            .accessibilityIdentifier("photoPicker.libraryButton")

            // Cancel
            Button {
                dismiss()
            } label: {
                Text("Cancel")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg3))
            }
            .padding(.top, SPSpacing.s1)
            .accessibilityIdentifier("photoPicker.cancelButton")

            Spacer()
        }
        .padding(.horizontal, SPSpacing.s4)
        .stillPointBackground()
        // Library selection: load Data → UIImage, then dismiss
        .onChange(of: photoPickerItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    onImageSelected(image)
                }
                dismiss()
            }
        }
        // Camera capture: fullScreenCover (camera must be presented full-screen on iPhone)
        .fullScreenCover(isPresented: $showCameraCapture) {
            CameraImagePicker { captured in
                pendingCameraImage = captured
                showCameraCapture = false
            }
            .ignoresSafeArea()
        }
        // When the camera cover dismisses, deliver the pending image and close the sheet
        .onChange(of: showCameraCapture) { _, isShowing in
            guard !isShowing, let image = pendingCameraImage else { return }
            onImageSelected(image)
            pendingCameraImage = nil
            dismiss()
        }
        // Deny path: Settings deep-link
        .cameraPermissionDeniedAlert(isPresented: $showPermissionDeniedAlert)
    }

    private func handleCameraTap() {
        CameraPermissionHelper.requestIfNeeded { status in
            if status == .authorized {
                showCameraCapture = true
            } else {
                showPermissionDeniedAlert = true
            }
        }
    }
}

// MARK: - Camera UIViewControllerRepresentable

/// Wraps `UIImagePickerController` with `.camera` source type for use in SwiftUI.
private struct CameraImagePicker: UIViewControllerRepresentable {
    /// Called with the captured image, or `nil` when the user cancels.
    let onCapture: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage?) -> Void

        init(onCapture: @escaping (UIImage?) -> Void) {
            self.onCapture = onCapture
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let image = info[.editedImage] as? UIImage ?? info[.originalImage] as? UIImage
            onCapture(image)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCapture(nil)
        }
    }
}
