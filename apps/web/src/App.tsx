import { Archive, CloudUpload, Download, Image, ShieldCheck } from "lucide-react";

const phases = [
  "Sign in with an email code",
  "Create an upload batch",
  "Upload originals directly to S3",
  "Process display photos",
  "Browse the timeline"
];

export function App() {
  return (
    <main className="shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">album.joe-cui.com</p>
          <h1>Personal Album</h1>
          <p className="lede">
            A private, low-idle-cost photo album for manual uploads, timeline browsing, and original downloads.
          </p>
        </div>
        <div className="status" aria-label="architecture summary">
          <ShieldCheck aria-hidden="true" />
          <span>Private AWS serverless scaffold</span>
        </div>
      </section>

      <section className="toolbar" aria-label="primary actions">
        <button type="button">
          <CloudUpload aria-hidden="true" />
          Upload
        </button>
        <button type="button">
          <Archive aria-hidden="true" />
          Archive
        </button>
        <button type="button">
          <Download aria-hidden="true" />
          Download
        </button>
      </section>

      <section className="timeline" aria-label="timeline scaffold">
        {phases.map((phase, index) => (
          <article className="photo-card" key={phase}>
            <div className="photo-frame">
              <Image aria-hidden="true" />
            </div>
            <div>
              <p className="month">Phase {index + 1}</p>
              <h2>{phase}</h2>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

