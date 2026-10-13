import { create } from "zustand";
export type Page =
  "Home" | "Workspaces" | "Connections" | "Tools" | "Activity" | "Settings";
export const useUI = create<{
  page: Page;
  search: string;
  toast: { message: string; error: boolean } | null;
  navigate: (page: Page) => void;
  setSearch: (value: string) => void;
  notify: (message: string, error?: boolean) => void;
}>((set) => ({
  page: "Home",
  search: "",
  toast: null,
  navigate: (page) => set({ page, search: "" }),
  setSearch: (search) => set({ search }),
  notify: (message, error = false) => {
    set({ toast: { message, error } });
    setTimeout(() => set({ toast: null }), 6000);
  },
}));
