import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import "./index.css"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UIProvider } from "@/components/crm/dialogs"
import { AppShell } from "@/components/layout/app-shell"
import Dashboard from "@/pages/dashboard"
import Inbox from "@/pages/inbox"
import Board from "@/pages/board"
import Contacts from "@/pages/contacts"
import Tasks from "@/pages/tasks"
import BotPage from "@/pages/bot"
import { AuthGate } from "@/components/layout/auth-gate"

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000 } } })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthGate>
      <BrowserRouter>
        <TooltipProvider delayDuration={300}>
          <UIProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="inbox/:id?" element={<Inbox />} />
                <Route path="board" element={<Board />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="bot" element={<BotPage />} />
                <Route path="*" element={<Dashboard />} />
              </Route>
            </Routes>
          </UIProvider>
        </TooltipProvider>
        <Toaster position="bottom-left" richColors closeButton />
      </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
)
