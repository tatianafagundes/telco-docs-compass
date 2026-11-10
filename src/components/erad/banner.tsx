import type { ReactNode } from "react";
import { Tag, type TagTone } from "@/components/erad/tag";

export interface BannerProps {
  tone: TagTone;
  status: string;
  children: ReactNode;
  action?: ReactNode;
}

export function Banner({ tone, status, children, action }: BannerProps) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-border-item p-3">
      <Tag tone={tone}>{status}</Tag>
      <div className="type-paragraph-14 min-w-[12rem] flex-1">{children}</div>
      {action}
    </div>
  );
}
