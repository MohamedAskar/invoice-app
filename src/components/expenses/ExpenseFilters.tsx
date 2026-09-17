import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { expenseCategories, expenseSources, expenseStatuses, ExpenseCategory, ExpenseSource, ExpenseStatus } from '@/types/finance';

export interface ExpenseFilterState {
  year: string;
  category: 'all' | ExpenseCategory;
  status: 'all' | ExpenseStatus;
  source: 'all' | ExpenseSource;
  query: string;
  sort: 'date-desc' | 'date-asc';
}

interface ExpenseFiltersProps {
  filters: ExpenseFilterState;
  years: number[];
  onChange: (filters: ExpenseFilterState) => void;
}

const labels: Record<string, string> = {
  needs_review: 'Needs review', booked: 'Booked', voided: 'Voided',
  professional_services: 'Professional services', telecommunications: 'Telecommunications',
};

function labelFor(value: string): string {
  return labels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export function ExpenseFilters({ filters, years, onChange }: ExpenseFiltersProps) {
  const update = <Key extends keyof ExpenseFilterState>(key: Key, value: ExpenseFilterState[Key]) => onChange({ ...filters, [key]: value });

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div className="relative sm:col-span-2 xl:col-span-2">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search expenses" value={filters.query} onChange={(event) => update('query', event.target.value)} placeholder="Vendor, invoice number, or note" className="pl-9" />
      </div>
      <Select value={filters.year} onValueChange={(value) => update('year', value)}>
        <SelectTrigger aria-label="Year"><SelectValue placeholder="Year" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All years</SelectItem>{years.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.category} onValueChange={(value) => update('category', value as ExpenseFilterState['category'])}>
        <SelectTrigger aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All categories</SelectItem>{expenseCategories.map((category) => <SelectItem key={category} value={category}>{labelFor(category)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.status} onValueChange={(value) => update('status', value as ExpenseFilterState['status'])}>
        <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All statuses</SelectItem>{expenseStatuses.map((status) => <SelectItem key={status} value={status}>{labelFor(status)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.source} onValueChange={(value) => update('source', value as ExpenseFilterState['source'])}>
        <SelectTrigger aria-label="Source"><SelectValue placeholder="Source" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All sources</SelectItem>{expenseSources.map((source) => <SelectItem key={source} value={source}>{labelFor(source)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.sort} onValueChange={(value) => update('sort', value as ExpenseFilterState['sort'])}>
        <SelectTrigger aria-label="Date sorting"><SelectValue placeholder="Sort by date" /></SelectTrigger>
        <SelectContent><SelectItem value="date-desc">Date: newest first</SelectItem><SelectItem value="date-asc">Date: oldest first</SelectItem></SelectContent>
      </Select>
    </div>
  );
}
