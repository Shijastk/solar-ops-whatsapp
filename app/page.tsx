const capabilities = [
  "Meta webhook verification",
  "Webhook signature validation",
  "Text, image, PDF/document, audio, video and sticker ingestion",
  "Private Supabase Storage uploads",
  "Idempotent message persistence",
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">SOLAR OPS</p>
        <h1>WhatsApp ingestion service</h1>
        <p className="lede">
          A Next.js + TypeScript backend for receiving WhatsApp Cloud API
          messages and securely storing operational media in Supabase.
        </p>

        <div className="status">
          <span className="dot" aria-hidden="true" />
          Application deployed
        </div>

        <div className="grid">
          <article>
            <h2>Webhook</h2>
            <code>/api/whatsapp</code>
            <p>Use this URL as the Meta WhatsApp webhook callback.</p>
          </article>
          <article>
            <h2>Health</h2>
            <code>/api/health</code>
            <p>Checks application configuration without exposing secrets.</p>
          </article>
        </div>

        <ul>
          {capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>

        <footer className="siteFooter">
          <a href="/privacy">Privacy Policy</a>
        </footer>
      </section>
    </main>
  );
}
