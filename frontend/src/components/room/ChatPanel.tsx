import { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/services/api";

export function ChatPanel({
  messages,
  myId,
  onSend,
}: {
  messages: ChatMessage[];
  myId: string;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No messages yet. Use chat for links, constraints and hints.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.authorId === myId;
          return (
            <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium">{mine ? "You" : m.authorName}</span>
                <time className="font-mono text-[10px] text-muted-foreground">
                  {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <p
                className={cn(
                  "mt-1 max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  mine ? "bg-primary/15 text-foreground" : "bg-secondary text-foreground",
                )}
              >
                {m.body}
              </p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onSend(draft.trim());
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room"
          aria-label="Chat message"
        />
        <Button type="submit" size="icon" aria-label="Send message">
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
