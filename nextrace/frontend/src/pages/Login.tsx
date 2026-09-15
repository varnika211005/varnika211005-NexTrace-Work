import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [analystId, setAnalystId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(analystId, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center relative overflow-hidden">
      {/* subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#22d3ee 1px, transparent 1px), linear-gradient(90deg, #22d3ee 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-bg font-bold text-lg mb-3">
            NT
          </div>
          <div className="text-gray-100 font-bold text-lg tracking-wide">NEXTRACE</div>
          <div className="text-muted text-xs mt-1 text-center">
            AI-Powered Criminal Network Analysis System
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-5 text-xs text-good">
            <span className="w-1.5 h-1.5 rounded-full bg-good inline-block" />
            Secure investigation environment
          </div>

          <label className="text-xs text-muted uppercase tracking-wider">Analyst ID</label>
          <input
            value={analystId}
            onChange={(e) => setAnalystId(e.target.value)}
            placeholder="e.g. ADMIN01"
            className="w-full mt-1.5 mb-4 bg-[#0f1420] border border-border rounded-md px-3 py-2.5 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent mono"
            autoFocus
          />

          <label className="text-xs text-muted uppercase tracking-wider">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1.5 mb-5 bg-[#0f1420] border border-border rounded-md px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
          />

          {error && (
            <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent2 disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-5 text-center text-[11px] text-muted leading-relaxed">
          Demo credentials — Admin: <span className="mono text-gray-400">ADMIN01 / admin123</span>
          <br />
          Investigator: <span className="mono text-gray-400">INV204 / investigator123</span>
        </div>
        <div className="mt-3 text-center text-[10px] text-muted">
          Access is logged. Role and permissions are determined automatically after sign-in.
        </div>
      </div>
    </div>
  );
}
