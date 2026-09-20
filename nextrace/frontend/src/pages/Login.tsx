import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Login.css";

function FingerprintIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-7 h-7"
      aria-hidden="true"
    >
      <path d="M5.625 3.547a9 9 0 0 1 12.75 0" />
      <path d="M8.5 2.035a9 9 0 0 1 7 0" />
      <path d="M12 2v5.5" />
      <path d="M6.1 5.344a9 9 0 0 1 11.8 0" />
      <path d="M3.8 8.3a9 9 0 0 1 16.4 0" />
      <path d="M8 12a4 4 0 0 1 8 0v2a8 8 0 0 1-1.6 4.8" />
      <path d="M4.5 12a7.5 7.5 0 0 1 15 0v3" />
      <path d="M3 15v2a9 9 0 0 0 18 0v-2" />
    </svg>
  );
}

function NetworkMesh() {
  return (
    <div className="login-mesh-fade absolute bottom-0 left-0 right-0 h-[220px] pointer-events-none select-none">
      <svg
        viewBox="0 0 1440 260"
        preserveAspectRatio="none"
        className="w-full h-full"
        aria-hidden="true"
      >
        <g stroke="rgba(56,189,248,0.45)" strokeWidth="1">
          <line x1="80" y1="150" x2="220" y2="96" />
          <line x1="220" y1="96" x2="360" y2="180" />
          <line x1="360" y1="180" x2="520" y2="70" />
          <line x1="520" y1="70" x2="680" y2="160" />
          <line x1="680" y1="160" x2="840" y2="88" />
          <line x1="840" y1="88" x2="1000" y2="180" />
          <line x1="1000" y1="180" x2="1160" y2="120" />
          <line x1="1160" y1="120" x2="1320" y2="150" />
          <line x1="80" y1="150" x2="130" y2="210" />
          <line x1="220" y1="96" x2="300" y2="228" />
          <line x1="360" y1="180" x2="470" y2="214" />
          <line x1="520" y1="70" x2="640" y2="236" />
          <line x1="680" y1="160" x2="820" y2="222" />
          <line x1="840" y1="88" x2="1000" y2="240" />
          <line x1="1000" y1="180" x2="1180" y2="212" />
          <line x1="1160" y1="120" x2="1340" y2="232" />
          <line x1="220" y1="96" x2="360" y2="180" />
          <line x1="360" y1="180" x2="520" y2="70" />
          <line x1="520" y1="70" x2="680" y2="160" />
          <line x1="130" y1="210" x2="300" y2="228" />
          <line x1="300" y1="228" x2="470" y2="214" />
          <line x1="470" y1="214" x2="640" y2="236" />
          <line x1="640" y1="236" x2="820" y2="222" />
          <line x1="820" y1="222" x2="1000" y2="240" />
          <line x1="1000" y1="240" x2="1180" y2="212" />
          <line x1="1180" y1="212" x2="1340" y2="232" />
        </g>
        <g fill="rgba(56,189,248,0.6)">
          <circle cx="80" cy="150" r="2.5" />
          <circle cx="220" cy="96" r="3" />
          <circle cx="360" cy="180" r="2.5" />
          <circle cx="520" cy="70" r="3" />
          <circle cx="680" cy="160" r="2.5" />
          <circle cx="840" cy="88" r="3" />
          <circle cx="1000" cy="180" r="2.5" />
          <circle cx="1160" cy="120" r="2.5" />
          <circle cx="1320" cy="150" r="3" />
          <circle cx="130" cy="210" r="2.5" />
          <circle cx="300" cy="228" r="2.5" />
          <circle cx="470" cy="214" r="2.5" />
          <circle cx="640" cy="236" r="2.5" />
          <circle cx="820" cy="222" r="2.5" />
          <circle cx="1000" cy="240" r="2.5" />
          <circle cx="1180" cy="212" r="3" />
          <circle cx="1340" cy="232" r="2.5" />
        </g>
        <g fill="#7dd3fc">
          <circle cx="220" cy="96" r="1.6" />
          <circle cx="520" cy="70" r="1.6" />
          <circle cx="1000" cy="240" r="1.6" />
          <circle cx="680" cy="160" r="1.4" />
          <circle cx="1180" cy="212" r="1.4" />
        </g>
      </svg>
    </div>
  );
}

function SideTextLeft() {
  return (
    <div
      className="hidden xl:block absolute left-[5%] top-1/2 -translate-y-1/2 pointer-events-none select-none"
      aria-hidden="true"
    >
      <div className="text-[13px] font-light uppercase text-[#7f9cc0] leading-[2.7] tracking-[0.45em]">
        <div className="block">Investigate</div>
        <div className="block">Connect</div>
        <div className="block text-[#a8d4f0]">Secure</div>
      </div>
      <div className="mt-4 h-px w-28 bg-gradient-to-r from-[#22d3ee]/70 to-transparent" />
    </div>
  );
}

