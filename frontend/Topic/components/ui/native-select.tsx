import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/cn"
import { inputClass } from "./input"

/**
 * 原生下拉選單：去掉瀏覽器外觀，換成與輸入框同一套方角外框，右側放 chevron。
 * wrapperClassName 給外層（例如放在標籤下方時的 mt-1.5）。
 */
function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative block min-w-0", wrapperClassName)}>
      <select {...props} data-slot="native-select" className={cn(inputClass, "cursor-pointer appearance-none pr-9", className)}>
        {children}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

export { NativeSelect }
