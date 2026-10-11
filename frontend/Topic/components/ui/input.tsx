import * as React from "react"
import { cn } from "@/lib/cn"

/**
 * 全站文字欄位的外觀：2px 圓角、border-input（對比 ≥ 3:1）、44px 高、focus 用 focus-lamp；
 * 手機用 16px 字，iOS 聚焦時才不會放大畫面。<input>、<textarea>、<select> 都從這一份組合。
 */
export const inputClass =
  "h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3 text-base text-foreground outline-none transition-colors duration-(--dur-flash) ease-flash placeholder:text-muted-foreground hover:border-border-strong focus-lamp disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger sm:text-sm"

/** 欄位標籤（表單小標） */
export const fieldLabelClass = "block text-[13px] font-medium tracking-[0.04em] text-subtle"

/** 包住欄位的標籤：同一組字，欄位排在下方 6px；放在 grid 裡也能縮窄（min-w-0） */
export const stackedFieldLabelClass = cn(fieldLabelClass, "flex min-w-0 flex-col gap-1.5")

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputClass,
        "selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
