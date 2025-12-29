import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LineItem, unitOptions } from '@/types/invoice';
import { formatCurrency } from '@/lib/formatting';
import { calculateLineItemTotal } from '@/lib/calculations';
import { Plus, Trash2 } from 'lucide-react';

interface LineItemEditorProps {
  lineItems: LineItem[];
  onChange: (lineItems: LineItem[]) => void;
}

export function LineItemEditor({ lineItems, onChange }: LineItemEditorProps) {
  const addLineItem = () => {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      description: '',
      subDescription: '',
      quantity: 1,
      unit: 'Stunden',
      unitPrice: 0,
      total: 0,
    };
    onChange([...lineItems, newItem]);
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: string | number) => {
    const updated = lineItems.map((item) => {
      if (item.id !== id) return item;
      
      const newItem = { ...item, [field]: value };
      
      // Recalculate total if quantity or unitPrice changed
      if (field === 'quantity' || field === 'unitPrice') {
        newItem.total = calculateLineItemTotal(
          field === 'quantity' ? Number(value) : newItem.quantity,
          field === 'unitPrice' ? Number(value) : newItem.unitPrice
        );
      }
      
      return newItem;
    });
    onChange(updated);
  };

  const removeLineItem = (id: string) => {
    onChange(lineItems.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-lg font-semibold">Line Items</Label>
        <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
      </div>

      {lineItems.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No items yet</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLineItem}
            className="mt-2"
          >
            <Plus className="h-4 w-4" />
            Add your first item
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="rounded-lg border bg-muted/30 p-4 space-y-4"
            >
              <div className="flex items-start justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Item {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLineItem(item.id)}
                  className="h-8 w-8 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor={`desc-${item.id}`}>Description</Label>
                  <Input
                    id={`desc-${item.id}`}
                    value={item.description}
                    onChange={(e) =>
                      updateLineItem(item.id, 'description', e.target.value)
                    }
                    placeholder="e.g., Software Development"
                  />
                </div>

                <div>
                  <Label htmlFor={`subdesc-${item.id}`}>
                    Sub-description (optional)
                  </Label>
                  <Textarea
                    id={`subdesc-${item.id}`}
                    value={item.subDescription || ''}
                    onChange={(e) =>
                      updateLineItem(item.id, 'subDescription', e.target.value)
                    }
                    placeholder="Additional details..."
                    rows={2}
                    className="mt-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <Label htmlFor={`qty-${item.id}`}>Quantity</Label>
                    <Input
                      id={`qty-${item.id}`}
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.quantity || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateLineItem(item.id, 'quantity', val === '' ? 0 : parseFloat(val));
                      }}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`unit-${item.id}`}>Unit</Label>
                    <Select
                      value={item.unit}
                      onValueChange={(value) =>
                        updateLineItem(item.id, 'unit', value)
                      }
                    >
                      <SelectTrigger id={`unit-${item.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor={`price-${item.id}`}>Unit Price (€)</Label>
                    <Input
                      id={`price-${item.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateLineItem(item.id, 'unitPrice', val === '' ? 0 : parseFloat(val));
                      }}
                    />
                  </div>

                  <div>
                    <Label>Total</Label>
                    <div className="flex h-10 items-center rounded-lg border bg-muted px-3 text-sm font-medium">
                      {formatCurrency(item.total)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
