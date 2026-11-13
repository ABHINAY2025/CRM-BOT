import { useEffect } from "react"
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { api, type Contact, type ContactDetail, type Task } from "./api"

const err = (e: Error) => toast.error(e.message)

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Contact> }) => api<Contact>(`/contacts/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["contacts"] })
      const prev = qc.getQueryData<Contact[]>(["contacts"])
      qc.setQueryData<Contact[]>(["contacts"], (l) => l?.map((c) => (c.id === id ? { ...c, ...patch } : c)))
      qc.setQueryData<ContactDetail>(["contact", id], (c) => (c ? { ...c, ...patch } : c))
      return { prev }
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["contacts"], ctx.prev); err(e) },
    onSettled: (_d, _e, { id }) => { qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["contact", id] }); qc.invalidateQueries({ queryKey: ["stats"] }) },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api<Task>(`/tasks/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] })
      const prev = qc.getQueryData<Task[]>(["tasks"])
      qc.setQueryData<Task[]>(["tasks"], (l) => l?.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      return { prev }
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev); err(e) },
    onSettled: () => invalidateTasks(qc),
  })
}

export function invalidateTasks(qc: QueryClient) {
  for (const k of ["tasks", "contact", "contacts", "stats", "activity"]) qc.invalidateQueries({ queryKey: [k] })
}

export function useSendMessage(contactId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { text?: string; template?: string; language?: string; components?: any[] }) => api(`/contacts/${contactId}/messages`, { method: "POST", body }),
    onError: (e: Error) => toast.error("Message not delivered", { description: e.message }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["contact", contactId] }); qc.invalidateQueries({ queryKey: ["contacts"] }) },
  })
}

/** Server-sent events → refresh caches + toast on new inbound messages */
export function useLiveEvents() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    let es: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    // Serverless hosting (Vercel) can't keep a live connection open → poll every 5 s instead
    api<{ config: { realtime?: string } }>("/bootstrap").then((b) => {
      if (cancelled) return
      if (b.config.realtime === "poll") {
        let lastSeen = new Date().toISOString()
        poll = setInterval(async () => {
          if (document.hidden) return
          for (const k of ["contacts", "contact", "stats", "tasks", "broadcasts"]) qc.invalidateQueries({ queryKey: [k] })
          try {
            const acts = await api<{ type: string; text: string; contactId: string | null; at: string }[]>("/activity")
            for (const a of acts.filter((x) => x.at > lastSeen && ["hot", "handover"].includes(x.type)).reverse()) {
              toast(a.text, { duration: 10000, action: a.contactId ? { label: "Open", onClick: () => navigate(`/inbox/${a.contactId}`) } : undefined })
            }
            if (acts[0]) lastSeen = acts[0].at > lastSeen ? acts[0].at : lastSeen
          } catch { /* ignore */ }
        }, 5000)
        return
      }
      es = new EventSource("/api/events")
      es.onmessage = (e) => handle(JSON.parse(e.data))
    }).catch(() => {})
    const handle = (ev: any) => {
      if (ev.type === "message" || ev.type === "status" || ev.type === "contact") {
        qc.invalidateQueries({ queryKey: ["contacts"] })
        if (ev.contactId) qc.invalidateQueries({ queryKey: ["contact", ev.contactId] })
        qc.invalidateQueries({ queryKey: ["stats"] })
        qc.invalidateQueries({ queryKey: ["activity"] })
      }
      if (ev.type === "message" && ev.message?.direction === "in") {
        const onThisChat = location.pathname === `/inbox/${ev.contactId}`
        if (!onThisChat) {
          toast(ev.contactName || "New message", {
            description: ev.message.text?.slice(0, 120),
            action: { label: "Reply", onClick: () => navigate(`/inbox/${ev.contactId}`) },
          })
        }
      }
      if (ev.type === "notify") {
        qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["stats"] })
        toast(ev.title, { description: ev.text, duration: 10000, action: ev.contactId ? { label: "Open", onClick: () => navigate(`/inbox/${ev.contactId}`) } : undefined })
      }
      if (ev.type === "task") invalidateTasks(qc)
      if (ev.type === "broadcast") qc.invalidateQueries({ queryKey: ["broadcasts"] })
      if (ev.type === "system") { qc.invalidateQueries({ queryKey: ["system"] }); qc.invalidateQueries({ queryKey: ["bootstrap"] }) }
    }
    return () => { cancelled = true; es?.close(); if (poll) clearInterval(poll) }
  }, [qc, navigate])
}
