import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../../lib/cn";
import { inputCls } from "../../lib/fieldCls";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, className)} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "resize-none", className)} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, "appearance-none", className)} />;
}

export function Label({
  children,
  required,
  className,
}: {
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mb-1.5 block text-xs font-semibold tracking-wide text-fg-muted",
        className,
      )}
    >
      {children}
      {required && <span className="text-danger"> *</span>}
    </span>
  );
}

/** Label + control + error message, stacked. */
export function Field({
  label,
  required,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <Label required={required}>{label}</Label>}
      {children}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </label>
  );
}
