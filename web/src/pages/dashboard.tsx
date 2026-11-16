import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Activity as ActivityIcon, AlertTriangle, ArrowRight, Bot, CircleDollarSign, Inbox, ListChecks, MessageCircle, Plus, Trophy, Users, Zap } from "lucide-react"
import { useActivity, useContacts, useStats, useTasks } from "@/lib/api"
import { STAGES, compact, displayName, money, timeAgo } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CountUp, LiveDot, PageHeader, PriorityIcon, StageLozenge, UserAvatar } from "@/components/crm/bits"
import { ServiceLozenge, TempChip } from "@/components/crm/lead-panel"
import { SERVICE_SHORT } from "@/lib/format"
import { useUI } from "@/components/crm/dialogs"
import { cn } from "@/lib/utils"

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } }

function Card({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <motion.section variants={item} className={cn("min-w-0 rounded-lg border bg-card", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3"><h2 className="font-semibold">{title}</h2><div className="ml-auto flex gap-1">{actions}</div></div>
      <div className="p-4">{children}</div>
    </motion.section>
  )
}

function Stat({ icon: Icon, label, value, sub, bad, format, onClick }: { icon: any; label: string; value: number; sub?: string; bad?: boolean; format?: (n: number) => string; onClick?: () => void }) {
  return (
    <motion.button variants={item} onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }}
      className="group rounded-lg border bg-card p-4 text-left transition-shadow hover:shadow-raised">
      <div className="flex items-center gap-2 text-xs font-semibold text-subtle">
        <span className="grid size-6 place-items-center rounded-md bg-brand-subtle text-brand transition-transform group-hover:scale-110"><Icon className="size-3.5" /></span>{label}
      </div>
      <div className="mt-2 text-[28px] leading-9 font-semibold tracking-tight tabular-nums"><CountUp value={value} format={format} /></div>
      {sub && <div className={cn("text-xs", bad ? "font-medium text-destructive" : "text-muted-foreground")}>{sub}</div>}
    </motion.button>
  )
}

