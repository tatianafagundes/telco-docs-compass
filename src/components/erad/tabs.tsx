import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface TextTab {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

/** Text tab bar: 32px row, Label 14, 2px selected indicator (product gap component). */
export function TextTabs({ tabs, defaultValue, label }: { tabs: TextTab[]; defaultValue: string; label: string }) {
  return (
    <TabsPrimitive.Root defaultValue={defaultValue} className="flex flex-col">
      <TabsPrimitive.List aria-label={label} className="flex gap-4 border-b border-border-subtle">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="focus-ring type-label-14 h-8 border-b-2 border-transparent px-1 text-text-secondary hover:text-text-main data-[state=active]:border-border-selected data-[state=active]:text-text-main"
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((t) => (
        <TabsPrimitive.Content key={t.value} value={t.value} className="pt-4 outline-none">
          {t.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export interface NavTab {
  value: string;
  caption: string;
  icon: LucideIcon;
}

/** ERAD tab navigation items, 80x58 with icon and caption. */
export function NavTabs({ items, value, onValueChange, label }: {
  items: NavTab[];
  value: string;
  onValueChange: (v: string) => void;
  label: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List aria-label={label} className="flex">
        {items.map(({ value: v, caption, icon: Icon }) => (
          <TabsPrimitive.Trigger
            key={v}
            value={v}
            className="type-label-12 flex h-[58px] w-20 flex-col items-center justify-center gap-1 border-b-2 border-transparent hover:bg-cell-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus data-[state=active]:border-border-selected data-[state=active]:bg-cell-selected"
          >
            <Icon aria-hidden="true" className="size-6" />
            {caption}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
