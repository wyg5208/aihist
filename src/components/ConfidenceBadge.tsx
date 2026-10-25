import type { Confidence } from "../types";
import { CONFIDENCE_META } from "../lib/format";

export function ConfidenceBadge({
  confidence,
  compact = false,
}: {
  confidence: Confidence;
  compact?: boolean;
}) {
  const meta = CONFIDENCE_META[confidence] || CONFIDENCE_META.single;
  return (
    <span
      className="confidence-badge"
      data-level={confidence}
      title={meta.hint}
    >
      <span className="confidence-mark" aria-hidden="true">
        {confidence === "verified" ? "◆◆" : confidence === "likely" ? "◆" : "◇"}
      </span>
      {compact ? (
        <span className="sr-only">{meta.label}</span>
      ) : (
        <span>{meta.label}</span>
      )}
    </span>
  );
}
