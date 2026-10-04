import * as React from "react"
import { cn } from "@/lib/cn"
import { toneBadge, type BadgeTone } from "@/lib/utils/tone"

/**
 * 徽章：2px 圓角的小方框標籤（DESIGN.md 第 4 節），配色只來自 toneBadge（lib/utils/tone.ts）。
 * emphasis 用在漲跌淡底上的小字；size="sm" 是 11px 的表格內小標。
 */
function Badge({
  className,
  tone = "neutral",
  emphasis = false,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & {
  tone?: BadgeTone
  emphasis?: boolean
  size?: "default" | "sm"
}) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
        size === "sm" ? "text-[11px]" : "text-xs",
        toneBadge(tone, { emphasis }),
        className
      )}
      {...props}
    />
  )
}

export { Badge }
