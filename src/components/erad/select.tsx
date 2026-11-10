import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import * as React from "react";

export interface SelectGroup {
  label?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

export interface SelectProps {
  label: string;
  groups: SelectGroup[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onValueChange?: (v: string) => void;
}

export function Select({ label, groups, placeholder, ...props }: SelectProps) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <label id={id} className="type-label-14">
        {label}
      </label>
      <SelectPrimitive.Root {...props}>
        <SelectPrimitive.Trigger
          aria-labelledby={id}
          className="focus-ring type-label-14 flex h-9 min-w-40 items-center justify-between gap-2 rounded-control border border-border-btn pr-2 pl-3 text-text-main hover:bg-btn-default-hover hover:text-text-contrast data-[state=open]:bg-btn-default-press data-[state=open]:text-text-contrast"
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown aria-hidden="true" className="size-4" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={2}
            className="shadow-elev-1 z-50 min-w-[var(--radix-select-trigger-width)] bg-item text-text-main"
          >
            <SelectPrimitive.Viewport>
              {groups.map((g, gi) => (
                <SelectPrimitive.Group key={g.label ?? gi}>
                  {gi > 0 ? <SelectPrimitive.Separator className="h-px bg-border-subtle" /> : null}
                  {g.label ? (
                    <SelectPrimitive.Label className="type-label-12 flex h-[30px] items-center px-2 text-text-secondary">
                      {g.label}
                    </SelectPrimitive.Label>
                  ) : null}
                  {g.options.map((o) => (
                    <SelectPrimitive.Item
                      key={o.value}
                      value={o.value}
                      disabled={o.disabled ?? false}
                      className="type-label-14 flex h-8 cursor-pointer items-center px-2 outline-none data-[disabled]:text-text-disabled data-[highlighted]:bg-item-hover data-[state=checked]:bg-item-selected data-[state=checked]:text-text-on-primary"
                    >
                      <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
