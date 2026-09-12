import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Boxes, MessagesSquare, NotebookPen, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApi } from "@/services/api";
import { rememberMe } from "@/services/identity";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Whiteboard IV — Collaborative System Design Interviews" },
      {
        name: "description",
        content:
          "Run system design interviews on a shared canvas with audio, chat, private notes, waiting room controls and PNG/SVG/JSON exports.",
      },
      { property: "og:title", content: "Whiteboard IV — Collaborative System Design Interviews" },
      {
        property: "og:description",
        content:
          "A shared architecture canvas, audio room, chat and interviewer notes for live system design interviews.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const api = getApi();
  const [title, setTitle] = useState("System design interview");
  const [hostName, setHostName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const { session, participant } = await api.createSession({ title, hostName });
      rememberMe(session.id, participant.id);
      await navigate({ to: "/room/$sessionId", params: { sessionId: session.id } });
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-base font-bold tracking-tight">
          Whiteboard<span className="text-primary">IV</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Live design interviews
        </span>
      </header>

      <section className="mx-auto grid max-w-6xl items-start gap-10 px-6 pb-20 pt-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="max-w-xl font-display text-4xl font-bold leading-[1.08] sm:text-5xl">
            Draw the architecture together, in one room.
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted-foreground">
            A shared canvas for services, models, queues and stores — with an audio room, chat,
            candidate waiting room and interviewer-only notes. Nothing to install.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            <Feature icon={<Boxes className="h-4 w-4" />} title="Architecture canvas">
              Nine component types, labelled arrows, resizing, locking, undo and a keyboard-friendly
              structure view.
            </Feature>
            <Feature icon={<Radio className="h-4 w-4" />} title="Audio room">
              Connect, mute and see who's speaking without leaving the board.
            </Feature>
            <Feature icon={<MessagesSquare className="h-4 w-4" />} title="Chat & waiting room">
              Admit or decline candidates, then keep timestamped chat alongside the diagram.
            </Feature>
            <Feature icon={<NotebookPen className="h-4 w-4" />} title="Notes & exports">
              Shared notes, private scoring notes, snapshots and PNG / SVG / JSON export.
            </Feature>
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-semibold">Start as interviewer</h2>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="title">Session name</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="host">Your name</Label>
                <Input
                  id="host"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Alex Mendes"
                />
              </div>
              <Button type="submit" className="w-full" disabled={creating || !hostName.trim()}>
                {creating ? "Creating room…" : "Create interview room"}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <h2 className="font-display text-lg font-semibold">Joining as a candidate?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste the private link you were sent, or enter the session code.
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = joinCode.trim().split("/").pop();
                if (code) void navigate({ to: "/join/$sessionId", params: { sessionId: code } });
              }}
            >
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Session code or link"
                aria-label="Session code or link"
              />
              <Button type="submit" variant="secondary" disabled={!joinCode.trim()}>
                Join
              </Button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-card/60 p-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </li>
  );
}
