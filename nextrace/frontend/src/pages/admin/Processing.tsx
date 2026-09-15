import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { StatusBadge } from "../../components/Badge";
import { api } from "../../api/client";

export default function Processing() {
  const [job, setJob] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function poll(jobId: number) {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const j = await api.getJob(jobId);
      setJob(j);
      if (j.status === "Completed" || j.status === "Failed") stopPolling();
    }, 500);
  }

  useEffect(() => {
    api.listJobs().then((jobs) => {
      if (jobs.length > 0) {
        setJob(jobs[0]);
        if (jobs[0].status === "Running") poll(jobs[0].id);
      }
    });
    return stopPolling;
  }, []);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const result = await api.startProcessing();
      const j = await api.getJob(result.job_id);
      setJob(j);
      poll(result.job_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Processing Pipeline" subtitle="Runs entity extraction, entity resolution, relationship/graph construction, and pattern analysis across all ingested evidence.">
        <button onClick={start} disabled={starting || job?.status === "Running"} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-40">
          {job?.status === "Running" ? "Processing…" : "Start Processing"}
        </button>
      </PageHeader>

      {error && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-4 py-3">{error}</div>}

      {!job ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted text-sm">
          No processing jobs yet. Upload datasets in{" "}
          <Link to="/admin/ingestion" className="text-accent underline">Data Ingestion</Link>, then start processing.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <div className="text-gray-100 font-semibold">Job #{job.id}</div>
              <div className="text-xs text-muted">Started by {job.started_by}</div>
            </div>
            <StatusBadge status={job.status} />
          </div>

          <div className="space-y-3">
            {job.stages.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-4">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    s.status === "Completed" ? "bg-good/20 text-good" : s.status === "Running" ? "bg-accent/20 text-accent animate-pulse" : "bg-[#1a2130] text-muted"
                  }`}
                >
                  {s.status === "Completed" ? "✓" : i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-200">{s.name}</div>
                  {s.status === "Completed" && s.records !== null && <div className="text-xs text-muted">{s.records} record(s) processed</div>}
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>

          {job.status === "Completed" && (
            <div className="mt-6 pt-4 border-t border-border flex gap-3">
              <Link to="/" className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">View Dashboard →</Link>
              <Link to="/entity-resolution" className="px-4 py-2 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">
                Review Entity Resolution →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