/* Grouped bar chart: inbound vs outbound per day (validated palette: chart-1 / chart-2) */
function MessagesChart({ days }: { days: { date: string; in: number; out: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 220, L = 32, B = 26, T = 10
  const max = Math.max(4, ...days.flatMap((d) => [d.in, d.out]))
  const step = Math.ceil(max / 4)
  const top = step * 4
  const gw = (W - L) / days.length
  const bw = Math.min(22, (gw - 18) / 2)
  const y = (v: number) => T + (H - T - B) * (1 - v / top)
  const bar = (x: number, v: number) => {
    const h = (H - T - B) * (v / top); if (h <= 0) return ""
    const r = Math.min(4, h, bw / 2), yy = H - B - h
    return `M${x},${H - B}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${H - B}Z`
  }
  const total = days.reduce((a, d) => a + d.in + d.out, 0)
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-subtle">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[2px] bg-chart-1" />Inbound</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[2px] bg-chart-2" />Outbound</span>
        <span className="ml-auto text-muted-foreground">{total} messages in 7 days</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Messages per day, last 7 days">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1={L} x2={W} y1={y(step * i)} y2={y(step * i)} stroke={i === 0 ? "#c1c7d0" : "#ebecf0"} />
              <text x={L - 8} y={y(step * i) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{step * i}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const gx = L + i * gw, x1 = gx + gw / 2 - bw - 1, x2 = gx + gw / 2 + 1
            return (
              <g key={d.date}>
                <rect x={gx} y={T} width={gw} height={H - T - B} fill={hover === i ? "#091e420a" : "transparent"} />
                <motion.path d={bar(x1, d.in)} fill="var(--chart-1)" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.1 + i * 0.04, type: "spring", stiffness: 200, damping: 22 }} style={{ transformOrigin: `0px ${H - B}px` }} />
                <motion.path d={bar(x2, d.out)} fill="var(--chart-2)" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.14 + i * 0.04, type: "spring", stiffness: 200, damping: 22 }} style={{ transformOrigin: `0px ${H - B}px` }} />
                <text x={gx + gw / 2} y={H - 8} textAnchor="middle" className={cn("text-[11px]", hover === i ? "fill-foreground font-semibold" : "fill-muted-foreground")}>
                  {new Date(d.date + "T00:00").toLocaleDateString(undefined, { weekday: "short" })}
                </text>
                <rect x={gx} y={0} width={gw} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute z-10 rounded-md bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-raised"
            style={{ left: `${((L + hover * gw + gw / 2) / W) * 100}%`, top: 0, transform: "translate(-50%, -30%)" }}>
            <div className="mb-0.5 font-semibold">{new Date(days[hover].date + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
            <div className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-chart-1" />Inbound <b className="ml-auto pl-3">{days[hover].in}</b></div>
            <div className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-chart-2" />Outbound <b className="ml-auto pl-3">{days[hover].out}</b></div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data: s } = useStats()
  const { data: activity = [] } = useActivity()
  const { data: contacts = [] } = useContacts()
  const { data: tasks = [] } = useTasks()
  const navigate = useNavigate()
  const ui = useUI()
  const myTasks = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9")).slice(0, 6)
  const recent = contacts.slice(0, 6)
  const maxStage = Math.max(1, ...Object.values(s?.byStage || {}))

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Dashboards"]} title="Overview" actions={<>
        <Button variant="secondary" onClick={() => navigate("/inbox")}><Inbox />Open inbox</Button>
        <Button onClick={() => ui.openCreate("contact")}><Plus />New lead</Button>
      </>} />

      {!s ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat icon={Users} label="Contacts" value={s.contacts} sub={`+${s.newThisWeek} this week`} onClick={() => navigate("/contacts")} />
            <Stat icon={MessageCircle} label="Unread" value={s.unread} sub={`${s.openConversations} open 24h windows`} onClick={() => navigate("/inbox")} />
            <Stat icon={ActivityIcon} label="Messages · 24h" value={s.messagesToday} sub={`${s.aiReplies ?? 0} GreenBuddy replies total`} />
            <Stat icon={ListChecks} label="Open tasks" value={s.openTasks} sub={s.overdueTasks ? `${s.overdueTasks} overdue` : "Nothing overdue"} bad={!!s.overdueTasks} onClick={() => navigate("/tasks")} />
            <Stat icon={CircleDollarSign} label="Open pipeline" value={s.pipelineValue} format={(n) => money(n)} sub={`${compact(s.contacts - s.won - (s.byStage.lost || 0))} active deals`} onClick={() => navigate("/board")} />
            <Stat icon={Trophy} label="Won" value={s.won} sub={s.failed ? `${s.failed} failed sends` : "All sends healthy"} bad={!!s.failed} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <Card title="Messages, last 7 days" className="col-span-12 xl:col-span-8"><MessagesChart days={s.days} /></Card>
            <Card title="Pipeline overview" className="col-span-12 xl:col-span-4" actions={<Button variant="ghost" size="sm" onClick={() => navigate("/board")}>Board<ArrowRight /></Button>}>
              <div className="space-y-1">
                {STAGES.map((st, i) => (
                  <button key={st.id} onClick={() => navigate("/board")} className="grid w-full grid-cols-[104px_1fr_32px] items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-sunken">
                    <span><StageLozenge stage={st.id} /></span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <motion.span className="block h-full rounded-full bg-chart-1" initial={{ width: 0 }} animate={{ width: `${((s.byStage[st.id] || 0) / maxStage) * 100}%` }} transition={{ delay: 0.15 + i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
                    </span>
                    <span className="text-right font-semibold text-subtle tabular-nums">{s.byStage[st.id] || 0}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card title="Leads by service" className="col-span-12 lg:col-span-6">
              <div className="space-y-1">
                {Object.entries(s.byService || {}).map(([id, n], i) => {
                  const max = Math.max(1, ...Object.values(s.byService || {}))
                  return (
                    <div key={id} className="grid grid-cols-[110px_1fr_32px] items-center gap-3 py-1.5">
                      <span><ServiceLozenge service={id} /></span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted"><motion.span className="block h-full rounded-full bg-chart-1" initial={{ width: 0 }} animate={{ width: `${(n / max) * 100}%` }} transition={{ delay: 0.1 + i * 0.05, duration: 0.6 }} /></span>
                      <span className="text-right font-semibold text-subtle tabular-nums">{n}</span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 border-t pt-3 text-xs text-subtle">
                {Object.entries(s.byTemperature || {}).map(([t, n]) => <span key={t} className="flex items-center gap-1.5"><TempChip temp={t} /><b className="tabular-nums">{n}</b></span>)}
              </div>
            </Card>

            <Card title="🔥 Hot leads — call first" className="col-span-12 lg:col-span-6">
              {(s.hotLeads || []).length === 0 ? <p className="py-6 text-center text-muted-foreground">No hot leads right now. GreenBuddy flags them as soon as they qualify.</p> : (
                <div className="-mx-2">
                  {s.hotLeads.map((h) => (
                    <button key={h.id} onClick={() => navigate(`/inbox/${h.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-sunken">
                      <UserAvatar name={h.name} size={30} tooltip={false} />
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate font-medium">{h.name}</span><ServiceLozenge service={h.service} /></div>
                        <div className="truncate text-xs text-muted-foreground">{h.location || SERVICE_SHORT[h.service]}{h.nextStep && ` · ${h.nextStep}`}</div></div>
                      <StageLozenge stage={h.status} />
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recent conversations" className="col-span-12 lg:col-span-6 xl:col-span-4" actions={<Button variant="ghost" size="sm" onClick={() => navigate("/inbox")}>All<ArrowRight /></Button>}>
              {recent.length === 0 ? <p className="py-6 text-center text-muted-foreground">No conversations yet. Message your WhatsApp number to start one.</p> : (
                <div className="-mx-2">
                  {recent.map((c) => (
                    <button key={c.id} onClick={() => navigate(`/inbox/${c.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-sunken">
                      <UserAvatar name={displayName(c)} size={32} tooltip={false} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate font-medium">{displayName(c)}</span>{c.unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.lastMessage || "No messages"}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(c.lastMessageAt || c.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Assigned to me · open tasks" className="col-span-12 lg:col-span-6 xl:col-span-4" actions={<Button variant="ghost" size="sm" onClick={() => ui.openCreate("task")}><Plus />Task</Button>}>
              {myTasks.length === 0 ? <p className="py-6 text-center text-muted-foreground">No open tasks 🎉</p> : (
                <div className="-mx-2">
                  {myTasks.map((t) => {
                    const overdue = t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString())
                    return (
                      <button key={t.id} onClick={() => ui.openTask(t)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-sunken">
                        <PriorityIcon priority={t.priority} />
                        <span className="text-xs font-semibold text-muted-foreground">{t.key}</span>
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueDate && <span className={cn("rounded px-1 text-xs", overdue ? "bg-[#ffeceb] font-semibold text-[#ae2e24]" : "text-muted-foreground")}>{new Date(t.dueDate + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card title="Activity stream" className="col-span-12 xl:col-span-4">
              <div className="scrollbar-thin -mx-1 max-h-80 space-y-0.5 overflow-y-auto px-1">
                {activity.length === 0 && <p className="py-6 text-center text-muted-foreground">No activity yet</p>}
                {activity.slice(0, 25).map((a) => (
                  <div key={a.id} className="flex gap-2.5 border-b border-muted py-2 last:border-0">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand">
                      {a.type === "bot" ? <Bot className="size-3.5" /> : a.type === "system" ? <Zap className="size-3.5" /> : a.type === "task" ? <ListChecks className="size-3.5" /> : <Users className="size-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] leading-5">{a.text}</div>
                      <div className="text-xs text-muted-foreground">{timeAgo(a.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </motion.div>
      )}
    </div>
  )
}
