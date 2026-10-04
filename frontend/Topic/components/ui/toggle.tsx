import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"
import { Toggle as TogglePrimitive } from "radix-ui"

/**
 * 切換鈕。按下的狀態用粗線＋淺底，不用燈色；hover 時文字轉前景色。
 * square：方框切換鈕（期間、均線、篩選、金額預設）。原生 <button aria-pressed> 也可以直接套
 * toggleVariants({ variant: "square" })，和 Radix 的 data-state=on 長得一樣。
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm text-sm font-medium whitespace-nowrap outline-none transition-colors duration-(--dur-flash) ease-flash focus-lamp disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent text-subtle hover:bg-accent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground",
        outline:
          "border border-input bg-transparent text-subtle hover:border-foreground hover:bg-accent hover:text-foreground data-[state=on]:border-border-strong data-[state=on]:bg-accent data-[state=on]:text-foreground",
        square:
          "border border-input bg-card text-subtle hover:border-foreground hover:text-foreground aria-pressed:border-border-strong aria-pressed:bg-accent aria-pressed:text-foreground data-[state=on]:border-border-strong data-[state=on]:bg-accent data-[state=on]:text-foreground",
      },
      size: {
        default: "h-11 min-w-11 px-3",
        sm: "h-11 min-w-11 px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
