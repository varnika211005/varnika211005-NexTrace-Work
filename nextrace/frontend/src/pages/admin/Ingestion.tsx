import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { api } from "../../api/client";

const DATASETS = [
  { key: "persons", title: "Persons / FIR Master Records", desc: "Subject profiles: identity, case, crime type, contact details.", accept: ".csv", filename: "persons.csv", evidenceType: null as string | null },
  { key: "cdr", title: "Call Detail Records (CDR)", desc: "Phone call and SMS logs between subjects.", accept: ".csv", filename: "cdr_records.csv", evidenceType: "CDR" },
  { key: "financial", title: "Financial Records", desc: "Bank transfer / transaction logs.", accept: ".csv", filename: "financial_records.csv", evidenceType: "Financial" },
  { key: "cctv", title: "CCTV Sighting Metadata", desc: "Camera sightings resolved via vehicle plate or face-match name.", accept: ".csv", filename: "cctv_sightings.csv", evidenceType: "CCTV" },
  { key: "reports", title: "Investigation / FIR Reports", desc: "Free-text narrative reports, scanned for subject name mentions.", accept: ".csv", filename: "investigation_reports.csv", evidenceType: "Report" },
];

export default function Ingestion() {
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, "append" | "replace">>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewRows, setViewRows] = useState<any[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    api.ingestionFiles().then(setFiles).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  function modeFor(key: string): "append" | "replace" {
    return modes[key] || "append";
  }

  async function handleUpload(key: string, fileList: FileList) {
    const filesToUpload = Array.from(fileList);
    if (filesToUpload.length === 0) return;
    const mode = modeFor(key);
    setUploading(key);
    setError(null);
    try {
      const summaries: string[] = [];
      for (let i = 0; i < filesToUpload.length; i++) {
        setUploadProgress(filesToUpload.length > 1 ? `File ${i + 1} of ${filesToUpload.length}…` : null);
        // Only the FIRST file in a multi-file batch can "replace" - the rest always append,
        // otherwise each subsequent file would wipe out the one before it.
        const effectiveMode = i === 0 ? mode : "append";
        const result = await api.uploadDataset(key, filesToUpload[i], effectiveMode);
        summaries.push(result.message);
      }
      setMessages((m) => ({
        ...m,
        [key]: filesToUpload.length > 1 ? `${filesToUpload.length} files processed. Latest: ${summaries[summaries.length - 1]}` : summaries[0],
      }));
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
      setUploadProgress(null);
    }
  }

  async function handleDelete(key: string) {
    setDeleting(key);
    setError(null);
    try {
      const result = await api.deleteDataset(key);
      setMessages((m) => ({ ...m, [key]: result.message }));
      setConfirmDelete(null);
      if (viewing === key) setViewing(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleView(key: string) {
    if (viewing === key) {
      setViewing(null);
      return;
    }
    setViewing(key);
    setViewLoading(true);
    setViewRows([]);
    try {
      const cfg = DATASETS.find((d) => d.key === key)!;
      if (key === "persons") {
        const entities = await api.listEntities({ include_unresolved: "false" });
        setViewRows(entities.slice(0, 50));
      } else {
        const evidence = await api.evidenceList({ evidence_type: cfg.evidenceType! });
        setViewRows(evidence.slice(0, 50));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setViewLoading(false);
    }
  }

  function statusFor(key: string) {
    return files.find((f) => f.dataset_type === key);
  }

  return (
    <div>
      <PageHeader title="Data Ingestion" subtitle="Upload evidence into NexTrace. New records are added to what's already there by default — nothing is lost as your dataset grows.">
        <Link to="/admin/processing" className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Go to Processing →</Link>
      </PageHeader>

      {error && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-4 py-3">{error}</div>}

      {/* Upload cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        {DATASETS.map((d) => {
          const status = statusFor(d.key);
          const hasData = status && status.records_count > 0;
          const mode = modeFor(d.key);
          return (
            <div key={d.key} className="bg-card border border-border rounded-lg p-5">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-gray-100 font-semibold text-sm">{d.title}</div>
                  <div className="text-muted text-xs mt-1">{d.desc}</div>
                </div>
                {hasData && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-good/10 text-good border border-good/30 whitespace-nowrap">
                    {status.records_count} records
                  </span>
                )}
              </div>

              {/* Mode toggle - append (safe default) vs replace (destructive) */}
              <div className="flex gap-3 mt-3 text-xs">
                <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name={`mode-${d.key}`}
                    checked={mode === "append"}
                    onChange={() => setModes((m) => ({ ...m, [d.key]: "append" }))}
                  />
                  Add to existing data
                </label>
                <label className="flex items-center gap-1.5 text-muted cursor-pointer">
                  <input
                    type="radio"
                    name={`mode-${d.key}`}
                    checked={mode === "replace"}
                    onChange={() => setModes((m) => ({ ...m, [d.key]: "replace" }))}
                  />
                  Replace entire dataset
                </label>
              </div>
              {mode === "replace" && hasData && (
                <div className="mt-2 text-[11px] text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
                  This will permanently delete all {status.records_count} existing records before loading the new file.
                </div>
              )}

              <div
                onClick={() => inputRefs.current[d.key]?.click()}
                className="mt-3 border-2 border-dashed border-border rounded-lg py-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent/50 transition-colors"
              >
                <div className="text-muted text-xs">Expected filename: <span className="mono text-gray-300">{d.filename}</span> — you can select multiple files at once</div>
                <div className="text-accent text-xs font-medium mt-2">
                  {uploading === d.key ? (uploadProgress || "Uploading…") : "Click to browse CSV (one or more)"}
                </div>
                <input
                  ref={(el) => (inputRefs.current[d.key] = el)}
                  type="file"
                  accept={d.accept}
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files && e.target.files.length > 0) handleUpload(d.key, e.target.files); e.target.value = ""; }}
                />
              </div>

              {messages[d.key] && <div className="mt-3 text-good text-xs bg-good/10 border border-good/30 rounded px-3 py-2">{messages[d.key]}</div>}
            </div>
          );
        })}
      </div>

      {/* Uploaded files table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-gray-100">Uploaded Files</h3>
          <p className="text-xs text-muted mt-0.5">Every dataset currently stored in the database. View a sample of the records, or delete a dataset entirely.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3 font-semibold">Dataset</th>
              <th className="text-left px-5 py-3 font-semibold">Filename</th>
              <th className="text-left px-5 py-3 font-semibold">Records</th>
              <th className="text-left px-5 py-3 font-semibold">Uploaded By</th>
              <th className="text-left px-5 py-3 font-semibold">Status</th>
              <th className="text-right px-5 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {DATASETS.map((d) => {
              const status = statusFor(d.key);
              const hasData = status && status.records_count > 0;
              return (
                <Fragment key={d.key}>
                  <tr className="border-t border-border">
                    <td className="px-5 py-3 text-gray-200">{d.title}</td>
                    <td className="px-5 py-3 mono text-gray-400 text-xs">{status?.filename || "—"}</td>
                    <td className="px-5 py-3 mono text-gray-200">{status?.records_count ?? 0}</td>
                    <td className="px-5 py-3 text-muted text-xs">{status?.uploaded_by || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${hasData ? "bg-good/10 text-good border-good/30" : "bg-muted/10 text-muted border-border"}`}>
                        {hasData ? "Uploaded" : "Not Uploaded"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {hasData && (
                        <>
                          <button onClick={() => handleView(d.key)} className="text-accent text-xs font-medium hover:underline mr-4">
                            {viewing === d.key ? "Hide" : "View"}
                          </button>
                          {confirmDelete === d.key ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-bad text-xs">Confirm?</span>
                              <button disabled={deleting === d.key} onClick={() => handleDelete(d.key)} className="text-bad text-xs font-semibold hover:underline disabled:opacity-50">
                                {deleting === d.key ? "Deleting…" : "Yes"}
                              </button>
                              <button onClick={() => setConfirmDelete(null)} className="text-muted text-xs hover:underline">Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmDelete(d.key)} className="text-bad text-xs font-medium hover:underline">
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  {viewing === d.key && (
                    <tr key={`${d.key}-view`} className="border-t border-border bg-[#0f1420]">
                      <td colSpan={6} className="px-5 py-4">
                        {viewLoading ? (
                          <div className="text-muted text-xs">Loading preview…</div>
                        ) : viewRows.length === 0 ? (
                          <div className="text-muted text-xs">No records to show.</div>
                        ) : d.key === "persons" ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted uppercase tracking-wider">
                                <tr><th className="text-left py-1.5 pr-4">ID</th><th className="text-left py-1.5 pr-4">Name</th><th className="text-left py-1.5 pr-4">Crime Type</th><th className="text-left py-1.5 pr-4">Case</th><th className="text-left py-1.5 pr-4">City</th></tr>
                              </thead>
                              <tbody>
                                {viewRows.map((r: any) => (
                                  <tr key={r.id} className="border-t border-border/60">
                                    <td className="py-1.5 pr-4 mono text-gray-400">{r.id}</td>
                                    <td className="py-1.5 pr-4 text-gray-200">{r.name}</td>
                                    <td className="py-1.5 pr-4 text-gray-300">{r.crime_type || "—"}</td>
                                    <td className="py-1.5 pr-4 mono text-gray-300">{r.case_id || "—"}</td>
                                    <td className="py-1.5 pr-4 text-gray-300">{r.city || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted uppercase tracking-wider">
                                <tr><th className="text-left py-1.5 pr-4">ID</th><th className="text-left py-1.5 pr-4">Timestamp</th><th className="text-left py-1.5 pr-4">Summary</th></tr>
                              </thead>
                              <tbody>
                                {viewRows.map((r: any) => (
                                  <tr key={r.id} className="border-t border-border/60">
                                    <td className="py-1.5 pr-4 mono text-gray-400">{r.id}</td>
                                    <td className="py-1.5 pr-4 mono text-gray-400">{r.timestamp || "—"}</td>
                                    <td className="py-1.5 pr-4 text-gray-300">{r.summary}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {viewRows.length === 50 && <div className="text-muted text-[10px] mt-2">Showing first 50 records.</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}