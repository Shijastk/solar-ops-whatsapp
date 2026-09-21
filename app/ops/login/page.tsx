import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operations Login | Solar Ops",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OpsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="opsLoginShell">
      <section className="opsLoginCard">
        <p className="opsBrand">SOLAR OPS</p>
        <h1>Operations</h1>
        <p className="opsLoginCopy">
          Sign in to review received WhatsApp messages and temporary files.
        </p>

        {params.error ? (
          <p className="opsAlert" role="alert">
            Access key is incorrect.
          </p>
        ) : null}

        <form className="opsLoginForm" action="/api/ops/session" method="post">
          <label htmlFor="accessKey">Access key</label>
          <input
            id="accessKey"
            name="accessKey"
            type="password"
            autoComplete="current-password"
            required
          />
          <button type="submit">Open dashboard</button>
        </form>

        <p className="opsLoginHint">
          The dashboard uses a secure HttpOnly session. No Supabase or Meta
          secret is exposed to the browser.
        </p>
      </section>
    </main>
  );
}
