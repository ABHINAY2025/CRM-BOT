import { useQuery } from "@tanstack/react-query"

export type Stage = { id: string; name: string }
export type Contact = {
  id: string; key: string; waId: string; phone: string; name: string; profileName?: string
  email: string; company: string; stage: string; priority: string; assignee: string; tags: string[]; value: number
  createdAt: string; updatedAt: string; lastMessageAt: string | null; lastMessage: string; lastInboundAt: string | null
  unread: number; botPaused: boolean; windowOpen: boolean; openTasks: number
  lead?: Lead
}
export type Lead = {
  service: string | null; journey: string; channel: string; fields: Record<string, string>; tags: string[]; status: string
  nextStep: string | null; nextStepId?: string; confirmed: { siteVisit?: boolean; expertCall?: boolean }; temperature: string | null; fit: string | null
  mapPin: { lat: number; lng: number; name?: string; address?: string } | null; firstMessageAt: string; lastReplyAt: string | null; handoverAt: string | null
}
export type Message = {
  id: string; wamid?: string; contactId: string; direction: "in" | "out"; type: string; text: string
  media?: { id: string; mime?: string; filename?: string }; status: string; error?: string; timestamp: string; by?: string; template?: string; options?: string[]
}
export type Task = {
  id: string; key: string; title: string; description: string; status: "todo" | "inprogress" | "done"; priority: string
  assignee: string; dueDate: string; contactId: string | null; createdAt: string; type?: string | null; contact?: { id: string; key: string; name: string; phone: string } | null
}
export type Note = { id: string; text: string; at: string; by: string }
export type Activity = { id: string; type: string; text: string; contactId: string | null; at: string }
export type ContactDetail = Contact & { messages: Message[]; tasks: Task[]; notes: Note[]; activity: Activity[] }
export type Rule = { id: string; name: string; match: "contains" | "exact" | "starts"; keywords: string[]; reply: string; buttons?: string[]; setStage: string; addTag: string; enabled: boolean; hits: number }
export type Settings = {
  botEnabled: boolean; welcomeEnabled: boolean; welcomeMessage: string; awayEnabled: boolean; awayMessage: string
  businessHours: { start: string; end: string; days: number[] }; autoMarkRead: boolean; agents: string[]; quickReplies?: string[]
  aiEnabled: boolean; aiPersona: string; aiHandoffMessage: string
}
export type AiInfo = { configured: boolean; model: string; effort: string }
export type FieldDef = { label: string; ask?: string; options?: string[]; note?: string; derived?: boolean }
export type BotSpec = {
  services: { id: string; label: string; short: string; tone: string }[]; statuses: { id: string; name: string; tone: string }[]
  fields: Record<string, FieldDef>; journeys: Record<string, { label: string; service?: string; required: string[] }>
  nextSteps: Record<string, string>; tags: { shared: string[]; hydroponics: string[]; ras: string[] }; taskTypes: string[]; defaults: BotSettings
}
export type Faq = { service: string; q: string; a: string }
export type BotSettings = { botName: string; company: string; replyLanguage: string; siteVisitCity: string; siteVisitFee: number; workStart: string; workEnd: string; workDays: number[]; faq: Faq[] }
export const useBotSpec = () => useQuery({ queryKey: ["botspec"], queryFn: () => api<BotSpec>("/bot/spec"), staleTime: Infinity })
export const useBotSettings = () => useQuery({ queryKey: ["botsettings"], queryFn: () => api<BotSettings>("/bot/settings") })
export const useAiInfo = () => useQuery({ queryKey: ["ai"], queryFn: () => api<AiInfo>("/ai"), staleTime: 60_000 })
export type Template = { id: string; name: string; status: string; category: string; language: string; components: any[] }
export type Broadcast = { id: string; name: string; template: string; language: string; total: number; sent: number; failed: number; status: string; createdAt: string; errors: string[] }
export type SystemInfo = {
  phoneId: string; wabaId: string; verifyToken: string; graphVersion: string; hasToken: boolean; hasSecret: boolean
  publicUrl: string | null; webhookUrl: string | null; ngrokStatus: string; ngrokError: string | null
  webhookRegistered: { url: string; at: string; appId: string; appName: string } | null; webhookError: string | null; localUrl: string
  phone?: { display_phone_number: string; verified_name: string; quality_rating: string; messaging_limit_tier?: string } | null; phoneError?: string | null
}
export type Stats = {
  contacts: number; newThisWeek: number; unread: number; openConversations: number; messagesToday: number; botReplies: number
  failed: number; openTasks: number; overdueTasks: number; won: number; pipelineValue: number; byStage: Record<string, number>
  days: { date: string; in: number; out: number }[]
  byService: Record<string, number>; byTemperature: Record<string, number>; aiReplies: number
  hotLeads: { id: string; key: string; name: string; service: string; location: string; nextStep: string; status: string }[]
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && path !== "/login") window.dispatchEvent(new Event("crm-auth-required"))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data as T
}

export const useBootstrap = () => useQuery({ queryKey: ["bootstrap"], queryFn: () => api<{ stages: Stage[]; settings: Settings; config: SystemInfo }>("/bootstrap"), staleTime: 60_000 })
export const useContacts = () => useQuery({ queryKey: ["contacts"], queryFn: () => api<Contact[]>("/contacts") })
export const useContact = (id?: string | null) => useQuery({ queryKey: ["contact", id], queryFn: () => api<ContactDetail>(`/contacts/${id}`), enabled: !!id })
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") })
export const useActivity = () => useQuery({ queryKey: ["activity"], queryFn: () => api<Activity[]>("/activity") })
export const useTasks = () => useQuery({ queryKey: ["tasks"], queryFn: () => api<Task[]>("/tasks") })
export const useRules = () => useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/rules") })
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") })
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: () => api<Template[]>("/templates"), staleTime: 5 * 60_000, retry: false })
export const useBroadcasts = () => useQuery({ queryKey: ["broadcasts"], queryFn: () => api<Broadcast[]>("/broadcasts") })
export const useSystem = () => useQuery({ queryKey: ["system"], queryFn: () => api<SystemInfo>("/system"), refetchInterval: 30_000 })

/** Body placeholders of a template, e.g. ["1","2"] or ["first_name"] */
export function templateParams(t?: Template): string[] {
  const body = t?.components?.find((c) => c.type === "BODY")?.text || ""
  return [...new Set([...body.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]))]
}
export const templateBody = (t?: Template) => t?.components?.find((c) => c.type === "BODY")?.text || ""
