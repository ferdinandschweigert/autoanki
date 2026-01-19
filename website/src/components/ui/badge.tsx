import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#002F5D] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-[#2C94CC] bg-[#eef5fb] text-[#002F5D] shadow hover:bg-[#e0eef9]",
        secondary:
          "border-[#e2e8f0] bg-white text-[#002F5D] hover:bg-[#eef5fb]",
        destructive:
          "border-red-300 bg-red-50 text-red-700 shadow hover:bg-red-100",
        outline: "border-[#e2e8f0] bg-white text-[#002F5D]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
