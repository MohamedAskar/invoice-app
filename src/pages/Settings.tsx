import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSettings } from '@/hooks/useSettings';
import { BusinessSettings, defaultBusinessSettings } from '@/types/invoice';
import { exportAllData, importAllData, clearAllData } from '@/lib/storage';
import { toast } from '@/hooks/use-toast';
import { 
  Save, 
  RotateCcw, 
  Download, 
  Upload, 
  Trash2,
} from 'lucide-react';

type SettingsSection = 'business' | 'bank' | 'preferences' | 'data';

export function Settings() {
  const { section } = useParams<{ section: string }>();
  const navigate = useNavigate();
  const { settings, updateSettings, resetSettings } = useSettings();
  const [formData, setFormData] = useState<BusinessSettings>(settings);

  const activeSection = (section as SettingsSection) || 'business';

  // Redirect if invalid section
  useEffect(() => {
    const validSections = ['business', 'bank', 'preferences', 'data'];
    if (section && !validSections.includes(section)) {
      navigate('/settings/business', { replace: true });
    }
  }, [section, navigate]);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleSave = () => {
    updateSettings(formData);
    toast({ title: 'Success', description: 'Settings saved successfully' });
  };

  const handleReset = () => {
    resetSettings();
    setFormData(defaultBusinessSettings);
    toast({ title: 'Success', description: 'Settings reset to defaults' });
  };

  const handleExport = () => {
    const data = exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-app-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Success', description: 'Data exported successfully' });
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (importAllData(content)) {
        setFormData(settings);
        toast({ title: 'Success', description: 'Data imported successfully' });
        window.location.reload();
      } else {
        toast({ title: 'Error', description: 'Failed to import data', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleClearData = () => {
    clearAllData();
    resetSettings();
    toast({ title: 'Success', description: 'All data cleared' });
    window.location.reload();
  };

  const updateField = <K extends keyof BusinessSettings>(
    field: K,
    value: BusinessSettings[K]
  ) => {
    setFormData({ ...formData, [field]: value });
  };

  const updateBankDetails = (
    field: keyof BusinessSettings['bankDetails'],
    value: string
  ) => {
    setFormData({
      ...formData,
      bankDetails: { ...formData.bankDetails, [field]: value },
    });
  };

  const updatePreferences = (
    field: keyof BusinessSettings['preferences'],
    value: string | number | boolean
  ) => {
    setFormData({
      ...formData,
      preferences: { ...formData.preferences, [field]: value },
    });
  };

  return (
    <div className="max-w-2xl">
      {activeSection === 'business' && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>
              Your business details that will appear on invoices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Business / Your Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Enter your name or business name"
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
              <Label htmlFor="taxNumber">Tax Number (Steuernummer)</Label>
              <Input
                id="taxNumber"
                value={formData.taxNumber || ''}
                onChange={(e) => updateField('taxNumber', e.target.value)}
                placeholder="Enter your tax number"
                className="rounded-lg"
              />
            </div>
            <div className="flex items-center space-x-3">
              <Switch
                id="taxNumberPending"
                checked={formData.taxNumberPending}
                onCheckedChange={(checked) =>
                  updateField('taxNumberPending', checked)
                }
              />
              <Label htmlFor="taxNumberPending" className="font-normal">
                Tax number pending (shows "wird beantragt" on invoices)
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email || ''}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="Enter your email"
                  className="rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input
                  id="phone"
                  value={formData.phone || ''}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="Enter your phone number"
                  className="rounded-lg"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === 'bank' && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Bank Details</CardTitle>
            <CardDescription>
              Your bank account details for receiving payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="accountHolder">Account Holder</Label>
              <Input
                id="accountHolder"
                value={formData.bankDetails.accountHolder}
                onChange={(e) =>
                  updateBankDetails('accountHolder', e.target.value)
                }
                placeholder="Enter account holder name"
                className="rounded-lg"
              />
            </div>
            <div>
              <Label htmlFor="iban">IBAN</Label>
              <Input
                id="iban"
                value={formData.bankDetails.iban}
                onChange={(e) => updateBankDetails('iban', e.target.value)}
                placeholder="Enter your IBAN"
                className="rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="bic">BIC</Label>
                <Input
                  id="bic"
                  value={formData.bankDetails.bic}
                  onChange={(e) => updateBankDetails('bic', e.target.value)}
                  placeholder="Enter BIC code"
                  className="rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="bankName">Bank Name</Label>
                <Input
                  id="bankName"
                  value={formData.bankDetails.bankName}
                  onChange={(e) =>
                    updateBankDetails('bankName', e.target.value)
                  }
                  placeholder="Enter bank name"
                  className="rounded-lg"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === 'preferences' && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Invoice Preferences</CardTitle>
            <CardDescription>
              Default settings for new invoices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="defaultPaymentTerms">
                Default Payment Terms
              </Label>
              <Select
                value={formData.preferences.defaultPaymentTerms.toString()}
                onValueChange={(value) =>
                  updatePreferences('defaultPaymentTerms', parseInt(value))
                }
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-3">
              <Switch
                id="isKleinunternehmer"
                checked={formData.preferences.isKleinunternehmer}
                onCheckedChange={(checked) =>
                  updatePreferences('isKleinunternehmer', checked)
                }
              />
              <Label htmlFor="isKleinunternehmer" className="font-normal">
                Kleinunternehmer (No VAT - § 19 UStG)
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="invoicePrefix">Invoice Number Prefix</Label>
                <Input
                  id="invoicePrefix"
                  value={formData.preferences.invoicePrefix}
                  onChange={(e) =>
                    updatePreferences('invoicePrefix', e.target.value)
                  }
                  placeholder="e.g., 2025-"
                  className="rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="startingInvoiceNumber">
                  Starting Invoice Number
                </Label>
                <Input
                  id="startingInvoiceNumber"
                  type="number"
                  min="1"
                  value={formData.preferences.startingInvoiceNumber}
                  onChange={(e) =>
                    updatePreferences(
                      'startingInvoiceNumber',
                      parseInt(e.target.value) || 1
                    )
                  }
                  className="rounded-lg"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={formData.preferences.currency}
                onValueChange={(value) =>
                  updatePreferences('currency', value)
                }
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                  <SelectItem value="CHF">CHF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === 'data' && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Data Management</CardTitle>
            <CardDescription>
              Export, import, or clear your data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={handleExport} className="rounded-lg">
                <Download className="h-4 w-4" />
                Export Data
              </Button>
              <div>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                  id="import-file"
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    document.getElementById('import-file')?.click()
                  }
                  className="rounded-lg"
                >
                  <Upload className="h-4 w-4" />
                  Import Data
                </Button>
              </div>
            </div>
            <div className="border-t pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                Danger zone: This action cannot be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="rounded-lg">
                    <Trash2 className="h-4 w-4" />
                    Clear All Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-lg">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all your invoices, clients,
                      and settings. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearData} className="rounded-lg">
                      Clear All Data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Actions - show for all except data section */}
      {activeSection !== 'data' && (
        <div className="flex gap-3 mt-6">
          <Button onClick={handleSave} className="rounded-lg">
            <Save className="h-4 w-4" />
            Save Settings
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="rounded-lg">
                <RotateCcw className="h-4 w-4" />
                Reset to Defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-lg">
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Settings?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will reset all settings to their default values. Your
                  invoices and clients will not be affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset} className="rounded-lg">Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
