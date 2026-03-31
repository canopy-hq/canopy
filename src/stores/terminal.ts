import { create } from 'zustand';

interface TerminalState {
  ptyId: number | null;
  setPtyId: (id: number | null) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  ptyId: null,
  setPtyId: (id) => set({ ptyId: id }),
}));
