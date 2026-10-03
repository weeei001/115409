import { cn } from "@/lib/cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("q-rows bg-card", className)}
      {...props}
    />
  )
}

export { Skeleton }
