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
        // Reconcile shields with the shared unlock state. On a new local day the
        // prior unlock has expired so gated apps re-lock; on the same day a
        // qualifying unlock keeps them clear (#549).
        AppBlockingShared.syncShieldState(to: store)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Backup path when `intervalDidStart` is delayed or dropped — common on
        // recent iOS releases per Apple Developer Forums reports (#549).
        AppBlockingShared.syncShieldState(to: store)
    }
}
#else
import Foundation

/// Simulator stub. The monitor extension is never invoked in simulator (PR e2e)
/// builds; this keeps the target compiling without linking Family Controls, so
/// the simulator build needs no provisioning profile.
final class StillPointMonitorExtension: NSObject {}
#endif
