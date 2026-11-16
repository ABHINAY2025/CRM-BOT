import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { AlertCircle, Bot, Check, CheckCheck, Clock, ExternalLink, FileText, MessageCircle, MessageSquareText, PanelRightClose, PanelRightOpen, Phone, Search, Send, Sparkles, Zap } from "lucide-react"
import { api, useContact, useContacts, useRules, useSettings, type ContactDetail, type Message } from "@/lib/api"
import { displayName, fmtDate, fmtTime, timeAgo, windowLeft } from "@/lib/format"
import { useSendMessage } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState, Lozenge, StageLozenge, UserAvatar } from "@/components/crm/bits"
import { ContactDetails, NotesBox } from "@/components/crm/contact-details"
import { LeadPanel, ServiceLozenge, TempChip } from "@/components/crm/lead-panel"
import { useUI } from "@/components/crm/dialogs"

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "open", label: "Open 24h" },
  { id: "mine", label: "Mine" },
] as const

function Tick({ m }: { m: Message }) {
  if (m.direction === "in") return null
  if (m.status === "failed") return <AlertCircle className="size-3.5 text-destructive" />
  if (m.status === "pending") return <Clock className="size-3" />
  if (m.status === "sent") return <Check className="size-3.5" />
  return <CheckCheck className={cn("size-3.5", m.status === "read" && "text-brand")} />
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === "out"
  const bot = m.by === "bot" || m.by === "broadcast" || m.by === "ai"
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className={cn("max-w-[min(560px,78%)] rounded-xl px-3 pt-2 pb-1.5 shadow-card", out ? "self-end rounded-br-sm" : "self-start rounded-bl-sm bg-background",
        out && (bot ? "bg-[#f3f0ff]" : "bg-brand-subtle"), m.status === "failed" && "ring-1 ring-[#f87168]")}>
      {bot && <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold tracking-wide text-[#5e4db2] uppercase">{m.by === "bot" ? <Bot className="size-3" /> : m.by === "ai" ? <Sparkles className="size-3" /> : <Zap className="size-3" />}{m.by === "ai" ? "AI · Claude" : m.by}</div>}
      {m.media && ["image", "sticker"].includes(m.type) && <img src={`/api/media/${m.media.id}`} loading="lazy" className="mb-1 max-h-64 max-w-64 rounded-md" />}
      {m.media && !["image", "sticker"].includes(m.type) && (
        <a href={`/api/media/${m.media.id}`} target="_blank" className="mb-1 flex items-center gap-1.5 text-brand hover:underline"><ExternalLink className="size-3.5" />Open {m.type}</a>
      )}
      <div className="break-words whitespace-pre-wrap">{m.text}</div>
      {m.options && m.options.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{m.options.map((o) => <span key={o} className="rounded-full border border-[#027eb5]/30 bg-white/70 px-2 py-0.5 text-[11px] text-[#027eb5]">{o}</span>)}</div>}
      <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">{fmtTime(m.timestamp)}<Tick m={m} /></div>
      {m.error && <div className="mt-1 max-w-sm text-xs text-destructive">{m.error}</div>}
    </motion.div>
  )
}

function Thread({ c }: { c: ContactDetail }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }) }, [c.messages?.length, c.id])
  let lastDay = ""
  return (
    <div ref={ref} className="scrollbar-thin flex flex-1 flex-col gap-1.5 overflow-y-auto px-6 py-5">
      {!c.messages?.length && <EmptyState icon={MessageSquareText} title="No messages yet">Messages appear here as soon as this customer writes to you on WhatsApp.</EmptyState>}
      <AnimatePresence initial={false}>
        {(c.messages || []).map((m) => {
          const day = fmtDate(m.timestamp)
          const sep = day !== lastDay
          lastDay = day
          return (
            <div key={m.id} className="contents">
              {sep && <div className="my-2 self-center rounded-full border bg-background px-3 py-0.5 text-[11px] font-bold text-muted-foreground uppercase">{day}</div>}
              <Bubble m={m} />
            </div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function Composer({ c }: { c: ContactDetail }) {
  const qc = useQueryClient()
  const ui = useUI()
  const send = useSendMessage(c.id)
  const { data: settings } = useSettings()
  const [text, setText] = useState("")
  const ta = useRef<HTMLTextAreaElement>(null)
  const left = windowLeft(c.lastInboundAt)
  useEffect(() => { if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = Math.min(180, ta.current.scrollHeight) + "px" } }, [text])
  useEffect(() => { setText(""); ta.current?.focus() }, [c.id])

  const submit = () => {
    const body = text.trim()
    if (!body) return
    const temp: Message = { id: "tmp-" + Date.now(), contactId: c.id, direction: "out", type: "text", text: body, status: "pending", timestamp: new Date().toISOString(), by: "agent" }
    qc.setQueryData<ContactDetail>(["contact", c.id], (d) => (d ? { ...d, messages: [...d.messages, temp] } : d))
    setText("")
    send.mutate({ text: body })
  }
  const quick = settings?.quickReplies || []

  if (!left)
    return (
      <div className="border-t bg-background px-5 py-4">
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-[#fff7d6] px-3 py-2.5 text-[13px] text-[#533f04]">
          <Clock className="size-4 shrink-0" />
          <span className="flex-1">It's been more than 24 hours since this customer's last message, so WhatsApp doesn't allow a new reply yet. As soon as they message again, you (and GreenBuddy) can reply here.</span>
        </div>
      </div>
    )

  return (
    <div className="border-t bg-background px-5 pt-3 pb-3.5">
      <div className="rounded-lg border border-input transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={`Reply to ${displayName(c)}…  (Enter to send, Shift+Enter for new line)`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() } }}
          className="block max-h-44 min-h-11 w-full resize-none bg-transparent px-3 py-2.5 outline-none placeholder:text-muted-foreground" />
        <div className="flex items-center gap-1 border-t px-2 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><Zap />Quick replies</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-80 overflow-y-auto">
              <DropdownMenuLabel>Insert a saved reply</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {quick.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">Add quick replies in GreenBuddy → Settings</div>}
              {quick.map((q, i) => <DropdownMenuItem key={i} onClick={() => { setText(q); ta.current?.focus() }}><span className="truncate">{q}</span></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" />{left}</span>
          <motion.div whileTap={{ scale: 0.92 }}>
            <Button size="sm" onClick={submit} disabled={!text.trim()}><Send />Send</Button>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default function Inbox() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ui = useUI()
  const { data: contacts, isLoading } = useContacts()
  const { data: c } = useContact(id)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all")
  const [q, setQ] = useState("")
  const [showDetails, setShowDetails] = useState(true)

  const list = useMemo(() => {
    let l = contacts || []
    if (filter === "unread") l = l.filter((x) => x.unread > 0)
    if (filter === "open") l = l.filter((x) => x.windowOpen)
    if (filter === "mine") l = l.filter((x) => x.assignee === "Me")
    if (q) { const s = q.toLowerCase(); l = l.filter((x) => [x.name, x.phone, x.profileName, x.lastMessage].some((v) => (v || "").toLowerCase().includes(s))) }
    return l
  }, [contacts, filter, q])

  useEffect(() => {
    if (c && c.unread > 0) api(`/contacts/${c.id}/read`, { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["contacts"] }))
  }, [c?.id, c?.unread]) // eslint-disable-line

  return (
    <div className={cn("grid h-full", showDetails && c ? "grid-cols-[320px_1fr] xl:grid-cols-[340px_1fr_320px]" : "grid-cols-[320px_1fr] xl:grid-cols-[340px_1fr]")}>
      {/* list */}
      <div className="flex min-h-0 flex-col border-r">
        <div className="px-4 pt-4 pb-2">
          <h1 className="mb-3 text-xl font-semibold tracking-tight">Inbox</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="h-8 w-full rounded-md border border-input pr-2 pl-8 outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" />
          </div>
        </div>
        <div className="mx-4 flex gap-0.5 border-b-2">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={cn("relative rounded-t px-2 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted", filter === f.id ? "text-brand" : "text-subtle")}>
              {f.label}
              {filter === f.id && <motion.span layoutId="inbox-tab" className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-brand" />}
            </button>
          ))}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mb-2 h-14" />)}
          {!isLoading && list.length === 0 && <EmptyState icon={MessageCircle} title="No conversations">When someone messages your WhatsApp number, it shows up here instantly.</EmptyState>}
          <AnimatePresence initial={false}>
            {list.map((x) => (
              <motion.button layout key={x.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 40 }}
                onClick={() => navigate(`/inbox/${x.id}`)}
                className={cn("flex w-full gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors", x.id === id ? "bg-brand-subtle" : "hover:bg-muted")}>
                <div className="relative">
                  <UserAvatar name={displayName(x)} size={36} tooltip={false} />
                  {x.windowOpen && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background bg-[#22a06b]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("flex-1 truncate", x.unread ? "font-bold" : "font-semibold")}>{displayName(x)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(x.lastMessageAt || x.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={cn("flex-1 truncate text-[13px]", x.unread ? "font-medium text-foreground" : "text-muted-foreground")}>{x.lastMessage || "No messages yet"}</span>
                    {x.unread > 0 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="rounded-full bg-brand px-1.5 text-[11px] leading-4 font-bold text-white">{x.unread}</motion.span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5"><StageLozenge stage={x.stage} />{x.lead?.service && <ServiceLozenge service={x.lead.service} />}<TempChip temp={x.lead?.temperature} size="xs" /><span className="text-[11px] font-semibold text-muted-foreground">{x.key}</span></div>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* chat */}
      <div className="flex min-h-0 min-w-0 flex-col bg-sunken">
        {!id ? (
          <div className="grid flex-1 place-items-center"><EmptyState icon={MessageCircle} title="Select a conversation">Pick a chat on the left to reply, send templates and update the lead.</EmptyState></div>
        ) : !c ? (
          <div className="space-y-3 p-6"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-16 w-1/2" /><Skeleton className="ml-auto h-16 w-1/2" /></div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b bg-background px-5 py-3">
              <UserAvatar name={displayName(c)} size={40} tooltip={false} />
              <div className="min-w-0 flex-1">
                <button onClick={() => ui.openContact(c.id)} className="block truncate text-base font-semibold hover:text-brand hover:underline">{displayName(c)}</button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="size-3" />{c.phone}<span>·</span>{c.key}</div>
              </div>
              {c.windowOpen ? <Lozenge tone="green">Window open · {windowLeft(c.lastInboundAt)}</Lozenge> : <Lozenge tone="yellow">Template only</Lozenge>}
              {c.botPaused && <Lozenge tone="purple">Bot paused</Lozenge>}
              <Button variant="ghost" size="icon" title={showDetails ? "Hide details" : "Show details"} onClick={() => setShowDetails(!showDetails)} className="hidden xl:inline-flex">
                {showDetails ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </div>
            <Thread c={c} />
            <Composer c={c} />
          </>
        )}
      </div>

      {/* details */}
      <AnimatePresence>
        {showDetails && c && (
          <motion.aside initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="scrollbar-thin hidden min-h-0 overflow-y-auto border-l bg-background p-4 xl:block">
            <div className="mb-4"><LeadPanel contactId={c.id} lead={c.lead} /></div>
            <ContactDetails contact={c} />
            <h3 className="mt-6 mb-2 font-semibold">Internal notes</h3>
            <NotesBox contact={c} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}
