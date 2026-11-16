import { useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { Bell, Columns3, LayoutDashboard, ListChecks, LogOut, MessageCircle, Plus, Search, Sprout, Users } from "lucide-react"
import { useContacts, useSettings } from "@/lib/api"
import { displayName, timeAgo } from "@/lib/format"
import { useLiveEvents } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LiveDot, UserAvatar } from "@/components/crm/bits"
import { useUI } from "@/components/crm/dialogs"
import { ErrorBoundary } from "./error-boundary"
import { logout } from "./auth-gate"

const NAV = [
  { section: "Sales", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/inbox", label: "Inbox", icon: MessageCircle, badge: true },
    { to: "/board", label: "Pipeline board", icon: Columns3 },
    { to: "/contacts", label: "Contacts", icon: Users },
    { to: "/tasks", label: "Tasks", icon: ListChecks },
  ] },
  { section: "Assistant", items: [
    { to: "/bot", label: "GreenBuddy", icon: Sprout },
  ] },
]

function IconBtn({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} className="relative grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-muted hover:text-foreground active:scale-95">{children}</button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppShell() {
  useLiveEvents()
  const ui = useUI()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: contacts = [] } = useContacts()
  const { data: settings } = useSettings()
  const [q, setQ] = useState("")
  const unread = contacts.reduce((a, c) => a + (c.unread || 0), 0)
  const unreadList = contacts.filter((c) => c.unread > 0).slice(0, 8)
  const botOn = !!settings?.aiEnabled && !!settings?.botEnabled

  return (
    <div className="h-screen overflow-hidden">
      {/* ---------- top bar ---------- */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-1 border-b bg-background px-3">
        <NavLink to="/" className="mr-2 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
          <motion.span whileHover={{ rotate: -8, scale: 1.06 }} className="grid size-7 place-items-center rounded-md bg-gradient-to-br from-[#1d7afc] to-[#0055cc] text-white shadow-sm">
            <MessageCircle className="size-4" strokeWidth={2.4} />
          </motion.span>
          <span className="text-[15px] font-bold tracking-tight">WaCRM</span>
        </NavLink>
        <Button className="ml-2" onClick={() => ui.openCreate("contact")}><Plus />Create</Button>

        <div className="ml-auto flex items-center gap-1">
          <form onSubmit={(e) => { e.preventDefault(); navigate(`/contacts?q=${encodeURIComponent(q)}`) }} className="relative mr-1 hidden sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts"
              className="h-8 w-52 rounded-md border border-input bg-background pr-2 pl-8 transition-all duration-200 outline-none placeholder:text-muted-foreground focus:w-72 focus:border-ring focus:ring-2 focus:ring-ring/30" />
          </form>
          <Popover>
            <PopoverTrigger asChild>
              <button className="relative grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-muted hover:text-foreground">
                <Bell className="size-5" />
                <AnimatePresence>
                  {unread > 0 && (
                    <motion.span key={unread} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}
                      className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full border-2 border-background bg-destructive px-1 text-[10px] leading-3 font-bold text-white">
                      {unread > 99 ? "99+" : unread}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b px-4 py-3 font-semibold">Notifications</div>
              <div className="max-h-80 overflow-y-auto py-1">
                {unreadList.length === 0 && <div className="px-4 py-6 text-center text-muted-foreground">You're all caught up 🎉</div>}
                {unreadList.map((c) => (
                  <button key={c.id} onClick={() => navigate(`/inbox/${c.id}`)} className="flex w-full gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted">
                    <UserAvatar name={displayName(c)} size={32} tooltip={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-2"><b className="flex-1 truncate font-semibold">{displayName(c)}</b><span className="text-xs text-muted-foreground">{timeAgo(c.lastMessageAt)}</span></div>
                      <div className="truncate text-muted-foreground">{c.lastMessage}</div>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Tooltip><TooltipTrigger asChild><button onClick={logout} className="ml-1 rounded-full transition hover:ring-2 hover:ring-brand-subtler"><UserAvatar name="Me" size={28} tooltip={false} /></button></TooltipTrigger><TooltipContent>Sign out</TooltipContent></Tooltip>
        </div>
      </header>

      <div className="flex h-full pt-14">
        {/* ---------- sidebar ---------- */}
        <aside className="scrollbar-thin hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-background px-2 pt-4 pb-2 md:flex">
          <div className="flex items-center gap-2.5 px-2 pb-3">
            <div className="grid size-8 place-items-center rounded-md bg-[#1f845a] text-white"><MessageCircle className="size-4" strokeWidth={2.4} /></div>
            <div className="min-w-0">
              <div className="leading-tight font-semibold">Venonto CRM</div>
              <div className="truncate text-xs text-muted-foreground">GreenBuddy · WhatsApp leads</div>
            </div>
          </div>
          {NAV.map((sec) => (
            <div key={sec.section}>
              <div className="px-2 pt-4 pb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{sec.section}</div>
              {sec.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={(it as any).end}
                  className={({ isActive }) => cn("relative flex h-9 items-center gap-2.5 rounded-md px-2 font-medium transition-colors", isActive ? "text-brand" : "text-subtle hover:bg-muted hover:text-foreground")}>
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="side-active" className="absolute inset-0 rounded-md bg-brand-subtle" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                      {isActive && <motion.span layoutId="side-bar" className="absolute top-2 bottom-2 -left-2 w-1 rounded-r bg-brand" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                      <it.icon className="relative size-[18px]" />
                      <span className="relative">{it.label}</span>
                      {(it as any).badge && unread > 0 && (
                        <motion.span key={unread} initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="relative ml-auto rounded-full bg-brand px-1.5 text-[11px] leading-4 font-bold text-white">{unread}</motion.span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="mt-auto space-y-1">
            <button onClick={() => navigate("/bot")} className="lift flex w-full items-center gap-2 rounded-lg border bg-sunken p-3 text-left text-xs">
              <LiveDot status={botOn ? "ok" : "idle"} />
              <span className="font-semibold">GreenBuddy is {botOn ? "answering customers" : "paused"}</span>
            </button>
            <button onClick={logout} className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 font-medium text-subtle transition-colors hover:bg-muted hover:text-foreground"><LogOut className="size-[18px]" />Sign out</button>
          </div>
        </aside>

        {/* ---------- page ---------- */}
        <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={pathname.split("/")[1] || "home"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }} className="h-full">
              <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
