import { useState } from "react";
import { api } from "../api/client";

interface Props {
  requestType: "case" | "person";
  targetId: string;
  targetLabel: string;
}

export default function RequestAccessButton({ requestType, targetId, targetLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"sent" | string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setResult("Please explain why you need access.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      await api.createAccessRequest({ request_type: requestType, target_id: targetId, reason: reason.trim() });
      setResult("sent");
    } catch (e: any) {
      setResult(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result === "sent") {
    return (
      <div className="bg-good/10 border border-good/30 rounded-md px-4 py-3 text-sm text-good">
        Access request sent for {targetLabel}. An Admin Investigator will review it.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2"
      >
        Request Access
      </button>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-4 max-w-md">
      <div className="text-sm text-gray-200 font-medium mb-2">
        Request access to {targetLabel}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why do you need this? (e.g. a lead connects to this case/subject)"
        rows={3}
        className="w-full bg-[#0f1420] border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent resize-none"
      />
      {result && result !== "sent" && <div className="text-bad text-xs mt-1.5">{result}</div>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md bg-accent text-bg text-xs font-semibold hover:bg-accent2 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Submit Request"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-md border border-border text-gray-300 text-xs font-semibold hover:bg-[#1a2130]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}