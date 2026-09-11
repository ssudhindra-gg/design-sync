import { useState } from "react";
import { Camera, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Snapshot } from "@/services/api";

export function SnapshotsPanel({
  snapshots,
  retentionDays,
  canEdit,
  isInterviewer,
  onCreate,
  onRestore,
  onDelete,
  onRetentionChange,
}: {
  snapshots: Snapshot[];
  retentionDays: number;
  canEdit: boolean;
  isInterviewer: boolean;
  onCreate: (name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onRetentionChange: (days: number) => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name);
          setName("");
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Snapshot name"
          aria-label="Snapshot name"
        />
        <Button type="submit" size="sm">
          <Camera className="mr-1.5 h-3.5 w-3.5" /> Save
        </Button>
      </form>

      <ul className="space-y-2">
        {snapshots.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No snapshots yet. Save one before a big refactor of the design.
          </p>
        )}
        {snapshots.map((s) => (
          <li key={s.id} className="rounded-md border border-border px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{s.name}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {new Date(s.at).toLocaleString()} · {s.diagram.nodes.length} components
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={!canEdit}
                  onClick={() => onRestore(s.id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="sr-only">Restore {s.name}</span>
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onDelete(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Delete {s.name}</span>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {isInterviewer && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <Label className="text-xs">Keep this session for</Label>
          <Select value={String(retentionDays)} onValueChange={(v) => onRetentionChange(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 day</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Applies to the diagram, chat and snapshots for this session.
          </p>
        </div>
      )}
    </div>
  );
}
