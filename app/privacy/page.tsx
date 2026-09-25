import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Solar Ops",
  description:
    "Privacy policy for the Solar Ops WhatsApp ingestion prototype.",
};

const sections = [
  {
    title: "1. What Solar Ops does",
    paragraphs: [
      "Solar Ops is an internal operations prototype that receives WhatsApp messages and supported media through the WhatsApp Business Platform so operational communications can be stored and handled securely.",
      "Solar Ops may allow an authorized operator to manually reply to an operational WhatsApp message from the protected internal dashboard. When the optional document-automation feature is enabled, the service may also send a transactional bill summary and correction controls in response to a document received from that same WhatsApp user. It does not automatically send marketing messages or advertising through WhatsApp.",
    ],
  },
  {
    title: "2. Information we process",
    paragraphs: [
      "When a message is sent or forwarded to the Solar Ops WhatsApp destination, the service may process information supplied by WhatsApp, including the sender identifier, sender name when provided, message identifiers, timestamps, destination phone-number metadata, message type, message text, filenames, MIME types, and supported media such as documents, images, audio, video, or stickers.",
      "Do not send information that is unnecessary for the operational purpose of the service.",
    ],
  },
  {
    title: "3. Why we process this information",
    paragraphs: [
      "We process this information to receive and preserve operational communications, maintain message history, prevent duplicate processing, extract and verify useful structured fields from supported business documents, securely retain raw media temporarily, support authorized replies and corrections, troubleshoot delivery problems, and validate the reliability and security of the Solar Ops workflow.",
      "We do not use WhatsApp message content for advertising, profiling, or sale to third parties.",
    ],
  },
  {
    title: "4. Service providers",
    paragraphs: [
      "Solar Ops relies on service providers to operate the system. WhatsApp and Meta deliver messages through the WhatsApp Business Platform, Vercel hosts the application runtime, Supabase provides database and private file storage services, and Groq may process bounded extracted document text when optional AI-assisted document verification is enabled.",
      "These providers may process data as necessary to provide their services and are subject to their own terms and privacy practices.",
    ],
  },
  {
    title: "5. Storage and retention",
    paragraphs: [
      "Operational message metadata, verified or manually corrected document fields, bounded extracted document text, document workflow audit records, and reply history may be stored in the Solar Ops database. Supported raw media is copied from temporary Meta download locations into private Supabase Storage and is intended to be temporary working data rather than permanent archival storage.",
      "Successfully processed raw media is cleanup-targeted after approximately 24 hours, although scheduler timing may delay deletion. Structured operational records may be retained longer when needed for the operational purpose, security, troubleshooting, or applicable legal obligations. Test fixtures used by the automated integration suite are designed to be deleted after each test run.",
    ],
  },
  {
    title: "6. Security",
    paragraphs: [
      "Solar Ops uses server-side credentials, webhook signature validation, sender restrictions, destination phone-number checks, idempotent message handling, and private media storage as part of its security controls.",
      "No internet service can guarantee absolute security. Access to production credentials and stored operational data is restricted to authorized operators and service infrastructure.",
    ],
  },
  {
    title: "7. Sharing and disclosure",
    paragraphs: [
      "Solar Ops does not sell personal information or WhatsApp message content.",
      "Information may be disclosed to the service providers described above when required to operate the system, or when disclosure is required by applicable law, regulation, court order, or a valid legal request.",
    ],
  },
  {
    title: "8. Access, correction, and deletion",
    paragraphs: [
      "A person whose information is processed by Solar Ops may request access, correction, or deletion where applicable. Requests can be made to the Solar Ops operator through the same business WhatsApp contact used to communicate with Solar Ops.",
      "A request may require reasonable verification before data is disclosed, corrected, or deleted.",
    ],
  },
  {
    title: "9. Children",
    paragraphs: [
      "Solar Ops is an internal business operations service and is not intended for use by children.",
    ],
  },
  {
    title: "10. Changes to this policy",
    paragraphs: [
      "This policy may be updated when the service, providers, or legal requirements change. Material changes will be reflected on this page with a revised effective date.",
    ],
  },
  {
    title: "11. Contact",
    paragraphs: [
      "For privacy questions or data requests, contact the Solar Ops operator through the business WhatsApp channel used to communicate with Solar Ops.",
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <main className="policyShell">
      <article className="policyCard">
        <Link className="backLink" href="/">
          ← Solar Ops
        </Link>

        <p className="eyebrow">PRIVACY</p>
        <h1 className="policyTitle">Privacy Policy</h1>
        <p className="policyMeta">Effective date: 25 September 2026</p>

        <p className="policyIntro">
          This Privacy Policy explains how the Solar Ops WhatsApp ingestion
          prototype handles information received through the WhatsApp Business
          Platform.
        </p>

        <div className="policySections">
          {sections.map((section) => (
            <section className="policySection" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
