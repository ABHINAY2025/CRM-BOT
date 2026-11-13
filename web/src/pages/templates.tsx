import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ExternalLink, FileText, Megaphone, RefreshCw, Search } from "lucide-react"
import { useBootstrap, useTemplates } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, Lozenge, PageHeader } from "@/components/crm/bits"

const STATUS_TONE: Record<string, string> = { APPROVED: "green", PENDING: "yellow", REJECTED: "red", PAUSED: "gray", DISABLED: "gray" }

export default function Templates() {
  const { data, isLoading, error, refetch, isFetching } = useTemplates()
  const { data: boot } = useBootstrap()
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("ALL")
  const list = (data || []).filter((t) => (status === "ALL" || t.status === status) && (!q || t.name.includes(q.toLowerCase())))
  const metaUrl = `https://business.facebook.com/wa/manage/message-templates/?waba_id=${boot?.config.wabaId || ""}`

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Templates"]} title="Message templates" actions={<>
        <Button variant="secondary" onClick={() => refetch()}><RefreshCw className={cn(isFetching && "animate-spin")} />Sync from Meta</Button>
        <Button asChild><a href={metaUrl} target="_blank" rel="noreferrer"><ExternalLink />Create in Meta</a></Button>
      </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="h-8 w-52 rounded-md border border-input pr-2 pl-8 outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" />
        </div>
        {["ALL", "APPROVED", "PENDING", "REJECTED"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", status === s ? "bg-brand-subtle text-brand" : "text-subtle hover:bg-muted")}>
            {s[0] + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
        : error ? <div className="rounded-lg bg-[#ffeceb] p-4 text-[#5d1f1a]">Could not load templates from Meta: {(error as Error).message}</div>
        : list.length === 0 ? <EmptyState icon={FileText} title="No templates">Create templates in WhatsApp Manager — they appear here once Meta approves them.</EmptyState>
        : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((t, i) => {
              const header = t.components.find((c) => c.type === "HEADER")
              const body = t.components.find((c) => c.type === "BODY")
              const footer = t.components.find((c) => c.type === "FOOTER")
              const buttons = t.components.find((c) => c.type === "BUTTONS")?.buttons || []
              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
                  className="lift flex flex-col rounded-lg border bg-card">
                  <div className="flex items-start gap-2 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px] font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.category.toLowerCase()} · {t.language}</div>
                    </div>
                    <Lozenge tone={STATUS_TONE[t.status] || "gray"}>{t.status}</Lozenge>
                  </div>
                  <div className="flex-1 bg-[#efeae2]/60 p-4">
                    <div className="rounded-lg rounded-tl-sm bg-white p-3 text-[13px] shadow-card">
                      {header?.text && <div className="mb-1 font-semibold">{header.text}</div>}
                      {header && header.format !== "TEXT" && <div className="mb-2 rounded bg-muted py-6 text-center text-xs text-muted-foreground">{header.format} header</div>}
                      <div className="whitespace-pre-wrap">{body?.text}</div>
                      {footer?.text && <div className="mt-1 text-xs text-muted-foreground">{footer.text}</div>}
                    </div>
                    {buttons.map((b: any, bi: number) => <div key={bi} className="mt-1 rounded-lg bg-white py-1.5 text-center text-[13px] font-medium text-[#0c66e4] shadow-card">{b.text}</div>)}
                  </div>
                  <div className="flex items-center gap-2 border-t px-4 py-2.5">
                    <Button size="sm" variant="secondary" disabled={t.status !== "APPROVED"} onClick={() => navigate("/broadcasts", { state: { template: t.id } })}><Megaphone />Broadcast</Button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
    </div>
  )
}
