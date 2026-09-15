interface Props {
  score: number;
  band?: "High" | "Medium" | "Low";
  size?: "sm" | "md";
}
const BAND_STYLES: Record<string, string> = {
  High: "bg-good/10 text-good border-good/30",
  Medium: "bg-warn/10 text-warn border-warn/30",
  Low: "bg-bad/10 text-bad border-bad/30",
};
export default function ConfidenceBadge({ score, band, size = "sm" }: Props) {
  const resolvedBand = band || (score >= 70 ? "High" : score >= 40 ? "Medium" : "Low");
  const padding = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-1 rounded border font-semibold mono ${padding} ${BAND_STYLES[resolvedBand]}`}>
      {score.toFixed(0)}% · {resolvedBand.toUpperCase()}
    </span>
  );
}
