import * as React from "react"
import { cn } from "@/lib/cn"
import { Tabs as TabsPrimitive } from "radix-ui"

/**
 * 分頁的共用外觀（DESIGN.md 第 10 節）：44px 高、選取時文字轉前景色並在下緣出現 2px 墨色標線，不加底色、不用燈色；
 * 標線淡入用 --dur-sweep。自己管理 ARIA 的分頁（多股比較圖表模式、AI 分析、後台）也用這兩組 class。
 */
export const tabListClass = "flex min-w-0 items-stretch border-b"
export const tabTriggerClass =
  "relative inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-flash) ease-flash hover:text-foreground focus-lamp disabled:pointer-events-none disabled:opacity-50 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity after:duration-(--dur-sweep) after:ease-flash [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
/** 選取中的分頁（手動管理時加上；ui/tabs 用 data-state 自動套用） */
export const tabTriggerActiveClass = "text-foreground after:opacity-100"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn(tabListClass, className)} {...props} />
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabTriggerClass, "data-[state=active]:text-foreground data-[state=active]:after:opacity-100", className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none focus-lamp", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
