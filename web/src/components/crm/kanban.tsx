import { useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

type Col = { id: string; name: string; tone?: string; footer?: ReactNode }

export function Kanban<T extends { id: string }>({ columns, items, columnOf, renderCard, onMove, onOpen, onAdd, summary }: {
  columns: readonly Col[]
  items: T[]
  columnOf: (t: T) => string
  renderCard: (t: T) => ReactNode
  onMove: (t: T, col: string) => void
  onOpen: (t: T) => void
  onAdd?: (col: string) => void
  summary?: (items: T[]) => ReactNode
}) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  return (
    <div className="scrollbar-thin flex min-h-[calc(100vh-240px)] items-start gap-2 overflow-x-auto pb-4">
      {columns.map((col, ci) => {
        const colItems = items.filter((i) => columnOf(i) === col.id)
        return (
          <motion.div key={col.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ci * 0.04, type: "spring", stiffness: 300, damping: 28 }}
            className={cn("flex max-h-[calc(100vh-240px)] w-[272px] shrink-0 flex-col rounded-lg bg-muted transition-colors", over === col.id && drag && "bg-brand-subtle")}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== col.id) setOver(col.id) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData("text/plain")
              const it = items.find((i) => i.id === id)
              if (it && columnOf(it) !== col.id) onMove(it, col.id)
              setOver(null); setDrag(null)
            }}>
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 text-xs font-semibold tracking-wide text-subtle uppercase">
              {col.name}
              <motion.span key={colItems.length} initial={{ scale: 1.4, color: "#0c66e4" }} animate={{ scale: 1, color: "#626f86" }} className="font-medium">{colItems.length}</motion.span>
              <span className="ml-auto font-medium tracking-normal text-muted-foreground normal-case">{summary?.(colItems)}</span>
            </div>
            <div className={cn("scrollbar-thin flex min-h-16 flex-col gap-1 overflow-y-auto rounded-b-lg px-2 pb-2", over === col.id && drag && "outline-2 -outline-offset-4 outline-[#579dff] outline-dashed")}>
              <AnimatePresence initial={false} mode="popLayout">
                {colItems.map((it) => (
                  <motion.div key={it.id} layout layoutId={it.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: drag === it.id ? 0.4 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}>
                    <div draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", it.id); e.dataTransfer.effectAllowed = "move"; setDrag(it.id) }}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      onClick={() => onOpen(it)}
                      className="cursor-pointer rounded-md bg-card px-3 pt-2.5 pb-2 shadow-card transition-[background,box-shadow,transform] select-none hover:-translate-y-px hover:bg-[#fafbfc] hover:shadow-raised active:cursor-grabbing">
                      {renderCard(it)}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {onAdd && (
                <button onClick={() => onAdd(col.id)} className="mt-0.5 flex h-8 items-center gap-1.5 rounded-md px-2 text-left font-medium text-subtle transition-colors hover:bg-[#dcdfe4]">
                  <Plus className="size-4" />Create
                </button>
              )}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
