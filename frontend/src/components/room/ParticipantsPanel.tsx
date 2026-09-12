import { Check, Mic, MicOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Participant, ParticipantStatus } from "@/services/api";

export function ParticipantsPanel({
  participants,
  myId,
  isInterviewer,
  onDecide,
}: {
  participants: Participant[];
  myId: string;
  isInterviewer: boolean;
  onDecide: (participantId: string, status: ParticipantStatus) => void;
}) {
  const waiting = participants.filter((p) => p.status === "waiting");
  const admitted = participants.filter((p) => p.status === "admitted");
  const rejected = participants.filter((p) => p.status === "rejected");

  return (
    <div className="space-y-5">
      {isInterviewer && (
        <section>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Waiting room ({waiting.length})
          </h3>
          {waiting.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nobody is waiting.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {waiting.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2"
                >
                  <span className="truncate text-sm">{p.name}</span>
                  <span className="flex gap-1">
                    <Button size="sm" className="h-7 px-2" onClick={() => onDecide(p.id, "admitted")}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Admit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => onDecide(p.id, "rejected")}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Reject {p.name}</span>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          In the room ({admitted.length})
        </h3>
        <ul className="mt-2 space-y-1.5">
          {admitted.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/60">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                {p.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 truncate text-sm">
                {p.name}
                {p.id === myId && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <Badge variant={p.role === "interviewer" ? "default" : "secondary"} className="text-[10px]">
                {p.role === "interviewer" ? "Interviewer" : "Candidate"}
              </Badge>
              {p.audioConnected ? (
                p.muted ? (
                  <MicOff className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Mic className="h-3.5 w-3.5 text-primary" />
                )
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isInterviewer && rejected.length > 0 && (
        <section>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Rejected
          </h3>
          <ul className="mt-2 space-y-1">
            {rejected.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-2 text-xs text-muted-foreground">
                {p.name}
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onDecide(p.id, "admitted")}>
                  Admit
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
