import { create } from "zustand";

interface SessionStore {
  sessionId: string | null;
  state: "idle" | "running" | "awaitingApproval" | "awaitingPlanReview" | "stopped";
  events: unknown[];
  model: string;
  permissionMode: string;
  pendingApproval: unknown | null;
  pendingPlanReview: unknown | null;
  cwd: string;

  setSessionId: (id: string | null) => void;
  setState: (state: SessionStore["state"]) => void;
  addEvent: (event: unknown) => void;
  setModel: (model: string) => void;
  setPermissionMode: (mode: string) => void;
  setPendingApproval: (req: unknown | null) => void;
  setPendingPlanReview: (review: unknown | null) => void;
  setCwd: (cwd: string) => void;
  clearEvents: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: null,
  state: "idle",
  events: [],
  model: "claude-sonnet-4-6",
  permissionMode: "default",
  pendingApproval: null,
  pendingPlanReview: null,
  cwd: "/",

  setSessionId: (id) => set({ sessionId: id }),
  setState: (state) => set({ state }),
  addEvent: (event) => set((s) => ({ events: [...s.events, event] })),
  setModel: (model) => set({ model }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setPendingPlanReview: (review) => set({ pendingPlanReview: review }),
  setCwd: (cwd) => set({ cwd }),
  clearEvents: () => set({ events: [] }),
}));
