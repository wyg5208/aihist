import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  InputHTMLAttributes,
  ReactNode,
} from "react";

/**
 * Form atoms. Pages compose these instead of writing Tailwind per page: the plan
 * forbids page-local styling, and every filter bar in the console is the same
 * label-above-control shape.
 */

export const INPUT_CLASS =
  "mt-1 w-full rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] outline-none placeholder:text-[var(--c-text-mute)] focus:border-[var(--c-line-strong)]";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--c-radius)] border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_TONE: Record<ButtonTone, string> = {
  primary:
    "border-[var(--c-accent)] bg-[var(--c-accent)] text-[#101216] hover:brightness-110",
  default:
    "border-[var(--c-line-strong)] bg-transparent text-[var(--c-text)] hover:bg-[var(--c-surface-2)]",
  ghost:
    "border-transparent bg-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]",
  danger:
    "border-[var(--c-danger)] bg-transparent text-[var(--c-danger)] hover:bg-[#241514]",
};

export type ButtonTone = "primary" | "default" | "ghost" | "danger";

export function Button({
  tone = "default",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button type="button" {...rest} className={`${BUTTON_BASE} ${BUTTON_TONE[tone]} ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-4 text-[var(--c-text-mute)]">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const handle = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value);
  return (
    <input
      {...rest}
      type={type}
      value={value}
      onChange={handle}
      placeholder={placeholder}
      className={`${INPUT_CLASS} ${rest.className ?? ""}`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  includeEmpty,
  emptyLabel = "全部",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  includeEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_CLASS}
    >
      {includeEmpty && <option value="">{emptyLabel}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--c-line)] px-3 py-2">
          <h2 className="label">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? "p-3" : ""}>{children}</div>
    </section>
  );
}
