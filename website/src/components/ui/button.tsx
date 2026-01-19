import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#002F5D] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#002F5D] text-white shadow hover:bg-[#003d7a]",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600",
        outline:
          "border border-[#002F5D] bg-white text-[#002F5D] shadow-sm hover:bg-[#eef5fb] hover:text-[#002F5D]",
        secondary:
          "bg-[#eef5fb] text-[#002F5D] shadow-sm hover:bg-[#e0eef9]",
        ghost: "hover:bg-[#eef5fb] hover:text-[#002F5D] text-zinc-700",
        link: "text-[#002F5D] underline-offset-4 hover:underline hover:text-[#003d7a]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, children, ...props }, ref) => {
    if (asChild && React.isValidElement<{ className?: string }>(children)) {
      const child = children
      return React.cloneElement(child, {
        ...child.props,
        ...props,
        className: cn(buttonVariants({ variant, size }), className, child.props.className),
      })
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
