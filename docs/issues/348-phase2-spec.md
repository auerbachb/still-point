# Issue #348 — Phase 2 refactor spec (draft)

**Status:** Blocked on Phase 1 real-device verify + design sign-off in [#348](https://github.com/auerbachb/still-point/issues/348).

## Phase 1 — Owner: human (real iOS device)

Use this checklist when posting findings on the issue:

| Step | Expected (PR #271 / `main`) | Pass? | Notes |
|------|-----------------------------|-------|-------|
| Install TestFlight build with Family Controls entitlement | App installs; Settings shows **APP GATE** | | |
| Grant Screen Time permission | Picker opens after "Choose apps" | | |
| Select 1–2 apps | `selectedCount` badge; status: blocked until session | | |
| Open blocked app before sit | Shield / block UI from iOS | | |
| Complete **standard** timer naturally | Completion shows **APP GATE OPEN**; apps usable | | |
| End session **early** | No unlock; apps stay blocked | | |
| Wait 2+ hours (or change device time) | Apps re-block; status no longer "Unlocked until …" | | |
| **Quick minute** (#239) complete | Apps stay blocked (by design today) | | |
| Buddy session complete | Apps unlock (`unlockAppGate: true` always) | | |
| Foreground after background | `RootView` calls `refreshShielding()` — state consistent | | |
| Add app to list while **unlocked** | New app should stay open until 2hr window ends | | |
| "Lock now" while unlocked | Immediate re-block | | |

File separate bugs for anything broken beyond the model change.

---

## Static audit of merged PR #271 (`AppBlockingManager`)

**Surface area (14 files in PR #271):**

- `ios/StillPointApp/Managers/AppBlockingManager.swift` — core state + shields
- `ios/StillPointApp/Views/AppBlockingSettingsView.swift` — picker + copy
- `ios/StillPointApp/ViewModels/AppViewModel.swift` — `completeSession(unlockAppGate:)`
- `ios/StillPointApp/Views/SessionView.swift`, `CompletionView.swift`, `HomeView.swift`, `RootView.swift`
- `StillPoint.entitlements` — `com.apple.developer.family-controls`
- UITest: `testCompletedSessionUnlocksConfiguredAppGate` (settings smoke only; no shield E2E)

**Current model (time-based):**

- `unlockUntil = Date() + 2 hours` on natural **standard** completion
- `isUnlocked` ⇔ `unlockUntil > Date()`
- Midnight **not** used; timer + foreground `refreshShielding()` handle expiry
- Quick sessions: `unlockAppGate: completedNaturally && sessionType == .standard` → **no** unlock
- Buddy: `unlockAppGate: true` always → unlocks gate even without standard sit

**Gap vs Phase 2 AC — "mid-day toggle off":**

- No master on/off toggle today. Disabling ≈ clear selection or "Lock now" (only while unlocked).
- Phase 2 should add **`appBlocking.isEnabled`** (or equivalent) with immediate `clearShielding()` when turned off.

**Gap vs daily model — second session early end:**

- `completeSession(..., unlockAppGate: false)` calls `prepareForSession()`, which **clears** `unlockUntil`.
- If user already earned unlock today, a later abandoned sit would **re-lock** under a daily model unless `prepareForSession` is changed to preserve `unlockedForDate` for the calendar day.

**Mid-day blocklist add (while unlocked):**

- `refreshShielding()` → `clearShielding()` when `isUnlocked` — new tokens stay open until window ends. ✓ aligns with Phase 2 "earned" behavior.

---

## Phase 2 target state machine

```text
States: MORNING_BLOCKED | EARNED_UNLOCKED  (per calendar day, device local TZ)

MORNING_BLOCKED + session_completed_today     → EARNED_UNLOCKED
EARNED_UNLOCKED + local_midnight              → MORNING_BLOCKED
Any + blocking_disabled (toggle off)            → shields cleared immediately
EARNED_UNLOCKED + add_apps_to_blocklist       → new apps stay UNLOCKED today
MORNING_BLOCKED + add_apps_to_blocklist       → new apps BLOCKED immediately
```

### Persistence (replace v1 time keys)

| Key | Type | Meaning |
|-----|------|---------|
| `appBlocking.selection.v1` | Data | unchanged |
| `appBlocking.unlockedForDate.v1` | Date | last calendar day user **earned** unlock (start-of-day or completion instant — use `Calendar.current.startOfDay` for comparisons) |
| `appBlocking.isEnabled.v1` | Bool | master gate toggle (default `true` when selection non-empty) |

Remove: `appBlocking.unlockUntil.v1`, `unlockWindow`, 2-hour timer (replace with optional **midnight** one-shot timer for foreground-across-midnight).

### Core logic changes (`AppBlockingManager`)

```swift
var isUnlocked: Bool {
    guard isEnabled, hasSelection, let unlockedForDate else { return false }
    return Calendar.current.isDateInToday(unlockedForDate)
}

func unlockAfterCompletedSession() {
    unlockedForDate = Date() // or startOfDay(for: Date())
    // persist, clearShielding(), didUnlockFromLastCompletedSession = true
}

func refreshShielding() {
    if let unlockedForDate, !Calendar.current.isDateInToday(unlockedForDate) {
        self.unlockedForDate = nil // midnight rollover
    }
    guard isEnabled, hasSelection else { clearShielding(); return }
    guard !isUnlocked else { clearShielding(); scheduleMidnightTimerIfNeeded(); return }
    applyShielding()
}

func prepareForSession() {
    // Only reset completion badge — do NOT clear unlockedForDate
    didUnlockFromLastCompletedSession = false
}
```

### `AppViewModel.completeSession`

- Keep `unlockAppGate` gating; align with design decision on quick + buddy (see below).
- `prepareForSession()` must not revoke today's earned unlock.

### Copy updates

| Location | New copy |
|----------|----------|
| `AppBlockingSettingsView` | "Blocked until you complete today's meditation, then unlocked until midnight. Ending early keeps the gate closed." |
| `statusText` blocked | "Locked — meditate to unlock" |
| `statusText` unlocked | "Unlocked until midnight" |
| `HomeView` FAQ | Replace 2-hour wording with daily model |
| `SessionView` hint | "Complete today's sit to open your app gate…" |
| Remove `unlockWindowText` | — |

### Tests

- Unit tests on simulator stub: `isUnlocked` across day boundary (inject `Calendar` or test helper with fixed dates).
- UITest: update status string expectations; optional launch-arg to seed `unlockedForDate`.
- Real device: full cycle AC (human).

---

## Design decisions — need issue comment sign-off

### 1. Quick minute (#239) counts for today's meditation?

| Option | Pros | Cons |
|--------|------|------|
| **A. Standard only** (current code) | Stronger incentive for full sit | Quick sit doesn't help gate |
| **B. Any completed sit** (quick + standard) | Light-touch; matches issue suggestion | 60s may feel like "gaming" the gate |

**Agent recommendation:** **B** if product goal is "any mindfulness today"; **A** if gate is strictly tied to daily progression sit. Document choice in PR body.

**Code today:** `SessionView` passes `unlockAppGate: completedNaturally && sessionType == .standard`.

### 2. Feature flag vs dual mode (casual 2hr / strict daily)?

| Option | Notes |
|--------|-------|
| Replace 2hr entirely | Simplest; matches issue default |
| Feature flag | Safer rollout; more branches in manager |
| Settings: Casual (2hr) / Strict (daily) | User-visible complexity |

**Agent recommendation:** Ship **daily-only** on `main` unless Phase 1 finds 2hr behavior users rely on — then flag.

### 3. Buddy sessions

**Today:** always `unlockAppGate: true`. **Recommend:** same as quick-minute decision — if "any completed sit counts," include buddy; else standard-only.

### 4. Master toggle

Add **Enable app gate** toggle in `AppBlockingSettingsView`; off → `clearShielding()` immediately, persist `isEnabled = false`.

---

## Implementation order (after gates)

1. Manager: date-based state + midnight rollover + `isEnabled` + fix `prepareForSession`
2. ViewModel / session call sites per design decisions
3. Copy (Settings, Home, Session, Completion)
4. Tests + CodeRabbit + real-device full-day cycle

**Do not open Phase 2 PR until Phase 1 comment exists and decisions 1–2 are agreed on the issue.**
