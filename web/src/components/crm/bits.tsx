import { useEffect, useRef, useState, type ReactNode } from "react"
import { animate, motion } from "motion/react"
import { Check, ChevronDown, ChevronUp, ChevronsUp, Copy, Equal, User } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { TONE, type Tone, avatarColor, initials, stageOf } from "@/lib/format"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function Lozenge({ tone = "gray", children, className }: { tone?: Tone | string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[18px] items-center whitespace-nowrap rounded-[3px] px-1 text-[11px] font-bold uppercase leading-4 tracking-[0.01em]", TONE[tone as Tone] || TONE.gray, className)}>
      {children}
    </span>
  )
}

export const StageLozenge = ({ stage }: { stage: string }) => {
  const s = stageOf(stage)
  return <Lozenge tone={s.tone}>{s.name}</Lozenge>
}

const PRIO_ICON: Record<string, { icon: any; color: string; label: string }> = {
  urgent: { icon: ChevronsUp, color: "#c9372c", label: "Highest" },
  high: { icon: ChevronUp, color: "#e2483d", label: "High" },
  medium: { icon: Equal, color: "#d97008", label: "Medium" },
  low: { icon: ChevronDown, color: "#1d7afc", label: "Low" },
}
export function PriorityIcon({ priority, withLabel = false }: { priority: string; withLabel?: boolean }) {
  const p = PRIO_ICON[priority] || PRIO_ICON.medium
  const Icon = p.icon
  const icon = <Icon className="size-4 shrink-0" style={{ color: p.color }} strokeWidth={2.6} />
  if (withLabel) return <span className="inline-flex items-center gap-1.5">{icon}{p.label}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{icon}</span></TooltipTrigger>
      <TooltipContent>{p.label} priority</TooltipContent>
    </Tooltip>
  )
}

export function UserAvatar({ name, size = 24, className, tooltip = true }: { name: string; size?: number; className?: string; tooltip?: boolean }) {
  const unassigned = !name || name === "Unassigned"
  const el = (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none", unassigned && "bg-[#dcdfe4] text-[#626f86]", className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: unassigned ? undefined : avatarColor(name) }}
    >
      {unassigned ? <User style={{ width: size * 0.58, height: size * 0.58 }} /> : initials(name)}
    </span>
  )
  if (!tooltip) return el
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>{unassigned ? "Unassigned" : name}</TooltipContent>
    </Tooltip>
  )
}

/** Jira-like issue type square */
export function TypeIcon({ kind }: { kind: "lead" | "task" }) {
  return (
    <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] text-white", kind === "lead" ? "bg-[#22a06b]" : "bg-[#1d7afc]")}>
      {kind === "lead" ? <User className="size-2.5" strokeWidth={3} /> : <Check className="size-2.5" strokeWidth={3.5} />}
    </span>
  )
}

export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const c = animate(prev.current, value, { duration: 0.8, ease: [0.16, 1, 0.3, 1], onUpdate: setN })
    prev.current = value
    return () => c.stop()
  }, [value])
  return <>{format(n)}</>
}

export function PageHeader({ crumbs, title, actions, children }: { crumbs?: string[]; title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex gap-2 text-sm text-muted-foreground">
        {["Venonto", "CRM", ...(crumbs || [])].map((c, i, a) => (
          <span key={c + i} className="flex gap-2">
            <span className="hover:text-foreground hover:underline">{c}</span>
            {i < a.length - 1 && <span className="text-border">/</span>}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: any; title: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center px-4 py-10 text-center text-muted-foreground">
      <div className="mb-3 grid size-14 place-items-center rounded-full bg-brand-subtle text-brand">
        <Icon className="size-7" strokeWidth={1.6} />
      </div>
      <div className="mb-1 font-semibold text-foreground">{title}</div>
      <div className="max-w-sm text-sm">{children}</div>
    </motion.div>
  )
}

export function CopyField({ value, mono = true }: { value?: string | null; mono?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border bg-sunken py-0.5 pr-0.5 pl-2.5">
      <code className={cn("min-w-0 flex-1 truncate", mono ? "font-mono text-[12.5px]" : "text-sm")}>{value || "—"}</code>
      <button
        type="button"
        disabled={!value}
        className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
        onClick={() => {
          if (!value) return
          navigator.clipboard.writeText(value)
          setDone(true)
          toast.success("Copied to clipboard")
          setTimeout(() => setDone(false), 1400)
        }}
      >
        <motion.span key={String(done)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          {done ? <Check className="size-4 text-[#1f845a]" /> : <Copy className="size-4" />}
        </motion.span>
      </button>
    </div>
  )
}

export function LiveDot({ status }: { status: "ok" | "warn" | "err" | "idle" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "ok" && "animate-pulse-ring bg-[#22a06b]",
        status === "warn" && "bg-[#e2b203]",
        status === "err" && "bg-destructive",
        status === "idle" && "bg-[#8590a2]",
      )}
    />
  )
}
