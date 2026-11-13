import { useMemo, useState } from "react"
import { MessageCircle, Search, SlidersHorizontal } from "lucide-react"
import { useContacts, useSettings, type Contact } from "@/lib/api"
import { STAGES, compact, displayName, money, timeAgo } from "@/lib/format"
import { useUpdateContact } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PageHeader, PriorityIcon, TypeIcon, UserAvatar } from "@/components/crm/bits"
import { ServiceLozenge, TempChip } from "@/components/crm/lead-panel"
import { useUI } from "@/components/crm/dialogs"
import { Kanban } from "@/components/crm/kanban"
import { toast } from "sonner"

export function AssigneeFilter({ people, value, onChange }: { people: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex pl-1">
      {people.map((p) => {
        const on = value.includes(p)
        return (
          <button key={p} onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={cn("-ml-1 rounded-full border-2 border-background transition-transform hover:z-10 hover:-translate-y-0.5", on && "z-10 ring-2 ring-brand")}>
            <UserAvatar name={p} size={30} />
          </button>
        )
      })}
    </div>
  )
}

export default function Board() {
  const { data: contacts, isLoading } = useContacts()
  const { data: settings } = useSettings()
  const update = useUpdateContact()
  const ui = useUI()
  const [q, setQ] = useState("")
  const [people, setPeople] = useState<string[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [onlyUnread, setOnlyUnread] = useState(false)
  const allPeople = [...new Set(["Unassigned", ...(settings?.agents || []), ...(contacts || []).map((c) => c.assignee)])]
  const allLabels = [...new Set((contacts || []).flatMap((c) => c.tags || []))]

  const items = useMemo(() => (contacts || []).filter((c) => {
    if (q && ![c.name, c.phone, c.key, c.company, c.profileName].some((v) => (v || "").toLowerCase().includes(q.toLowerCase()))) return false
    if (people.length && !people.includes(c.assignee)) return false
    if (labels.length && !labels.some((l) => c.tags?.includes(l))) return false
    if (onlyUnread && !c.unread) return false
    return true
  }), [contacts, q, people, labels, onlyUnread])

  const card = (c: Contact) => (
    <>
      <div className="mb-1 font-medium break-words">{displayName(c)}{c.company && <span className="font-normal text-muted-foreground"> · {c.company}</span>}</div>
      {(c.lead?.service || c.lead?.temperature) && <div className="mb-1.5 flex flex-wrap items-center gap-1">{c.lead?.service && <ServiceLozenge service={c.lead.service} />}<TempChip temp={c.lead?.temperature} />{(c.lead?.fields.location || c.lead?.fields.rasLocation) && <span className="truncate text-[11px] text-muted-foreground">📍 {c.lead.fields.location || c.lead.fields.rasLocation}</span>}</div>}
      {c.lastMessage && <div className="mb-2 line-clamp-2 text-xs leading-4 text-muted-foreground">{c.lastMessage}</div>}
      {c.tags?.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {c.tags.slice(0, 3).map((t) => <span key={t} className="rounded-[3px] bg-[#e9f2ff] px-1.5 text-[11px] leading-[18px] font-semibold text-[#0055cc] uppercase">{t}</span>)}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        <TypeIcon kind="lead" />
        <span className="font-semibold text-muted-foreground">{c.key}</span>
        {c.value > 0 && <span className="rounded-[3px] bg-muted px-1 font-medium">{money(c.value)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {c.unread > 0 && <span className="flex items-center gap-0.5 rounded-full bg-brand px-1.5 text-[11px] leading-4 font-bold text-white"><MessageCircle className="size-3" />{c.unread}</span>}
          <span className="text-muted-foreground">{timeAgo(c.lastMessageAt || c.createdAt)}</span>
          <PriorityIcon priority={c.priority} />
          <UserAvatar name={c.assignee} size={22} />
        </span>
      </div>
    </>
  )

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Board"]} title="Pipeline board" actions={<Button onClick={() => ui.openCreate("contact")}>Create lead</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search board" className="h-8 w-44 rounded-md border border-input pr-2 pl-8 transition-all outline-none focus:w-56 focus:border-ring focus:ring-2 focus:ring-ring/25" />
        </div>
        <AssigneeFilter people={allPeople} value={people} onChange={setPeople} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="secondary"><SlidersHorizontal />Label{labels.length > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] text-white">{labels.length}</span>}</Button></DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuLabel>Filter by label</DropdownMenuLabel><DropdownMenuSeparator />
            {allLabels.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">No labels yet</div>}
            {allLabels.map((l) => <DropdownMenuCheckboxItem key={l} checked={labels.includes(l)} onCheckedChange={(on) => setLabels(on ? [...labels, l] : labels.filter((x) => x !== l))}>{l}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="flex items-center gap-2 text-sm text-subtle"><Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} />Only unread</label>
        {(q || people.length || labels.length || onlyUnread) ? <Button variant="ghost" onClick={() => { setQ(""); setPeople([]); setLabels([]); setOnlyUnread(false) }}>Clear filters</Button> : null}
      </div>
      {isLoading ? (
        <div className="flex gap-2">{STAGES.map((s) => <Skeleton key={s.id} className="h-96 w-[272px]" />)}</div>
      ) : (
        <Kanban
          columns={STAGES}
          items={items}
          columnOf={(c) => c.stage}
          renderCard={card}
          onOpen={(c) => ui.openContact(c.id)}
          onMove={(c, stage) => { update.mutate({ id: c.id, patch: { stage } }); toast.success(`${c.key} moved to ${STAGES.find((s) => s.id === stage)?.name}`) }}
          onAdd={(stage) => ui.openCreate("contact", { stage })}
          summary={(l) => { const v = l.reduce((a, c) => a + (Number(c.value) || 0), 0); return v ? `$${compact(v)}` : "" }}
        />
      )}
    </div>
  )
}