function SideTextRight() {
  return (
    <div
      className="hidden xl:block absolute right-[5%] top-1/2 -translate-y-1/2 text-right pointer-events-none select-none"
      aria-hidden="true"
    >
      <div className="text-[13px] font-light uppercase text-[#7f9cc0] leading-[2.7] tracking-[0.45em]">
        <div className="block">Data.</div>
        <div className="block">Intelligence.</div>
        <div className="block">Safer Communities.</div>
      </div>
      <div className="ml-auto mt-4 h-px w-28 bg-gradient-to-l from-[#22d3ee]/70 to-transparent" />
    </div>
  );
}

function BackgroundLayers() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 login-bg" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[820px] h-[820px] rounded-full border border-[rgba(56,189,248,0.14)] shadow-[0_0_120px_rgba(14,90,160,0.25)]" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-[rgba(96,165,250,0.2)] shadow-[0_0_90px_rgba(30,120,210,0.35),inset_0_0_60px_rgba(30,120,210,0.18)]" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.14),transparent_65%)]" />
      <NetworkMesh />
    </div>
  );
}

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
    <div className="relative min-h-[100svh] flex flex-col overflow-x-hidden">
      <BackgroundLayers />
      <SideTextLeft />
      <SideTextRight />

      <main className="login-main relative z-10 flex-1 w-full flex flex-col items-center justify-center px-5 py-6">
        <div className="login-card w-[min(530px,calc(100vw-40px))] rounded-[20px] border border-[rgba(56,189,248,0.45)] bg-[rgba(7,23,40,0.82)] backdrop-blur-[14px] shadow-[0_0_25px_rgba(0,150,255,0.2),0_0_70px_rgba(0,100,255,0.12),inset_0_1px_0_rgba(148,210,255,0.18),inset_0_0_40px_rgba(20,80,140,0.15)] px-8 py-10 sm:px-10">
          <div className="login-logo-row flex flex-col items-center mb-5">
            <img
              src="/logo/nextracelogo.png"
              alt="NexTrace"
              className="w-[340px] max-w-full h-auto object-contain drop-shadow-[0_4px_18px_rgba(56,189,248,0.25)]"
            />
          </div>
          <div className="login-divider h-px w-full mb-7 bg-gradient-to-r from-transparent via-[rgba(56,189,248,0.35)] to-transparent" />

          <form onSubmit={handleSubmit}>
            <div className="login-status flex items-center gap-2.5 mb-7 text-[15px] font-medium text-[#20e88a]">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#20e88a] shadow-[0_0_10px_rgba(32,232,138,0.9)]" />
              Secure investigation environment
            </div>

            <label className="block mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#93a9c4]">
              Analyst ID
            </label>
            <input
              value={analystId}
              onChange={(e) => setAnalystId(e.target.value)}
              placeholder="e.g. ADMIN01"
              className="login-field w-full mb-5 rounded-[10px] border border-[rgba(96,125,165,0.4)] bg-[rgba(10,22,35,0.55)] px-4 py-3 text-sm text-gray-100 placeholder-[#5b6b85] focus:outline-none focus:border-[#38bdf8] focus:ring-2 focus:ring-[rgba(56,189,248,0.25)] mono transition-shadow"
              autoFocus
            />

            <label className="block mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#93a9c4]">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-field w-full mb-5 rounded-[10px] border border-[rgba(96,125,165,0.4)] bg-[rgba(10,22,35,0.55)] px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#38bdf8] focus:ring-2 focus:ring-[rgba(56,189,248,0.25)] transition-shadow"
            />

            {error && (
              <div className="mb-4 rounded-[10px] border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[50px] rounded-[10px] bg-gradient-to-b from-[#13cdf4] to-[#0ca7d6] text-[#04141f] text-[15px] font-semibold tracking-wide hover:from-[#3adcff] hover:to-[#12bde8] hover:shadow-[0_0_22px_rgba(17,197,237,0.45)] active:from-[#0ba4d2] active:to-[#0994bb] disabled:opacity-50 disabled:hover:shadow-none transition-all"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="login-notice mt-5 flex items-center gap-3 rounded-[10px] border border-[rgba(96,160,220,0.28)] bg-[rgba(8,18,30,0.55)] px-3.5 py-3">
            <span className="shrink-0 text-[#38bdf8]">
              <FingerprintIcon />
            </span>
            <p className="text-[13px] leading-relaxed text-[#9fb2c9]">
              <span className="text-[#cfe0f2]">Biometric / passkey sign-in (WebAuthn):</span>{" "}
              not configured in this environment — sign in with your Analyst ID and password.
            </p>
          </div>
        </div>

        <div className="login-demo mt-7 text-center text-[15px] leading-relaxed text-[#7e95b2]">
          Demo credentials — Admin: <span className="mono text-[#a8c4e2]">ADMIN01 / admin123</span>
          <br />
          Investigator: <span className="mono text-[#a8c4e2]">INV204 / investigator123</span>
        </div>
        <div className="login-access mt-2.5 text-center text-[14px] leading-[1.6] text-[#6d829c]">
          Access is logged. Role and permissions are determined automatically after
          <br />
          <span className="whitespace-nowrap">sign-in.</span>
        </div>
      </main>
      <footer className="login-footer relative z-10 shrink-0 px-5 pb-3 text-center text-[13px] text-[#6d829c]">
        © 2026 NexTrace - SIH 2026 Prototype
      </footer>
    </div>
  );
}