import { useMemo, useState } from "react"
import { CalendarClock, Link2, Search } from "lucide-react"
import { toast } from "sonner"
import { useSettings, useTasks, type Task } from "@/lib/api"
import { TASK_STATUSES, displayName } from "@/lib/format"
import { useUpdateTask } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader, PriorityIcon, TypeIcon, UserAvatar } from "@/components/crm/bits"
import { useUI } from "@/components/crm/dialogs"
import { Kanban } from "@/components/crm/kanban"
import { AssigneeFilter } from "./board"

export default function Tasks() {
  const { data: tasks, isLoading } = useTasks()
  const { data: settings } = useSettings()
  const update = useUpdateTask()
  const ui = useUI()
  const [q, setQ] = useState("")
  const [people, setPeople] = useState<string[]>([])
  const allPeople = [...new Set(["Unassigned", ...(settings?.agents || [])])]
  const today = new Date(new Date().toDateString())

  const items = useMemo(() => (tasks || []).filter((t) =>
    (!q || [t.title, t.key, t.contact?.name].some((v) => (v || "").toLowerCase().includes(q.toLowerCase()))) && (!people.length || people.includes(t.assignee))), [tasks, q, people])

  const card = (t: Task) => {
    const overdue = t.status !== "done" && t.dueDate && new Date(t.dueDate + "T00:00") < today
    return (
      <>
        <div className={cn("mb-2 font-medium break-words", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</div>
        {t.contact?.id && <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"><Link2 className="size-3" />{t.contact.key} · {displayName(t.contact)}</div>}
        <div className="flex items-center gap-1.5 text-xs">
          <TypeIcon kind="task" /><span className="font-semibold text-muted-foreground">{t.key}</span>
          {t.dueDate && (
            <span className={cn("flex items-center gap-1 rounded-[3px] px-1", overdue ? "bg-[#ffeceb] font-semibold text-[#ae2e24]" : "text-muted-foreground")}>
              <CalendarClock className="size-3" />{new Date(t.dueDate + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5"><PriorityIcon priority={t.priority} /><UserAvatar name={t.assignee} size={22} /></span>
        </div>
      </>
    )
  }

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Tasks"]} title="Tasks" actions={<Button onClick={() => ui.openCreate("task")}>Create task</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-8 w-44 rounded-md border border-input pr-2 pl-8 transition-all outline-none focus:w-56 focus:border-ring focus:ring-2 focus:ring-ring/25" />
        </div>
        <AssigneeFilter people={allPeople} value={people} onChange={setPeople} />
      </div>
      {isLoading ? <div className="flex gap-2">{TASK_STATUSES.map((s) => <Skeleton key={s.id} className="h-80 w-[272px]" />)}</div> : (
        <Kanban
          columns={TASK_STATUSES}
          items={items}
          columnOf={(t) => t.status}
          renderCard={card}
          onOpen={(t) => ui.openTask(t)}
          onMove={(t, status) => { update.mutate({ id: t.id, patch: { status: status as Task["status"] } }); if (status === "done") toast.success(`${t.key} done ✓`) }}
          onAdd={(status) => ui.openCreate("task", { status })}
        />
      )}
    </div>
  )
}
