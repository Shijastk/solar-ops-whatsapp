import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const repository = process.env.GITHUB_REPOSITORY ?? "unknown";
const sha = process.env.GITHUB_SHA ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? "";
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const shortSha = sha === "unknown" ? sha : sha.slice(0, 12);
const runUrl =
  runId && repository !== "unknown"
    ? `${server}/${repository}/actions/runs/${runId}`
    : "";
const generatedAt = new Date().toISOString();

const checks = [
  "TypeScript typecheck",
  "ESLint",
  "Vitest unit tests",
  "Next.js production build",
];

const listItems = checks
  .map((check) => `<li><span aria-hidden="true">✓</span> ${escapeHtml(check)}</li>`)
  .join("");

const runLink = runUrl
  ? `<a href="${escapeHtml(runUrl)}" rel="noreferrer">Open GitHub Actions run</a>`
  : "GitHub Actions run URL unavailable";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Solar Ops Quality Status</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color-scheme: dark; background: #09110d; color: #eef8f1; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 18px; }
    main { width: min(760px, 100%); border: 1px solid #26372e; border-radius: 20px; padding: clamp(24px, 5vw, 44px); background: #0e1812; }
    .badge { display: inline-flex; gap: 8px; align-items: center; border: 1px solid #2e6a45; border-radius: 999px; padding: 7px 11px; color: #a7f3c1; font-weight: 700; font-size: 13px; }
    h1 { margin: 18px 0 10px; font-size: clamp(34px, 7vw, 58px); letter-spacing: -0.045em; line-height: 1; }
    p { color: #b8c8bd; line-height: 1.7; }
    ul { list-style: none; padding: 0; margin: 28px 0; display: grid; gap: 10px; }
    li { padding: 13px 15px; background: #132019; border-radius: 12px; color: #dcebe0; }
    li span { color: #6ee7a0; font-weight: 800; }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 10px 16px; padding-top: 20px; border-top: 1px solid #26372e; }
    dt { color: #82968a; }
    dd { margin: 0; overflow-wrap: anywhere; }
    a { color: #86efac; }
    .note { margin-top: 26px; font-size: 13px; color: #82968a; }
  </style>
</head>
<body>
  <main>
    <div class="badge">PASS · automated quality gate</div>
    <h1>Solar Ops quality status</h1>
    <p>This static page is generated only after the repository's automated quality checks complete successfully. It does not test or host the WhatsApp webhook runtime.</p>
    <ul>${listItems}</ul>
    <dl>
      <dt>Repository</dt><dd>${escapeHtml(repository)}</dd>
      <dt>Commit</dt><dd><code>${escapeHtml(shortSha)}</code></dd>
      <dt>Generated</dt><dd>${escapeHtml(generatedAt)}</dd>
      <dt>Workflow</dt><dd>${runLink}</dd>
    </dl>
    <p class="note">No secrets, phone numbers, webhook payloads, customer files, or business-cost data are published here.</p>
  </main>
</body>
</html>
`;

const outputDirectory = join(process.cwd(), "artifacts", "pages");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "index.html"), html, "utf8");

console.log(`Quality report written to ${join(outputDirectory, "index.html")}`);
