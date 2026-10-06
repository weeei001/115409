import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"
import { Slot } from "radix-ui"

/** 內文連結：中性細底線，hover 轉墨色（燈色留給 focus 與主要按鈕，DESIGN.md 開頭第 3 點） */
export const textLinkClass =
  "underline decoration-input underline-offset-4 transition-colors duration-(--dur-flash) ease-flash hover:decoration-foreground"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium tracking-wide whitespace-nowrap transition-colors duration-(--dur-flash) ease-flash outline-none focus-lamp disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // 燈：主要動作才用，一個視窗最多兩個燈色元素
        default: "border border-brand-deep bg-primary text-primary-foreground hover:bg-brand-deep hover:text-on-brand dark:hover:text-on-brand",
        destructive: "border border-danger-border bg-danger-muted text-danger hover:bg-danger hover:text-background",
        outline: "border border-input bg-card text-foreground hover:border-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-11 px-4 py-2 has-[>svg]:px-3",
        sm: "h-11 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-12 px-6 text-[15px] has-[>svg]:px-4",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
