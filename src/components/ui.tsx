import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black/85 disabled:bg-ink/30",
  accent: "bg-accent text-white hover:brightness-110 disabled:bg-accent/40",
  secondary: "bg-white text-ink border border-line-strong hover:bg-bg disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-black/5 disabled:text-ink-3",
  danger: "bg-white text-bad border border-bad/30 hover:bg-bad-soft disabled:opacity-50",
};

export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[.98] disabled:cursor-not-allowed select-none whitespace-nowrap",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variants[variant],
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} role="status" aria-label="Loading" />;
}

export function ProgressBar({ value, indeterminate }: { value?: number; indeterminate?: boolean }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/[.07]" role="progressbar" aria-valuenow={indeterminate ? undefined : value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full bg-accent transition-all duration-500", indeterminate && "bar-indeterminate relative")} style={{ width: indeterminate ? "100%" : `${Math.max(3, value ?? 0)}%` }} />
    </div>
  );
}

const tones = {
  neutral: "bg-black/5 text-ink-2",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  accent: "bg-accent-soft text-accent",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">{children}</h3>
      {aside}
    </div>
  );
}

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}
export type IconName = keyof typeof ICONS;
const ICONS = {
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-9 9" /></>,
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m12 12 8-4.5M12 12 4 7.5M12 12v9" /></>,
  send: <><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /></>,
  download: <><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></>,
  expand: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  shrink: <><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></>,
  grid: <><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  axes: <><path d="M5 19V5m0 14h14M5 19l6-6" /></>,
  ruler: <><path d="m3 17 14-14 4 4L7 21l-4-4Z" /><path d="m8 8 2 2M11 5l2 2M5 11l2 2" /></>,
  wire: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9M4 16.5 12 12l8 4.5" opacity=".5" /></>,
  ghost: <><path d="M6 20V10a6 6 0 0 1 12 0v10l-3-2-3 2-3-2-3 2Z" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4.5h4.5" /></>,
  warn: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  printer: <><path d="M7 9V4h10v5M7 17H4v-7h16v7h-3" /><rect x="7" y="14" width="10" height="6" rx="1" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  upload: <><path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14" /></>,
  wrench: <><path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5 2.5-2.5Z" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" /></>,
} as const;
