import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Notes } from "@/services/api";

export function NotesPanel({
  notes,
  isInterviewer,
  canEdit,
  onSave,
}: {
  notes: Notes;
  isInterviewer: boolean;
  canEdit: boolean;
  onSave: (patch: Partial<Notes>) => void;
}) {
  const [shared, setShared] = useState(notes.shared);
  const [privateNotes, setPrivateNotes] = useState(notes.privateNotes);

  useEffect(() => setShared(notes.shared), [notes.shared]);
  useEffect(() => setPrivateNotes(notes.privateNotes), [notes.privateNotes]);

  return (
    <Tabs defaultValue="shared" className="flex h-full flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="shared" className="flex-1">
          Shared
        </TabsTrigger>
        {isInterviewer && (
          <TabsTrigger value="private" className="flex-1">
            Private
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="shared" className="mt-3 flex-1">
        <Textarea
          className="h-full min-h-[240px] resize-none"
          value={shared}
          disabled={!canEdit}
          placeholder="Requirements, constraints, agreed scope — visible to everyone."
          onChange={(e) => setShared(e.target.value)}
          onBlur={() => onSave({ shared })}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">Saved when you click away.</p>
      </TabsContent>

      {isInterviewer && (
        <TabsContent value="private" className="mt-3 flex-1">
          <Textarea
            className="h-full min-h-[240px] resize-none"
            value={privateNotes}
            placeholder="Scoring, red flags, follow-ups — only you can see this."
            onChange={(e) => setPrivateNotes(e.target.value)}
            onBlur={() => onSave({ privateNotes })}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Interviewer only. Never shown to the candidate.
          </p>
        </TabsContent>
      )}
    </Tabs>
  );
}
