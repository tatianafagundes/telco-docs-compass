import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TextFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "prefix"
> {
  label: string;
  helper?: string | undefined;
  error?: string | undefined;
  prefix?: React.ReactNode | undefined;
  suffix?: React.ReactNode | undefined;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, helper, error, prefix, suffix, id, className, readOnly, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const descId = `${inputId}-desc`;
    const hasDesc = Boolean(error || helper);
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <label htmlFor={inputId} className="type-label-14 text-text-main">
          {label}
          {props.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        <div
          className={cn(
            "flex min-h-8 items-stretch border bg-input",
            error ? "border-border-error" : "border-border-input hover:border-border-input-hover",
            "focus-within:border-focus",
            readOnly && "border-transparent bg-input-disabled",
          )}
        >
          {prefix ? (
            <span className="flex items-center bg-input-prefix px-2 text-text-secondary">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            readOnly={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={hasDesc ? descId : undefined}
            className="type-label-14 min-w-0 flex-1 bg-transparent px-2 text-text-main outline-none placeholder:text-text-secondary"
            {...props}
          />
          {suffix ? (
            <span className="flex items-center px-2 text-text-secondary">{suffix}</span>
          ) : null}
        </div>
        {hasDesc ? (
          <span
            id={descId}
            // EDS: the error icon is red and the message uses the text colour, so the message reads
            // at 4.5:1 in both themes (red text on the dark layer is about 3.3:1).
            className={cn(
              "type-label-12 flex items-start gap-1",
              error ? "text-text-main" : "text-text-secondary",
            )}
          >
            {error ? (
              <AlertCircle
                aria-hidden="true"
                data-error-icon=""
                className="mt-px size-3.5 shrink-0 text-border-error"
              />
            ) : null}
            {error ?? helper}
          </span>
        ) : null}
        {/* A message that appears is announced at once; the visible line above is what the field is described by. */}
        {error ? (
          <span role="alert" className="sr-only">
            {error}
          </span>
        ) : null}
      </div>
    );
  },
);
TextField.displayName = "TextField";
