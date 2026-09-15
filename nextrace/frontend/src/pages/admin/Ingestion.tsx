import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { api } from "../../api/client";

const DATASETS = [
  { key: "persons", title: "Persons / FIR Master Records", desc: "Subject profiles: identity, case, crime type, contact details.", accept: ".csv", filename: "persons.csv" },
  { key: "cdr", title: "Call Detail Records (CDR)", desc: "Phone call and SMS logs between subjects.", accept: ".csv", filename: "cdr_records.csv" },
  { key: "financial", title: "Financial Records", desc: "Bank transfer / transaction logs.", accept: ".csv", filename: "financial_records.csv" },
  { key: "cctv", title: "CCTV Sighting Metadata", desc: "Camera sightings resolved via vehicle plate or face-match name.", accept: ".csv", filename: "cctv_sightings.csv" },
  { key: "reports", title: "Investigation / FIR Reports", desc: "Free-text narrative reports, scanned for subject name mentions.", accept: ".csv", filename: "investigation_reports.csv" },
];

export default function Ingestion() {
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    api.ingestionFiles().then(setFiles).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(key: string, file: File) {
    setUploading(key);
    setError(null);
    try {
      const result = await api.uploadDataset(key, file);
      setMessages((m) => ({ ...m, [key]: result.message }));
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  }

  function statusFor(key: string) {
    return files.find((f) => f.dataset_type === key);
  }

  return (
    <div>
      <PageHeader title="Data Ingestion" subtitle="Upload authorized investigative datasets into NexTrace. Each upload replaces the prior file of that type.">
        <Link to="/admin/processing" className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Go to Processing →</Link>
      </PageHeader>

      {error && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {DATASETS.map((d) => {
          const status = statusFor(d.key);
          return (
            <div key={d.key} className="bg-card border border-border rounded-lg p-5">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-gray-100 font-semibold text-sm">{d.title}</div>
                  <div className="text-muted text-xs mt-1">{d.desc}</div>
                </div>
                {status && status.status !== "Not Uploaded" && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-good/10 text-good border border-good/30 whitespace-nowrap">
                    {status.records_count} records
                  </span>
                )}
              </div>

              <div
                onClick={() => inputRefs.current[d.key]?.click()}
                className="mt-3 border-2 border-dashed border-border rounded-lg py-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent/50 transition-colors"
              >
                <div className="text-muted text-xs">Expected filename: <span className="mono text-gray-300">{d.filename}</span></div>
                <div className="text-accent text-xs font-medium mt-2">
                  {uploading === d.key ? "Uploading…" : "Click to browse CSV"}
                </div>
                <input
                  ref={(el) => (inputRefs.current[d.key] = el)}
                  type="file"
                  accept={d.accept}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(d.key, f); }}
                />
              </div>

              {messages[d.key] && <div className="mt-3 text-good text-xs bg-good/10 border border-good/30 rounded px-3 py-2">{messages[d.key]}</div>}

              {status && status.uploaded_by && (
                <div className="mt-3 text-[11px] text-muted">
                  Last uploaded by <span className="text-gray-300">{status.uploaded_by}</span> — {status.filename}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
