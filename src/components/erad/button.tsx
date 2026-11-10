import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring relative inline-flex h-8 min-h-8 items-center justify-center gap-1 rounded-control px-3 text-sm whitespace-nowrap select-none [&_svg]:size-4 [&_svg]:shrink-0 aria-disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default:
          "border border-border-btn text-text-main hover:bg-btn-default-hover hover:text-text-contrast active:bg-btn-default-press aria-disabled:border-border-subtle aria-disabled:text-text-disabled aria-disabled:hover:bg-transparent aria-disabled:hover:text-text-disabled",
        primary:
          "bg-btn-primary text-text-on-primary hover:bg-btn-primary-hover active:bg-btn-primary-press aria-disabled:bg-input-disabled aria-disabled:text-text-disabled",
        destructive:
          "bg-status-critical text-text-on-primary hover:brightness-90 active:brightness-80 aria-disabled:bg-input-disabled aria-disabled:text-text-disabled aria-disabled:hover:brightness-100",
        ghost:
          "text-text-main hover:bg-item-hover aria-disabled:text-text-disabled aria-disabled:hover:bg-transparent",
        "ai-primary":
          "bg-ai-gradient text-text-on-primary after:absolute after:inset-0 after:rounded-control hover:after:bg-layer-system/10 active:after:bg-layer-system/20 aria-disabled:opacity-50",
        "ai-default":
          "bg-ai-gradient p-px text-text-main aria-disabled:opacity-50 [&>span]:flex [&>span]:h-full [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:rounded-[2px] [&>span]:bg-layer-content [&>span]:px-3 hover:[&>span]:bg-item-hover",
      },
      size: {
        default: "",
        icon: "w-8 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Unavailable but focusable: the reason must be shown nearby as text. */
  unavailable?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, unavailable, onClick, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-disabled={unavailable || undefined}
      onClick={(e) => {
        if (unavailable) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {variant === "ai-default" ? <span>{children}</span> : children}
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
