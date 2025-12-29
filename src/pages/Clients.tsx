import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useClients } from '@/hooks/useClients';
import { useInvoices } from '@/hooks/useInvoices';
import { Client } from '@/types/invoice';
import { formatCurrency } from '@/lib/formatting';
import { toast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react';

const emptyClient: Omit<Client, 'id' | 'totalInvoiced'> = {
  name: '',
  street: '',
  postalCode: '',
  city: '',
  email: '',
};

export function Clients() {
  const { clients, loadClients, addClient, updateClient, deleteClient } = useClients();
  const { invoices } = useInvoices();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [formData, setFormData] = useState(emptyClient);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // Calculate total invoiced for each client dynamically from invoices
  const clientsWithTotals = clients.map((client) => {
    const totalInvoiced = invoices
      .filter((inv) => inv.clientId === client.id && inv.status !== 'draft')
      .reduce((sum, inv) => sum + inv.total, 0);
    
    return {
      ...client,
      totalInvoiced,
    };
  });

  const filteredClients = clientsWithTotals.filter((client) =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenDialog = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({
        name: client.name,
        street: client.street,
        postalCode: client.postalCode,
        city: client.city,
        email: client.email || '',
      });
    } else {
      setEditingClient(null);
      setFormData(emptyClient);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingClient(null);
    setFormData(emptyClient);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({ title: 'Error', description: 'Client name is required', variant: 'destructive' });
      return;
    }

    if (editingClient) {
      updateClient({
        ...editingClient,
        ...formData,
      });
      toast({ title: 'Success', description: 'Client updated successfully' });
    } else {
      addClient({
        id: crypto.randomUUID(),
        ...formData,
        totalInvoiced: 0,
      });
      toast({ title: 'Success', description: 'Client added successfully' });
    }

    handleCloseDialog();
  };

  const handleDeleteClick = (client: Client) => {
    setClientToDelete(client);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (clientToDelete) {
      // Check if client has invoices
      const hasInvoices = invoices.some((inv) => inv.clientId === clientToDelete.id);
      if (hasInvoices) {
        toast({
          title: 'Cannot delete',
          description: 'This client has invoices associated with them. Delete the invoices first.',
          variant: 'destructive',
        });
      } else {
        deleteClient(clientToDelete.id);
        toast({ title: 'Success', description: 'Client deleted successfully' });
      }
    }
    setIsDeleteDialogOpen(false);
    setClientToDelete(null);
  };

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-lg"
          />
        </div>
        <Button onClick={() => handleOpenDialog()} className="rounded-lg">
          <Plus className="h-4 w-4" />
          Add Client
        </Button>
      </div>

      {/* Clients Table */}
      {filteredClients.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="mb-2">No clients yet</CardTitle>
            <CardDescription className="text-center mb-4">
              {searchQuery
                ? 'No clients match your search criteria.'
                : 'Add your first client to get started.'}
            </CardDescription>
            {!searchQuery && (
              <Button onClick={() => handleOpenDialog()} className="rounded-lg">
                <Plus className="h-4 w-4" />
                Add Client
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>All Clients</CardTitle>
            <CardDescription>
              {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Total Invoiced</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {client.street}, {client.postalCode} {client.city}
                      </span>
                    </TableCell>
                    <TableCell>
                      {client.email ? (
                        <a
                          href={`mailto:${client.email}`}
                          className="text-primary hover:underline"
                        >
                          {client.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(client.totalInvoiced)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(client)}
                          className="h-8 w-8"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(client)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-lg sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? 'Edit Client' : 'Add New Client'}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? 'Update the client details below.'
                : 'Enter the client details below.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Enter client name"
                className="rounded-lg"
              />
            </div>
            <div>
              <Label htmlFor="street">Street & House Number</Label>
              <Input
                id="street"
                value={formData.street}
                onChange={(e) => updateField('street', e.target.value)}
                placeholder="Enter street and house number"
                className="rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="postalCode">Postal Code</Label>
                <Input
                  id="postalCode"
                  value={formData.postalCode}
                  onChange={(e) => updateField('postalCode', e.target.value)}
                  placeholder="Enter postal code"
                  className="rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  placeholder="Enter city"
                  className="rounded-lg"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="Enter email address"
                className="rounded-lg"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} className="rounded-lg">
              Cancel
            </Button>
            <Button onClick={handleSave} className="rounded-lg">
              {editingClient ? 'Save Changes' : 'Add Client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{clientToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

