import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Client } from '@/types/invoice';
import { Plus, User } from 'lucide-react';

interface ClientSelectorProps {
  clients: Client[];
  selectedClient: Client | null;
  onSelectClient: (client: Client) => void;
  onCreateClient: (client: Client) => void;
}

export function ClientSelector({
  clients,
  selectedClient,
  onSelectClient,
  onCreateClient,
}: ClientSelectorProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newClient, setNewClient] = useState<Partial<Client>>({
    name: '',
    street: '',
    postalCode: '',
    city: '',
    email: '',
  });

  const handleSelectExisting = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      onSelectClient(client);
    }
  };

  const handleCreateClient = () => {
    if (!newClient.name || !newClient.street || !newClient.postalCode || !newClient.city) {
      return;
    }

    const client: Client = {
      id: crypto.randomUUID(),
      name: newClient.name,
      street: newClient.street,
      postalCode: newClient.postalCode,
      city: newClient.city,
      email: newClient.email,
      totalInvoiced: 0,
    };

    onCreateClient(client);
    onSelectClient(client);
    setIsDialogOpen(false);
    setNewClient({
      name: '',
      street: '',
      postalCode: '',
      city: '',
      email: '',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>Client</Label>
          <Select
            value={selectedClient?.id || ''}
            onValueChange={handleSelectExisting}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.length === 0 ? (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No clients yet
                </div>
              ) : (
                clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <Plus className="h-4 w-4" />
              New Client
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label htmlFor="client-name">Company/Client Name *</Label>
                <Input
                  id="client-name"
                  value={newClient.name}
                  onChange={(e) =>
                    setNewClient({ ...newClient, name: e.target.value })
                  }
                  placeholder="Acme Corp GmbH"
                />
              </div>
              <div>
                <Label htmlFor="client-street">Street & Number *</Label>
                <Input
                  id="client-street"
                  value={newClient.street}
                  onChange={(e) =>
                    setNewClient({ ...newClient, street: e.target.value })
                  }
                  placeholder="Musterstraße 123"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="client-postal">Postal Code *</Label>
                  <Input
                    id="client-postal"
                    value={newClient.postalCode}
                    onChange={(e) =>
                      setNewClient({ ...newClient, postalCode: e.target.value })
                    }
                    placeholder="12345"
                  />
                </div>
                <div>
                  <Label htmlFor="client-city">City *</Label>
                  <Input
                    id="client-city"
                    value={newClient.city}
                    onChange={(e) =>
                      setNewClient({ ...newClient, city: e.target.value })
                    }
                    placeholder="Berlin"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="client-email">Email (optional)</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={newClient.email}
                  onChange={(e) =>
                    setNewClient({ ...newClient, email: e.target.value })
                  }
                  placeholder="contact@acme.com"
                />
              </div>
              <Button
                type="button"
                onClick={handleCreateClient}
                className="w-full"
                disabled={
                  !newClient.name ||
                  !newClient.street ||
                  !newClient.postalCode ||
                  !newClient.city
                }
              >
                Add Client
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {selectedClient && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{selectedClient.name}</p>
              <p className="text-sm text-muted-foreground">
                {selectedClient.street}
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedClient.postalCode} {selectedClient.city}
              </p>
              {selectedClient.email && (
                <p className="text-sm text-muted-foreground">
                  {selectedClient.email}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
