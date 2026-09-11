import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApi } from "@/services/api";
import { recallMe, rememberMe } from "@/services/identity";

export const Route = createFileRoute("/join/$sessionId")({
  head: () => ({
    meta: [
      { title: "Join interview — Whiteboard IV" },
      {
        name: "description",
        content: "Enter your name to join the system design interview and wait to be admitted.",
      },
      { property: "og:title", content: "Join interview — Whiteboard IV" },
      {
        property: "og:description",
        content: "Enter your name to join the system design interview.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const api = getApi();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [myId, setMyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setMyId(recallMe(sessionId)), [sessionId]);

  const { data, isLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.getSession(sessionId),
    enabled: typeof window !== "undefined",
  });

  useEffect(
    () => api.subscribe(sessionId, () => qc.invalidateQueries({ queryKey: ["session", sessionId] })),
    [api, qc, sessionId],
  );

  const me = data?.participants.find((p) => p.id === myId);

  useEffect(() => {
    if (me?.status === "admitted") void navigate({ to: "/room/$sessionId", params: { sessionId } });
  }, [me?.status, navigate, sessionId]);

  const join = async () => {
    setSubmitting(true);
    try {
      const participant = await api.joinSession({ sessionId, name, role: "guest" });
      rememberMe(sessionId, participant.id);
      setMyId(participant.id);
      await qc.invalidateQueries({ queryKey: ["session", sessionId] });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <Link to="/" className="font-display text-sm font-bold tracking-tight">
          Whiteboard<span className="text-primary">IV</span>
        </Link>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking the invitation…</p>
        ) : !data ? (
          <>
            <h1 className="mt-4 font-display text-xl font-semibold">Invitation not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This link is invalid, or the session was created in a different browser.
            </p>
          </>
        ) : me ? (
          <div className="mt-4">
            <h1 className="font-display text-xl font-semibold">
              {me.status === "rejected" ? "Access declined" : "Waiting to be admitted"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {me.status === "rejected"
                ? "The interviewer declined this request."
                : `Hi ${me.name} — the interviewer has been notified. You'll join automatically once they let you in.`}
            </p>
            {me.status === "waiting" && (
              <div className="mt-5 flex items-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" /> In the waiting room
              </div>
            )}
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void join();
            }}
          >
            <div>
              <h1 className="font-display text-xl font-semibold">{data.session.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                You're joining as the candidate. The interviewer will admit you.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya Raman"
              />
            </div>
            <Button type="submit" className="w-full" disabled={!name.trim() || submitting}>
              {submitting ? "Requesting…" : "Ask to join"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
