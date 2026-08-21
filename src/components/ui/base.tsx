import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/classes";

/* Prymitywy interfejsu. Celowo bez biblioteki komponentow: caly wyglad
   wynika z tokenow w globals.css, wiec nic nie przynosi cudzych decyzji. */

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg hover:bg-accent-strong border border-transparent font-semibold",
  secondary: "bg-surface-2 text-text border border-line-strong hover:border-faint hover:bg-surface-3",
  quiet: "bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-text",
  danger: "bg-transparent text-loss border border-loss/40 hover:bg-loss/10",
};

const SIZES = {
  s: "h-7 px-2.5 text-xs gap-1.5",
  m: "h-9 px-3.5 text-sm gap-2",
  l: "h-11 px-5 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "m",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof SIZES }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-[var(--radius-control)] whitespace-nowrap",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("panel", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(bodyClassName)}>{children}</div>
    </section>
  );
}

export function Label({
  children,
  htmlFor,
  required,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="etykieta block">
        {children}
        {required && <span className="ml-1 text-accent">*</span>}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

const FIELD_CLASSES =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 py-2 " +
  "text-sm text-text placeholder:text-faint " +
  "transition-colors duration-150 hover:border-faint " +
  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent " +
  "disabled:opacity-50 aria-[invalid=true]:border-loss";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(FIELD_CLASSES, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(FIELD_CLASSES, "min-h-24 resize-y", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cx(FIELD_CLASSES, "cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
}

/**
 * Checkbox z etykieta w jednej linii. Natywny input, zeby formularz dzialal
 * bez JS-a i zeby stan trafial do FormData tak samo jak reszta pol.
 */
export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: ComponentProps<"input"> & { label: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <input
          type="checkbox"
          className={cx(
            "size-4 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line-strong",
            "bg-surface-2 accent-accent transition-colors duration-150 hover:border-faint",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            "disabled:cursor-not-allowed",
            className,
          )}
          {...rest}
        />
        <span className="text-sm text-text">{label}</span>
      </label>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  color,
  title,
  className,
}: {
  children: ReactNode;
  color?: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-1.5 py-0.5 text-xs",
        !color && "border-line-strong text-muted",
        className,
      )}
      style={
        color ? { borderColor: `${color}55`, color, backgroundColor: `${color}14` } : undefined
      }
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-muted">{title}</p>
      {description && <p className="max-w-md text-xs text-faint">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] border border-loss/40 bg-loss-dim px-3 py-2 text-sm text-loss"
    >
      {children}
    </p>
  );
}

export function SuccessMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-[var(--radius-control)] border border-profit/40 bg-profit-dim px-3 py-2 text-sm text-profit">
      {children}
    </p>
  );
}

/** Para etykieta + wartosc, uzywana na karcie trade'a i w podsumowaniach. */
export function DataPoint({
  label,
  children,
  className,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={className}>
      <p className="etykieta">{label}</p>
      <p className={cx("liczba mt-0.5 text-sm text-text", valueClassName)}>{children}</p>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-t border-line", className)} />;
}
