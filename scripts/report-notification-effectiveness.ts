import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";
import {
  buildNudgeEffectivenessReport,
  DEFAULT_REPORT_DAYS,
  formatNudgeEffectivenessMarkdown,
  resolveReportWindow,
  type ReportWindow,
} from "../src/lib/notifications/effectiveness";
import { assertNeonHostedPostgresUrl } from "./lib/assert-neon-postgres-url";

loadEnvConfig(process.cwd());

const USAGE = `Usage: npm run report:notification-effectiveness -- [--days N] [--end YYYY-MM-DD] [--json]

Nudge -> sit conversion per notification type, including the missed-sit call
(call_attempts), with a with/without-nudge baseline (#675). Read-only: SELECTs
against POSTGRES_URL, which must be a Neon host. Prints Markdown ready to paste
into an issue comment. See docs/notifications.md, "Measuring effectiveness".

  --days N           trailing window length in local days (default ${DEFAULT_REPORT_DAYS})
  --end YYYY-MM-DD   last local day in the window (default: two days before
                     today, UTC, the last day closed in every timezone)
  --json             print the report as JSON instead of Markdown
  -h, --help         show this help`;

/** Parsed flags, or null for --help. Throws on a bad flag or value. */
function readOptions(): { window: ReportWindow; json: boolean } | null {
  const { values } = parseArgs({
    options: {
      days: { type: "string" },
      end: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    return null;
  }
  return {
    window: resolveReportWindow({
      days: values.days === undefined ? undefined : Number(values.days),
      end: values.end,
    }),
    json: values.json,
  };
}

async function main() {
  let options: ReturnType<typeof readOptions>;
  try {
    options = readOptions();
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options === null) {
    console.log(USAGE);
    return;
  }

  const postgresUrl = (process.env.POSTGRES_URL ?? "").trim();
  if (!postgresUrl) {
    throw new Error("POSTGRES_URL is required. A read-only role is enough. See docs/notifications.md.");
  }
  assertNeonHostedPostgresUrl(postgresUrl);
  process.env.POSTGRES_URL = postgresUrl;

  const { window: reportWindow, json } = options;
  // stderr, so stdout stays paste-ready.
  console.error(`[report] host=${new URL(postgresUrl).host} window=${reportWindow.start}..${reportWindow.end}`);

  const report = await buildNudgeEffectivenessReport(reportWindow);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatNudgeEffectivenessMarkdown(report));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
