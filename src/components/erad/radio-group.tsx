import * as RadioPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  label: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}

export function RadioGroup({ label, options, ...props }: RadioGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="type-label-14 mb-1">{label}</legend>
      <RadioPrimitive.Root className="flex flex-col gap-2" {...props}>
        {options.map((o) => (
          <label key={o.value} className="type-label-14 inline-flex min-h-6 cursor-pointer items-center gap-2">
            <RadioPrimitive.Item
              value={o.value}
              disabled={o.disabled}
              className={cn(
                "focus-ring group flex size-4 items-center justify-center rounded-full",
                "disabled:cursor-not-allowed",
              )}
            >
              <span className="flex size-3 items-center justify-center rounded-full border border-border-input bg-input group-hover:border-border-input-hover group-disabled:border-border-subtle">
                <RadioPrimitive.Indicator className="size-1.5 rounded-full bg-input-selected" />
              </span>
            </RadioPrimitive.Item>
            <span className={o.disabled ? "text-text-disabled" : undefined}>{o.label}</span>
          </label>
        ))}
      </RadioPrimitive.Root>
    </fieldset>
  );
}
