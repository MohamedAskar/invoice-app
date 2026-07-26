import { create } from 'zustand';
import { Client } from '@/types/invoice';
import {
  getClients,
  saveClient,
  deleteClient as deleteClientFromStorage,
} from '@/lib/storage';

interface ClientsStore {
  clients: Client[];
  loading: boolean;
  loadClients: () => Promise<void>;
  addClient: (client: Client) => Promise<void>;
  updateClient: (client: Client) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  getClient: (id: string) => Client | undefined;
}

export const useClients = create<ClientsStore>((set, get) => ({
  clients: [],
  loading: false,
  loadClients: async () => {
    set({ loading: true });
    const clients = await getClients();
    set({ clients, loading: false });
  },
  addClient: async (client: Client) => {
    await saveClient(client);
    set((state) => ({ clients: [...state.clients, client] }));
  },
  updateClient: async (client: Client) => {
    await saveClient(client);
    set((state) => ({
      clients: state.clients.map((c) => (c.id === client.id ? client : c)),
    }));
  },
  deleteClient: async (id: string) => {
    await deleteClientFromStorage(id);
    set((state) => ({ clients: state.clients.filter((c) => c.id !== id) }));
  },
  getClient: (id: string) => get().clients.find((c) => c.id === id),
}));
