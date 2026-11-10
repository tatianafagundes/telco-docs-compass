import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ label, className, id, ...props }, ref) => {
    const autoId = React.useId();
    const cid = id ?? autoId;
    const box = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={cid}
        className={cn(
          "focus-ring peer flex size-4 shrink-0 items-center justify-center border border-border-input bg-input text-text-on-primary hover:border-border-input-hover",
          "data-[state=checked]:border-input-selected data-[state=checked]:bg-input-selected data-[state=checked]:hover:bg-input-selected-hover",
          "data-[state=indeterminate]:border-input-selected data-[state=indeterminate]:bg-input-selected",
          "disabled:border-border-subtle disabled:bg-input-disabled",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          {props.checked === "indeterminate" ? (
            <Minus aria-hidden="true" className="size-3" />
          ) : (
            <Check aria-hidden="true" className="size-3" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
    if (!label) return box;
    return (
      <label htmlFor={cid} className="type-label-14 inline-flex min-h-6 cursor-pointer items-center gap-2">
        {box}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
