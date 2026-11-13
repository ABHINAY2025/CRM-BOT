import { useEffect, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Bot, ChevronDown, X } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, useSettings, type Contact, type ContactDetail } from "@/lib/api"
import { PRIORITIES, STAGES, fmtDateTime, money, stageOf } from "@/lib/format"
import { useUpdateContact } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PriorityIcon, UserAvatar } from "./bits"

const STATUS_BTN: Record<string, string> = {
  gray: "bg-[#f1f2f4] text-[#44546f] hover:bg-[#dcdfe4]",
  blue: "bg-brand text-white hover:bg-brand-hover",
  purple: "bg-[#6e5dc6] text-white hover:bg-[#5e4db2]",
  yellow: "bg-[#f8e6a0] text-[#533f04] hover:bg-[#f5cd47]",
  green: "bg-[#1f845a] text-white hover:bg-[#216e4e]",
  red: "bg-[#c9372c] text-white hover:bg-[#ae2e24]",
  teal: "bg-[#206a83] text-white hover:bg-[#164b5b]",
}
const statusBtn = (tone: string) => STATUS_BTN[tone] || STATUS_BTN.gray

export function StageButton({ contact }: { contact: Contact }) {
  const update = useUpdateContact()
  const s = stageOf(contact.stage)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors active:scale-[0.98]", statusBtn(s.tone))}>
          {s.name} <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {STAGES.map((st) => (
          <DropdownMenuItem key={st.id} onClick={() => update.mutate({ id: contact.id, patch: { stage: st.id } })}>
            <span className={cn("size-2 rounded-full", statusBtn(st.tone).split(" ")[0])} />
            {st.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[96px_1fr] items-center gap-2">
      <span className="text-xs font-semibold text-subtle">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function InlineInput({ value, onSave, type = "text", placeholder = "None", display }: { value: string | number; onSave: (v: string) => void; type?: string; placeholder?: string; display?: ReactNode }) {
  const [v, setV] = useState(String(value ?? ""))
  const [editing, setEditing] = useState(false)
  useEffect(() => setV(String(value ?? "")), [value])
  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="flex h-8 w-full items-center truncate rounded-md px-2 text-left transition-colors hover:bg-muted">
        {String(value ?? "") ? display || String(value) : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    )
  const commit = () => { setEditing(false); if (v !== String(value ?? "")) onSave(v) }
  return (
    <input
      autoFocus
      type={type}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setV(String(value ?? "")); setEditing(false) } }}
      className="h-8 w-full rounded-md border-2 border-ring bg-background px-2 outline-none animate-pop-in"
    />
  )
}

export function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("")
  const add = () => { const t = v.trim().toLowerCase(); if (t && !tags.includes(t)) onChange([...tags, t]); setV("") }
  return (
    <div className="flex flex-wrap items-center gap-1 py-1">
      <AnimatePresence initial={false}>
        {tags.map((t) => (
          <motion.span key={t} layout initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}
            className="inline-flex h-6 items-center gap-1 rounded-[3px] border bg-muted pr-1 pl-2 text-xs text-subtle">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="rounded-sm text-muted-foreground hover:bg-border hover:text-foreground"><X className="size-3" /></button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} onBlur={add} placeholder="+ Add tag"
        className="h-6 w-24 rounded-[3px] bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground focus:bg-muted" />
    </div>
  )
}

export function ContactDetails({ contact }: { contact: ContactDetail | Contact }) {
  const update = useUpdateContact()
  const { data: settings } = useSettings()
  const set = (patch: Partial<Contact>) => update.mutate({ id: contact.id, patch })
  const agents = settings?.agents?.length ? settings.agents : ["Unassigned", "Me"]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StageButton contact={contact} />
      </div>
      <div className="rounded-lg border">
        <div className="border-b px-3 py-2.5 font-semibold">Details</div>
        <div className="px-3 py-2">
          <Row label="Assignee">
            <Select value={contact.assignee} onValueChange={(v) => set({ assignee: v })}>
              <SelectTrigger className="h-8 w-full border-transparent shadow-none hover:bg-muted"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set(["Unassigned", ...agents])].map((a) => (
                  <SelectItem key={a} value={a}><UserAvatar name={a} size={20} tooltip={false} />{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Priority">
            <Select value={contact.priority} onValueChange={(v) => set({ priority: v })}>
              <SelectTrigger className="h-8 w-full border-transparent shadow-none hover:bg-muted"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}><PriorityIcon priority={p.id} withLabel /></SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Name"><InlineInput value={contact.name} onSave={(v) => set({ name: v })} placeholder="Add name" /></Row>
          <Row label="Phone"><div className="px-2 font-mono text-[13px]">{contact.phone}</div></Row>
          <Row label="Email"><InlineInput value={contact.email} type="email" onSave={(v) => set({ email: v })} /></Row>
          <Row label="Company"><InlineInput value={contact.company} onSave={(v) => set({ company: v })} /></Row>
          <Row label="Deal value"><InlineInput value={contact.value || ""} type="number" onSave={(v) => set({ value: Number(v) || 0 })} display={money(contact.value)} /></Row>
          <Row label="Labels"><TagsEditor tags={contact.tags || []} onChange={(tags) => set({ tags })} /></Row>
          <Row label="Bot replies">
            <label className="flex items-center gap-2 px-2">
              <Switch checked={!contact.botPaused} onCheckedChange={(on) => set({ botPaused: !on })} />
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Bot className="size-3.5" />{contact.botPaused ? "Paused" : "Active"}</span>
            </label>
          </Row>
        </div>
      </div>
      <div className="space-y-0.5 px-1 text-xs text-muted-foreground">
        <div>Created {fmtDateTime(contact.createdAt)}</div>
        <div>Updated {fmtDateTime(contact.updatedAt)}</div>
      </div>
    </div>
  )
}

export function NotesBox({ contact }: { contact: ContactDetail }) {
  const qc = useQueryClient()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api(`/contacts/${contact.id}/notes`, { method: "POST", body: { text } })
      setText("")
      qc.invalidateQueries({ queryKey: ["contact", contact.id] })
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <div className="flex gap-2">
        <UserAvatar name="Me" size={32} />
        <div className="flex-1">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an internal note…" className="min-h-16"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save() }} />
          <AnimatePresence>
            {text && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={save} disabled={busy}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setText("")}>Cancel</Button>
                  <span className="ml-auto self-center text-xs text-muted-foreground">Ctrl + Enter</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {contact.notes.map((n) => (
            <motion.div key={n.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2">
              <UserAvatar name={n.by} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm"><b className="font-semibold">{n.by}</b> <span className="text-muted-foreground">{fmtDateTime(n.at)}</span></div>
                <div className="whitespace-pre-wrap break-words">{n.text}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
