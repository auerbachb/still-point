#if !targetEnvironment(simulator)
import DeviceActivity
import ManagedSettings

/// Re-locks the gated apps at the start of each local day (#423).
///
/// Registered by the app through `DeviceActivityCenter`. The system launches
/// this extension at the schedule's interval start (local midnight) even when
/// Still Point itself is suspended or terminated — which is exactly the case the
/// old in-process `Timer` could not handle.
final class StillPointMonitorExtension: DeviceActivityMonitor {
    private let store = ManagedSettingsStore()

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // A new calendar day has begun, so the prior day's unlock has expired:
        // re-apply the shield from the saved selection.
        AppBlockingShared.applySavedShield(to: store)
    }
}
#else
import Foundation

/// Simulator stub. The monitor extension is never invoked in simulator (PR e2e)
/// builds; this keeps the target compiling without linking Family Controls, so
/// the simulator build needs no provisioning profile.
final class StillPointMonitorExtension: NSObject {}
#endif
