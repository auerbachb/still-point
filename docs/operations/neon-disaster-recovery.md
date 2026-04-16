# Neon production — disaster recovery and restore

Internal notes for **still-point** production Postgres on [Neon](https://neon.tech). Everything below is from Neon’s public documentation (no account-specific values here). Confirm your org’s **actual plan and project settings** in the [Neon console](https://console.neon.tech).

## What Neon provides (backup / PITR posture)

- **Point-in-time restore (instant restore / PITR)**  
  Neon retains a continuous **WAL history** for the project. You can restore a **root** branch to a timestamp (or LSN) within the configured **restore window**. Restore is an **overwrite** of the whole branch (all databases on that branch), not a merge. Connections to that branch are **briefly interrupted**; connection strings stay the same after the operation.  
  See: [Instant restore](https://neon.com/docs/introduction/branch-restore), [Restore window](https://neon.com/docs/introduction/restore-window).

- **Restore window (plan defaults and caps)**  
  How far back PITR, Time Travel, branching-from-history, and snapshots can reach is governed by **Settings → Instant restore** (`history_retention_seconds` in API terms).

  | Plan (Neon docs) | Default | Maximum |
  |------------------|---------|---------|
  | Free | 6 hours | 6 hours (history capped at 1 GB) |
  | Launch | 1 day | 7 days |
  | Scale | 1 day | 30 days |

  **Production expectation:** paid Launch/Scale defaults to **1 day** of history unless you raise it (up to 7 / 30 days respectively). Free tier is unsuitable for production workloads per Neon’s own production checklist.  
  See: [Restore window](https://neon.com/docs/introduction/restore-window), [Neon plans](https://neon.com/docs/introduction/plans), [Production checklist](https://neon.com/docs/get-started/production-checklist).

- **Automatic safety branch on restore**  
  Before overwriting, Neon can preserve the pre-restore state in a branch named like `{branch}_old_{timestamp}`. Use it if you need to roll back a bad restore. Some backup branches **cannot be deleted** (e.g. when restoring a root branch from another branch).  
  See: [Instant restore — automatic backups](https://neon.com/docs/introduction/branch-restore#automatic-backups).

- **Snapshots and schedules**  
  The console **Backup & restore** flow combines PITR with **snapshots** (manual and, on eligible paid plans, **scheduled** snapshots). Snapshots give named restore points; schedules are separate from “how long WAL is kept” and help when you want **fixed** recovery points. Feature details and plan limits evolve—use [Backup & restore](https://neon.com/docs/guides/backup-restore) and the in-console copy for current limits.

- **Important limitations**  
  - PITR / instant restore applies to **root** branches only (typical `main` / `production`).  
  - Branches created from certain snapshot restore flows may **not** support PITR until Neon finishes background work (see “Limitations” in [Instant restore](https://neon.com/docs/introduction/branch-restore#limitations)).

## RPO and RTO (plain language)

These are **expectations**, not guarantees—tune them with your real **restore window**, snapshot schedule, and runbooks.

- **RPO (Recovery Point Objective)** — how much committed data you might lose in a bad scenario.  
  With **PITR only**, you can usually roll back to any instant within the restore window (down to millisecond granularity in Neon’s model), so logical RPO is on the order of **“changes after your chosen restore timestamp”**, not “last nightly backup.”  
  If a mistake is **older than the restore window**, you need **snapshots**, **logical exports** (e.g. `pg_dump` outside Neon), or another replica—Neon does not magically retain WAL beyond the configured window.  
  **Rule of thumb:** RPO is bounded by **the restore window** plus whatever extra protection you add (snapshots, exports).

- **RTO (Recovery Time Objective)** — how long until the app is usable again.  
  Neon describes restore as completing in **a few seconds** for the database branch itself; your **RTO** includes human time (triage, picking timestamp/LSN, approvals), optional **Time Travel Assist** validation, **Vercel** or app verification, and any **data reconciliation** after restore. Plan for **minutes to tens of minutes** for a controlled incident, longer if people are unavailable.

## Restore / rollback checklist (Neon console)

Use this when production data or schema is wrong and you need to recover **in place** on the same branch/connection string.

1. **Confirm project and branch**  
   Open the **production** Neon project and identify the **root** branch that backs `POSTGRES_URL` in Vercel production.

2. **Optional but strongly recommended: enable “Enhanced” backup UI if you use snapshots**  
   On **Backup & restore**, use the console’s **Enhanced** view if you rely on snapshot workflows (see [Backup & restore](https://neon.com/docs/guides/backup-restore)).

3. **Pick recovery strategy**  
   - **PITR / instant restore:** roll the root branch back to a timestamp/LSN inside the **restore window**.  
   - **Snapshot restore:** restore from a named snapshot (same page / docs above).

4. **Validate the restore point before writing**  
   Use **Time Travel Assist** and/or preview/diff tools so you do not restore to the wrong second.  
   See: [Time Travel Assist](https://neon.com/docs/guides/time-travel-assist), [Schema diff](https://neon.com/docs/guides/schema-diff).

5. **Execute restore and read the confirmation modal**  
   Expect: **full branch overwrite**, **all databases on the branch** affected, **short disconnect** for live traffic.

6. **Keep the auto-created `*_old_*` branch** until you are sure production is healthy.  
   You may need it to **undo** the restore.

7. **Application / hosting**  
   - Vercel still points at the same connection string if you restored **in place**.  
   - Verify app health, run key queries, and watch errors.  
   - If you instead **created a new branch** for investigation only, you must **update** `POSTGRES_URL` (out of scope of Neon alone).

8. **Post-incident**  
   Document root cause, whether restore window was sufficient, and whether snapshot schedules or exports should change.

## Gaps and recommended Neon console settings

If any of these are missing, treat them as **action items** in the Neon console (not code changes here).

| Gap | Recommendation (Neon docs) |
|-----|----------------------------|
| Production on **Free** | Move production to a **paid** plan; Free has compute limits ill-suited for production. [Production checklist](https://neon.com/docs/get-started/production-checklist#use-a-paid-plan-for-production-workloads) |
| **Restore window** too short for how bugs are discovered | Increase under **Settings → Instant restore** (e.g. Neon suggests **up to 7 days** for production tradeoffs on paid plans). [Restore window](https://neon.com/docs/introduction/restore-window), [Production checklist #8](https://neon.com/docs/get-started/production-checklist#set-an-appropriate-restore-window) |
| No **branch protection** on production | Enable **protected branches** so restore/reset/snapshot on production requires explicit intent. [Protected branches](https://neon.com/docs/guides/protected-branches), [Production checklist #4](https://neon.com/docs/get-started/production-checklist#protect-your-production-branch) |
| Production branch not **default root** | Keep production on a **root** branch set as **default** (snapshots, billing, deletion safety). [Production checklist #3](https://neon.com/docs/get-started/production-checklist#keep-your-production-branch-as-the-default) |
| Relying only on WAL window | Add **snapshot schedules** on paid plans where available so you have **named** recovery points outside “continuous window” thinking. [Backup & restore — schedules](https://neon.com/docs/guides/backup-restore#create-backup-schedules) |
| Over-broad network access | Consider **IP Allow** for production endpoints. [IP Allow](https://neon.com/docs/introduction/ip-allow), [Production checklist #13](https://neon.com/docs/get-started/production-checklist#restrict-access-to-production-data) |
| Team never practiced restore | Run a **dry run** in a non-production project: practice Time Travel + restore on a throwaway root branch. [Production checklist #10](https://neon.com/docs/get-started/production-checklist#test-your-restore-workflow) |

## Related repo context

- Production vs non-production topology is described in the main [README](../../README.md) (Neon project split when that section is present).

## Reference links (Neon)

- [Instant restore (PITR)](https://neon.com/docs/introduction/branch-restore)  
- [Restore window](https://neon.com/docs/introduction/restore-window)  
- [Backup & restore (snapshots + UI)](https://neon.com/docs/guides/backup-restore)  
- [Production checklist](https://neon.com/docs/get-started/production-checklist)  
- [Protected branches](https://neon.com/docs/guides/protected-branches)
