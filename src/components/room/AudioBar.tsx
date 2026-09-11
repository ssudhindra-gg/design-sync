import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Participant } from "@/services/api";

function Waves({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-primary transition-all duration-200",
            active ? "animate-pulse" : "opacity-30",
          )}
          style={{ height: active ? `${6 + ((i * 5 + 4) % 11)}px` : "4px" }}
        />
      ))}
    </span>
  );
}

export function AudioBar({
  me,
  participants,
  onToggleConnected,
  onToggleMute,
}: {
  me: Participant;
  participants: Participant[];
  onToggleConnected: () => void;
  onToggleMute: () => void;
}) {
  const inRoom = participants.filter((p) => p.status === "admitted" && p.audioConnected);
  const [speakerId, setSpeakerId] = useState<string | null>(null);

  // Simulated active-speaker detection while the audio backend is mocked.
  useEffect(() => {
    if (inRoom.length === 0) {
      setSpeakerId(null);
      return;
    }
    const timer = setInterval(() => {
      const talkers = inRoom.filter((p) => !p.muted);
      setSpeakerId(talkers.length ? (talkers[Math.floor(Math.random() * talkers.length)]?.id ?? null) : null);
    }, 1800);
    return () => clearInterval(timer);
  }, [inRoom.length, inRoom.map((p) => `${p.id}:${p.muted}`).join()]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Audio room
      </span>

      <Button
        size="sm"
        variant={me.audioConnected ? "secondary" : "default"}
        onClick={onToggleConnected}
      >
        {me.audioConnected ? <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> : <Phone className="mr-1.5 h-3.5 w-3.5" />}
        {me.audioConnected ? "Leave audio" : "Connect audio"}
      </Button>

      <Button size="sm" variant="outline" disabled={!me.audioConnected} onClick={onToggleMute}>
        {me.muted ? <MicOff className="mr-1.5 h-3.5 w-3.5" /> : <Mic className="mr-1.5 h-3.5 w-3.5" />}
        {me.muted ? "Unmute" : "Mute"}
      </Button>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        {inRoom.length === 0 ? (
          <span className="text-xs text-muted-foreground">No one is on the call yet.</span>
        ) : (
          inRoom.map((p) => (
            <span
              key={p.id}
              className={cn(
                "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
                speakerId === p.id && !p.muted
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              <Waves active={speakerId === p.id && !p.muted} />
              {p.name}
              {p.muted && <MicOff className="h-3 w-3" />}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
