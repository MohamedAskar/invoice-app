import { create } from 'zustand';
import { Client } from '@/types/invoice';
import { getClients, saveClient, saveClients } from '@/lib/storage';

interface ClientsStore {
  clients: Client[];
  loadClients: () => void;
  addClient: (client: Client) => void;
  updateClient: (client: Client) => void;
  deleteClient: (id: string) => void;
  getClient: (id: string) => Client | undefined;
  updateClientTotals: (clientId: string, amount: number) => void;
}

export const useClients = create<ClientsStore>((set, get) => ({
  clients: [],
  loadClients: () => {
    const clients = getClients();
    set({ clients });
  },
  addClient: (client: Client) => {
    saveClient(client);
    set((state) => ({ clients: [...state.clients, client] }));
  },
  updateClient: (client: Client) => {
    saveClient(client);
    set((state) => ({
      clients: state.clients.map((c) => (c.id === client.id ? client : c)),
    }));
  },
  deleteClient: (id: string) => {
    set((state) => {
      const updated = state.clients.filter((c) => c.id !== id);
      saveClients(updated);
      return { clients: updated };
    });
  },
  getClient: (id: string) => {
    return get().clients.find((c) => c.id === id);
  },
  updateClientTotals: (clientId: string, amount: number) => {
    const client = get().getClient(clientId);
    if (client) {
      const updated = {
        ...client,
        totalInvoiced: client.totalInvoiced + amount,
      };
      saveClient(updated);
      set((state) => ({
        clients: state.clients.map((c) => (c.id === clientId ? updated : c)),
      }));
    }
  },
}));

export function recalculateClientTotals(
  clients: Client[],
  invoices: { clientId: string; total: number; status: string }[]
): Client[] {
  const totals = new Map<string, number>();
  
  invoices.forEach((inv) => {
    if (inv.status !== 'draft') {
      const current = totals.get(inv.clientId) || 0;
      totals.set(inv.clientId, current + inv.total);
    }
  });
  
  const updated = clients.map((client) => ({
    ...client,
    totalInvoiced: totals.get(client.id) || 0,
  }));
  
  saveClients(updated);
  return updated;
}

