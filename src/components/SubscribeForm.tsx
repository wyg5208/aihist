import { useState, type FormEvent } from "react";
import { requestJson } from "../api";

interface Props {
  /** `?src=` value so the funnel can tell the four touch points apart. */
  source: string;
  inputClass: string;
  buttonClass: string;
  buttonLabel?: string;
  /** Small print under the field, replaced by the result once submitted. */
  note?: string;
  noteClass?: string;
}

interface Accepted {
  ok: boolean;
  status: string;
  confirmUrl: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; confirmUrl: string }
  | { kind: "error" };

/**
 * The archive has no outbound mailer — the console says so plainly — so the
 * confirmation link comes back in the response and is shown here instead of
 * being sent. A reader who never opens it stays `pending`, which is the honest
 * record of what happened.
 */
export function SubscribeForm({
  source,
  inputClass,
  buttonClass,
  buttonLabel = "订阅",
  note,
  noteClass,
}: Props) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || phase.kind === "sending") return;
    setPhase({ kind: "sending" });
    try {
      const data = await requestJson<Accepted>("/api/v1/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          consent: true,
          sourcePath: `/subscribe?src=${source}`,
        }),
      });
      setPhase({ kind: "done", confirmUrl: data.confirmUrl });
    } catch {
      setPhase({ kind: "error" });
    }
  };

  if (phase.kind === "done") {
    return (
      <p className={noteClass} role="status" aria-live="polite">
        已记录 {email}。本站不发确认邮件，请现在打开并收藏
        <a
          href={phase.confirmUrl}
          className="ml-1 underline decoration-current underline-offset-2"
        >
          确认链接
        </a>
        。
      </p>
    );
  }

  if (phase.kind === "error") {
    return (
      <p className={noteClass} role="status" aria-live="polite">
        订阅暂时不可用，
        <a
          href={`/api/v1/subscribe?src=${source}`}
          className="underline decoration-current underline-offset-2"
        >
          打开订阅页
        </a>
        或者稍后再试。
      </p>
    );
  }

  return (
    <form className="flex" onSubmit={submit}>
      <input
        type="email"
        name="email"
        required
        maxLength={254}
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        aria-label="邮箱地址"
        className={inputClass}
      />
      <button type="submit" className={buttonClass} disabled={phase.kind === "sending"}>
        {phase.kind === "sending" ? "提交中" : buttonLabel}
      </button>
      {note && <span className="sr-only">{note}</span>}
    </form>
  );
}
