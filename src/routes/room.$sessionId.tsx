import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  Eye,
  LayoutGrid,
  ListTree,
  Pause,
  Play,
  Redo2,
  Undo2,
  Waypoints,
  MousePointer2,
  PhoneOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DiagramCanvas, type Tool } from "@/components/canvas/DiagramCanvas";
import { Palette } from "@/components/canvas/Palette";
import { TreeView } from "@/components/canvas/TreeView";
import { AudioBar } from "@/components/room/AudioBar";
import { ChatPanel } from "@/components/room/ChatPanel";
import { NotesPanel } from "@/components/room/NotesPanel";
import { ParticipantsPanel } from "@/components/room/ParticipantsPanel";
import { SnapshotsPanel } from "@/components/room/SnapshotsPanel";
import { Inspector } from "@/components/room/Inspector";
import { useDiagramEditor } from "@/hooks/useDiagramEditor";
import { KIND_META } from "@/lib/diagram-theme";
import { exportJson, exportPng, exportSvg } from "@/lib/diagram-utils";
import { getApi, type Diagram, type NodeKind, type Notes, type ParticipantStatus } from "@/services/api";
import { forgetMe, recallMe } from "@/services/identity";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/room/$sessionId")({
  head: () => ({
    meta: [
      { title: "Interview room — Whiteboard IV" },
      {
        name: "description",
        content:
          "Shared system design canvas with audio, chat, notes and snapshots for a live interview.",
      },
      { property: "og:title", content: "Interview room — Whiteboard IV" },
      {
        property: "og:description",
        content: "Shared system design canvas with audio, chat, notes and snapshots.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const api = getApi();
  const qc = useQueryClient();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [myId, setMyId] = useState<string | null>(null);
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

  const syncRef = useRef<string>("");
  const editor = useDiagramEditor(
    useCallback(
      (d: Diagram) => {
        syncRef.current = JSON.stringify(d);
        void api.saveDiagram(sessionId, d);
      },
      [api, sessionId],
    ),
  );
  const { replace } = editor;

  useEffect(() => {
    if (!data) return;
    const incoming = JSON.stringify(data.diagram);
    if (incoming !== syncRef.current) {
      syncRef.current = incoming;
      replace(data.diagram);
    }
  }, [data, replace]);

  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<"canvas" | "tree">("canvas");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [previewAsGuest, setPreviewAsGuest] = useState(false);

  const me = data?.participants.find((p) => p.id === myId);
  const isHost = me?.role === "interviewer";
  const actingAsInterviewer = Boolean(isHost && !previewAsGuest);
  const canEdit = Boolean(
    data &&
      me?.status === "admitted" &&
      !data.session.ended &&
      (actingAsInterviewer || !data.session.editingPaused),
  );

  const select = useCallback((nodeIds: string[], edgeId: string | null) => {
    setSelectedNodeIds(nodeIds);
    setSelectedEdgeId(edgeId);
  }, []);

  const addNode = useCallback(
    (kind: NodeKind, x: number, y: number) => {
      const meta = KIND_META[kind];
      const count = editor.diagram.nodes.filter((n) => n.kind === kind).length + 1;
      editor.apply((d) => {
        d.nodes.push({
          id: `n_${Math.random().toString(36).slice(2, 9)}`,
          kind,
          label: kind === "note" ? "New note" : `${meta.label} ${count}`,
          x,
          y,
          w: meta.w,
          h: meta.h,
        });
      });
    },
    [editor],
  );

  // Keyboard: undo / redo / delete selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && canEdit) {
        if (selectedNodeIds.length === 0 && !selectedEdgeId) return;
        e.preventDefault();
        editor.apply((d) => {
          const ids = selectedNodeIds.filter((id) => !d.nodes.find((n) => n.id === id)?.locked);
          d.nodes = d.nodes.filter((n) => !ids.includes(n.id));
          d.edges = d.edges.filter(
            (edge) =>
              !ids.includes(edge.from) && !ids.includes(edge.to) && edge.id !== selectedEdgeId,
          );
        });
        select([], null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, editor, select, selectedEdgeId, selectedNodeIds]);

  const shareLink = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/join/${sessionId}`),
    [sessionId],
  );

  if (isLoading) {
    return <CenteredNote title="Opening the room…" body="Loading the shared board." />;
  }

  if (!data) {
    return (
      <CenteredNote
        title="Session not found"
        body="This link is no longer valid or the session was created in another browser."
        action={<Link to="/"><Button>Back to start</Button></Link>}
      />
    );
  }

  if (!me) {
    return (
      <CenteredNote
        title="You're not in this session"
        body="Join with your name to request access."
        action={
          <Link to="/join/$sessionId" params={{ sessionId }}>
            <Button>Join session</Button>
          </Link>
        }
      />
    );
  }

  if (me.status !== "admitted") {
    return (
      <CenteredNote
        title={me.status === "rejected" ? "Access declined" : "Waiting for the interviewer"}
        body={
          me.status === "rejected"
            ? "The interviewer declined this request. You can ask them for a new link."
            : "You're in the waiting room. The interviewer will let you in shortly."
        }
        action={<Link to="/"><Button variant="outline">Leave</Button></Link>}
      />
    );
  }

  const filename = data.session.title.replace(/\s+/g, "-").toLowerCase() || "diagram";

  const doExport = async (kind: "png" | "svg" | "json") => {
    try {
      if (kind === "json") exportJson(editor.diagram, filename);
      else if (!svgRef.current) toast.error("Switch to the canvas view first");
      else if (kind === "svg") exportSvg(svgRef.current, editor.diagram, filename);
      else await exportPng(svgRef.current, editor.diagram, filename);
      toast.success(`Exported ${kind.toUpperCase()}`);
    } catch {
      toast.error("Export failed");
    }
  };

  const decide = (participantId: string, status: ParticipantStatus) => {
    void api.setParticipantStatus(sessionId, participantId, status);
  };

  const saveNotes = (patch: Partial<Notes>) => {
    void api.saveNotes(sessionId, patch);
  };

  const waitingCount = data.participants.filter((p) => p.status === "waiting").length;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link to="/" className="font-display text-sm font-bold tracking-tight">
          Whiteboard<span className="text-primary">IV</span>
        </Link>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.session.title}</p>
          <p className="font-mono text-[10px] text-muted-foreground">#{sessionId}</p>
        </div>
        <Badge variant={data.session.ended ? "destructive" : "secondary"} className="ml-1">
          {data.session.ended ? "Ended" : data.session.editingPaused ? "Editing paused" : "Live"}
        </Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isHost && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(shareLink);
                  toast.success("Private join link copied");
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Share link
                {waitingCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[10px] text-warning-foreground">
                    {waitingCount}
                  </span>
                )}
              </Button>
              <Button
                size="sm"
                variant={previewAsGuest ? "default" : "outline"}
                onClick={() => setPreviewAsGuest((v) => !v)}
                title="Preview the room the way the candidate sees it"
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {previewAsGuest ? "Viewing as candidate" : "View as candidate"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void api.updateSession(sessionId, { editingPaused: !data.session.editingPaused })
                }
              >
                {data.session.editingPaused ? (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                )}
                {data.session.editingPaused ? "Resume editing" : "Pause editing"}
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void doExport("png")}>PNG image</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("svg")}>SVG vector</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("json")}>JSON data</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isHost ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={data.session.ended}
              onClick={() => {
                void api.updateSession(sessionId, { ended: true });
                toast("Session ended. The board is now read-only.");
              }}
            >
              End session
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                forgetMe(sessionId);
                void navigate({ to: "/" });
              }}
            >
              <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> Leave
            </Button>
          )}
        </div>
      </header>

      {isHost && waitingCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <span>
            {waitingCount} {waitingCount === 1 ? "person is" : "people are"} waiting to be admitted.
          </span>
          <span className="flex gap-2">
            {data.participants
              .filter((p) => p.status === "waiting")
              .map((p) => (
                <span key={p.id} className="flex items-center gap-1.5">
                  <strong className="text-sm font-medium">{p.name}</strong>
                  <Button size="sm" className="h-6 px-2" onClick={() => decide(p.id, "admitted")}>
                    Admit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={() => decide(p.id, "rejected")}
                  >
                    Reject
                  </Button>
                </span>
              ))}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* Left rail */}
        <aside className="hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-2 lg:flex">
          <div className="flex gap-1">
            <ToolButton active={tool === "select"} onClick={() => setTool("select")} label="Select">
              <MousePointer2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton
              active={tool === "connect"}
              onClick={() => setTool("connect")}
              label="Connect"
              disabled={!canEdit}
            >
              <Waypoints className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={editor.undo} label="Undo" disabled={!editor.canUndo}>
              <Undo2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={editor.redo} label="Redo" disabled={!editor.canRedo}>
              <Redo2 className="h-4 w-4" />
            </ToolButton>
          </div>

          <Palette
            disabled={!canEdit}
            onAdd={(kind) => {
              const i = editor.diagram.nodes.length;
              addNode(kind, 160 + (i % 4) * 240, 120 + Math.floor(i / 4) * 170);
            }}
          />

          <div className="mt-auto">
            <Inspector
              diagram={editor.diagram}
              selectedNodeIds={selectedNodeIds}
              selectedEdgeId={selectedEdgeId}
              canEdit={canEdit}
              isInterviewer={actingAsInterviewer}
              onApply={editor.apply}
              onToggleLock={(nodeId, locked) => void api.setNodeLock(sessionId, nodeId, locked)}
            />
          </div>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => setView("canvas")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                  view === "canvas" ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Canvas
              </button>
              <button
                type="button"
                onClick={() => setView("tree")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                  view === "tree" ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                <ListTree className="h-3.5 w-3.5" /> Structure
              </button>
            </div>
            {!canEdit && (
              <span className="text-xs text-muted-foreground">
                {data.session.ended
                  ? "Session ended — the board is read-only."
                  : "Editing is paused by the interviewer."}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {view === "canvas" ? (
              <DiagramCanvas
                diagram={editor.diagram}
                canEdit={canEdit}
                tool={tool}
                selectedNodeIds={selectedNodeIds}
                selectedEdgeId={selectedEdgeId}
                onSelect={select}
                onApply={editor.apply}
                onApplyLive={editor.applyLive}
                onBeginGesture={editor.beginGesture}
                onEndGesture={editor.endGesture}
                onAddNode={addNode}
                svgRef={svgRef}
              />
            ) : (
              <TreeView
                diagram={editor.diagram}
                selectedNodeIds={selectedNodeIds}
                selectedEdgeId={selectedEdgeId}
                onSelect={select}
              />
            )}
          </div>

          <AudioBar
            me={me}
            participants={data.participants}
            onToggleConnected={() =>
              void api.updatePresence(sessionId, me.id, {
                audioConnected: !me.audioConnected,
                muted: me.audioConnected ? true : false,
              })
            }
            onToggleMute={() => void api.updatePresence(sessionId, me.id, { muted: !me.muted })}
          />
        </main>

        {/* Right rail */}
        <aside className="hidden w-80 shrink-0 flex-col rounded-lg border border-border bg-card p-3 xl:flex">
          <Tabs defaultValue="people" className="flex h-full flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="people" className="flex-1 text-xs">
                People
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex-1 text-xs">
                Chat
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex-1 text-xs">
                Notes
              </TabsTrigger>
              <TabsTrigger value="snapshots" className="flex-1 text-xs">
                Saves
              </TabsTrigger>
            </TabsList>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              <TabsContent value="people">
                <ParticipantsPanel
                  participants={data.participants}
                  myId={me.id}
                  isInterviewer={actingAsInterviewer}
                  onDecide={decide}
                />
              </TabsContent>
              <TabsContent value="chat" className="h-full">
                <ChatPanel
                  messages={data.chat}
                  myId={me.id}
                  onSend={(body) =>
                    void api.sendMessage({
                      sessionId,
                      authorId: me.id,
                      authorName: me.name,
                      body,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="notes" className="h-full">
                <NotesPanel
                  notes={data.notes}
                  isInterviewer={actingAsInterviewer}
                  canEdit={!data.session.ended}
                  onSave={saveNotes}
                />
              </TabsContent>
              <TabsContent value="snapshots">
                <SnapshotsPanel
                  snapshots={data.snapshots}
                  retentionDays={data.session.retentionDays}
                  canEdit={canEdit}
                  isInterviewer={actingAsInterviewer}
                  onCreate={(name) => void api.createSnapshot(sessionId, name)}
                  onRestore={(id) => void api.restoreSnapshot(sessionId, id)}
                  onDelete={(id) => void api.deleteSnapshot(sessionId, id)}
                  onRetentionChange={(days) =>
                    void api.updateSession(sessionId, { retentionDays: days })
                  }
                />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

function ToolButton({
  children,
  active,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md border border-transparent",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function CenteredNote({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
