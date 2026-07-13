/**
 * DataFilterBar — reusable advanced filter/sort toolbar (R70)
 */
import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, SlidersHorizontal, ArrowUpDown } from "lucide-react";

export interface FilterOption { label: string; value: string; }
export interface FilterField {
  key: string; label: string;
  type: "text" | "select" | "number" | "date";
  options?: FilterOption[]; placeholder?: string;
}
export interface SortOption { label: string; value: string; }
export interface DataFilterBarProps {
  fields: FilterField[];
  sortOptions?: SortOption[];
  values: Record<string, string | number | undefined>;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onFilterChange: (key: string, value: string | number | undefined) => void;
  onSortChange?: (sortBy: string, sortDir: "asc" | "desc") => void;
  onReset: () => void;
  className?: string;
}

export default function DataFilterBar({ fields, sortOptions, values, sortBy, sortDir = "desc", onFilterChange, onSortChange, onReset, className = "" }: DataFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = Object.values(values).filter(v => v !== undefined && v !== "").length;
  const handleText = useCallback((key: string, val: string) => onFilterChange(key, val === "" ? undefined : val), [onFilterChange]);
  const handleSelect = useCallback((key: string, val: string) => onFilterChange(key, val === "__all__" ? undefined : val), [onFilterChange]);
  const handleNumber = useCallback((key: string, val: string) => { const n = parseFloat(val); onFilterChange(key, isNaN(n) ? undefined : n); }, [onFilterChange]);
  const toggleSortDir = useCallback(() => { if (sortBy) onSortChange?.(sortBy, sortDir === "asc" ? "desc" : "asc"); }, [onSortChange, sortBy, sortDir]);

  return (
    <div className={`border border-border rounded-lg bg-card p-3 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setExpanded(e => !e)} className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
          <SlidersHorizontal className="h-4 w-4" />
          Filters &amp; Sort
          {activeCount > 0 && <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{activeCount}</Badge>}
        </button>
        <div className="flex items-center gap-2">
          {sortOptions && sortOptions.length > 0 && (
            <div className="flex items-center gap-1">
              <Select value={sortBy ?? sortOptions[0].value} onValueChange={v => onSortChange?.(v, sortDir)}>
                <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Sort by" /></SelectTrigger>
                <SelectContent>{sortOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleSortDir} title="Toggle sort direction">
                <ArrowUpDown className={`h-3.5 w-3.5 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
              </Button>
            </div>
          )}
          {activeCount > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onReset}><X className="h-3 w-3 mr-1" />Clear</Button>}
        </div>
      </div>
      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-1 border-t border-border">
          {fields.map(field => {
            const val = values[field.key];
            if (field.type === "select" && field.options) return (
              <div key={field.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Select value={(val as string) ?? "__all__"} onValueChange={v => handleSelect(field.key, v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`All ${field.label}`} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__" className="text-xs">All</SelectItem>
                    {field.options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
            if (field.type === "number") return (
              <div key={field.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Input type="number" className="h-8 text-xs" placeholder={field.placeholder ?? field.label} value={val ?? ""} onChange={e => handleNumber(field.key, e.target.value)} />
              </div>
            );
            if (field.type === "date") return (
              <div key={field.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Input type="date" className="h-8 text-xs" value={(val as string) ?? ""} onChange={e => handleText(field.key, e.target.value)} />
              </div>
            );
            return (
              <div key={field.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Input type="text" className="h-8 text-xs" placeholder={field.placeholder ?? `Search ${field.label}…`} value={(val as string) ?? ""} onChange={e => handleText(field.key, e.target.value)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
