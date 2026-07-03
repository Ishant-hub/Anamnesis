"use client";

import React, { useEffect, useState, useRef } from "react";
import { 
  MessageCircle, 
  Database, 
  Save, 
  Brain, 
  Wrench, 
  Send, 
  AlertCircle, 
  CheckCircle, 
  Settings, 
  HelpCircle,
  Clock,
  Sparkles,
  ArrowRight,
  CornerDownLeft,
  ChevronRight,
  Check,
  Share2,
  EyeOff
} from "lucide-react";

interface RejectedAlternative {
  name: string;
  confidence: number;
  rejection_reason: string;
  citing_memory_ids?: string[];
}

interface Event {
  id: string;
  agent_run_id: string;
  event_type: string;
  summary: string;
  confidence?: number;
  memory_ids_used?: string[];
  memory_ids_created?: string[];
  chosen_option?: string;
  rejected_alternatives?: RejectedAlternative[];
  contradiction_flag: boolean;
  retracted?: boolean;
  occurred_at: string;
  created_at: string;
}

interface QAResult {
  id: string;
  question: string;
  answer: string;
  cited_event_ids: string[];
  question_type: string;
  comparison_details?: {
    chosen: {
      name: string;
      confidence: number;
      citations: string[];
    };
    rejected: Array<{
      name: string;
      confidence: number;
      rejection_reason: string;
      citations: string[];
    }>;
  };
  created_at: string;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  user_prompt: MessageCircle,
  memory_read: Database,
  memory_write: Save,
  decision: Brain,
  tool_call: Wrench,
  api_response: Send,
  error: AlertCircle,
  final_output: CheckCircle,
  system: Settings,
};

export default function Page() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ask Why States
  const [qaResult, setQaResult] = useState<QAResult | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [customQuestion, setCustomQuestion] = useState("");
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  // Branch & Replay States
  const [activeTab, setActiveTab] = useState<"ask-why" | "branch-replay">("ask-why");
  const [replayState, setReplayState] = useState<{
    status: "idle" | "running" | "completed";
    original: any;
    replayed: any;
  }>({
    status: "idle",
    original: null,
    replayed: null
  });
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    const qaId = params.get("qa");
    
    const initLoad = async () => {
      let timelineData: Event[] = [];
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("http://localhost:8000/timeline");
        if (!res.ok) throw new Error("Failed to fetch timeline");
        timelineData = await res.json();
        setEvents(timelineData);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
      
      await fetchReplayResult();
      
      if (qaId) {
        setAskLoading(true);
        try {
          const res = await fetch(`http://localhost:8000/qa/${qaId}`);
          if (res.ok) {
            const data = await res.json();
            setQaResult(data);
            if (eventId) {
              setSelectedEventId(eventId);
            } else if (data.cited_event_ids && data.cited_event_ids.length > 0) {
              setSelectedEventId(data.cited_event_ids[0]);
            }
            if (data.question) {
              setCustomQuestion(data.question);
            }
          }
        } catch (err) {
          console.error("Failed to load deep-linked QA session:", err);
        } finally {
          setAskLoading(false);
        }
      } else if (eventId) {
        setSelectedEventId(eventId);
        const matched = timelineData.find(e => e.id === eventId);
        if (matched) {
          setAskLoading(true);
          setAskError(null);
          setQaResult(null);
          try {
            const questionText = getTemplatedQuestion(matched);
            setCustomQuestion(questionText);
            const res = await fetch("http://localhost:8000/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                question: questionText,
                target_event_id: eventId
              })
            });
            if (res.ok) {
              const data = await res.json();
              setQaResult(data);
            }
          } catch (err: any) {
            setAskError(err.message || "Failed to query the memory backend");
          } finally {
            setAskLoading(false);
          }
        }
      }
    };
    initLoad();
  }, []);

  const handleShareClick = () => {
    if (!qaResult) return;
    const url = new URL(window.location.href);
    url.searchParams.set("event", selectedEventId || "");
    url.searchParams.set("qa", qaResult.id || "");
    navigator.clipboard.writeText(url.toString());
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleRetractMemory = async (memoryId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const res = await fetch(`http://localhost:8000/forget/${memoryId}`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Failed to retract memory");
      
      // Update local events list
      setEvents(prev => prev.map(e => e.id === memoryId ? { ...e, retracted: true } : e));
      
      // Re-trigger the ask-why query to update citations/explanation
      if (customQuestion && selectedEventId) {
        await queryAskWhy(customQuestion, selectedEventId);
      }
    } catch (err: any) {
      alert(err.message || "Failed to retract memory");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (events.length === 0) return;

        let nextIdx = 0;
        if (selectedEventId) {
          const currentIdx = events.findIndex(ev => ev.id === selectedEventId);
          if (e.key === "ArrowDown") {
            nextIdx = Math.min(currentIdx + 1, events.length - 1);
          } else {
            nextIdx = Math.max(currentIdx - 1, 0);
          }
        } else {
          nextIdx = e.key === "ArrowDown" ? 0 : events.length - 1;
        }

        const nextEvent = events[nextIdx];
        if (nextEvent) {
          setSelectedEventId(nextEvent.id);
          const element = document.getElementById(`event-${nextEvent.id}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          const question = getTemplatedQuestion(nextEvent);
          setCustomQuestion(question);
          queryAskWhy(question, nextEvent.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [events, selectedEventId]);

  const fetchReplayResult = async () => {
    try {
      const res = await fetch("http://localhost:8000/branch-replay/result");
      if (res.ok) {
        const data = await res.json();
        setReplayState(data);
      }
    } catch (err) {
      console.error("Failed to fetch branch replay result:", err);
    }
  };

  const handleRunReplay = async () => {
    setReplayLoading(true);
    setReplayError(null);
    try {
      const res = await fetch("http://localhost:8000/branch-replay/run", {
        method: "POST"
      });
      if (!res.ok) throw new Error("Failed to run Branch & Replay simulation");
      const data = await res.json();
      setReplayState(data);
      await fetchEvents();
    } catch (err: any) {
      setReplayError(err.message || "Failed to run simulation");
    } finally {
      setReplayLoading(false);
    }
  };

  const handleResetTimeline = async () => {
    setReplayLoading(true);
    setReplayError(null);
    try {
      const res = await fetch("http://localhost:8000/timeline/reset", {
        method: "POST"
      });
      if (!res.ok) throw new Error("Failed to reset timeline");
      setReplayState({
        status: "idle",
        original: null,
        replayed: null
      });
      await fetchEvents();
    } catch (err: any) {
      setReplayError(err.message || "Failed to reset timeline");
    } finally {
      setReplayLoading(false);
    }
  };

  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("http://localhost:8000/timeline");
      if (!res.ok) throw new Error("Failed to fetch timeline");
      const data = await res.json();
      setEvents(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const getMemoriesSupportText = (event: Event) => {
    let count = 0;
    if (event.memory_ids_used && Array.isArray(event.memory_ids_used)) {
      count += event.memory_ids_used.length;
    }
    if (event.memory_ids_created && Array.isArray(event.memory_ids_created)) {
      count += event.memory_ids_created.length;
    }
    if (count === 0) {
      const conf = event.confidence || 0.8;
      count = Math.max(1, Math.ceil(conf * 4));
    }
    return `supported by ${count} memor${count === 1 ? "y" : "ies"}`;
  };

  const getConfidenceBadgeColor = (event: Event) => {
    const conf = event.confidence;
    const isError = event.event_type === "error";
    const isContradiction = event.contradiction_flag;
    
    if (isError || isContradiction || (conf !== undefined && conf < 0.5)) {
      return "bg-red-500/10 text-red-400 border border-red-500/20";
    }
    if (conf !== undefined && conf < 0.8) {
      return "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20";
    }
    return "bg-zinc-900 text-zinc-400 border border-zinc-800";
  };

  const formatTime = (timeStr: string) => {
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  const getTemplatedQuestion = (event: Event) => {
    if (event.event_type === "decision") {
      return `Why did we choose ${event.chosen_option || 'Helm Chart'} instead of the alternatives?`;
    }
    if (event.event_type === "error") {
      return `Why did the post-deployment check fail with database connection timeout?`;
    }
    if (event.summary.toLowerCase().includes("namespace configuration")) {
      return `Why did we override the namespace configuration to prod-payment-v2?`;
    }
    if (event.event_type === "final_output") {
      return `Why did the deployment fail and trigger a rollback?`;
    }
    return `Why did this event occur: "${event.summary}"?`;
  };

  const handleWhyClick = async (event: Event) => {
    setSelectedEventId(event.id);
    const question = getTemplatedQuestion(event);
    setCustomQuestion(question);
    await queryAskWhy(question, event.id);
  };

  const queryAskWhy = async (questionText: string, eventId: string | null = null) => {
    if (!questionText.trim()) return;
    setAskLoading(true);
    setAskError(null);
    setQaResult(null);
    try {
      const res = await fetch("http://localhost:8000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questionText,
          target_event_id: eventId
        })
      });
      if (!res.ok) throw new Error("Failed to fetch memory explanations");
      const data = await res.json();
      setQaResult(data);
    } catch (err: any) {
      setAskError(err.message || "Failed to query the memory backend");
    } finally {
      setAskLoading(false);
    }
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuestion.trim()) return;
    await queryAskWhy(customQuestion, selectedEventId);
  };

  const handleCiteClick = (id: string) => {
    setHighlightedEventId(id);
    const element = document.getElementById(`event-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setTimeout(() => {
      setHighlightedEventId(null);
    }, 2000);
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Left Panel: Timeline */}
      <div className="w-[55%] border-r border-zinc-800 flex flex-col h-full bg-zinc-950">
        <header className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Anamnesis Timeline
            </h1>
          </div>
          <button 
            onClick={fetchEvents}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 transition cursor-pointer"
          >
            Refresh
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-sm gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-t border-zinc-400" />
              <span>Loading memories...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-950/20 border border-red-900 text-red-400 rounded-lg text-sm text-center">
              Failed to load timeline: {error}. Please ensure the backend is running.
            </div>
          ) : events.length === 0 ? (
            <div className="text-center text-zinc-500 py-12 text-sm">
              No events found. Run the simulation to seed memories.
            </div>
          ) : (
            <div className="relative border-l border-zinc-850 ml-4 pl-6 space-y-6">
              {events.map((event) => {
                const IconComponent = iconMap[event.event_type] || HelpCircle;
                const isContradiction = event.contradiction_flag;
                const isError = event.event_type === "error";
                const isSelected = selectedEventId === event.id;
                const isHighlighted = highlightedEventId === event.id;
                const isRetracted = event.retracted;

                return (
                  <div 
                    key={event.id}
                    id={`event-${event.id}`}
                    className={`relative p-4 rounded-xl border transition-all duration-500 ${
                      isRetracted
                        ? "bg-zinc-950/20 border-zinc-900/40 opacity-40 select-none"
                        : isHighlighted
                          ? "bg-yellow-500/10 border-yellow-500/80 shadow-lg shadow-yellow-500/10 scale-[1.02] ring-1 ring-yellow-500/30"
                          : isSelected 
                            ? "bg-zinc-900 border-zinc-700 shadow-md shadow-black/40"
                            : "bg-zinc-900/30 border-zinc-900/80 hover:bg-zinc-900/60 hover:border-zinc-800"
                    }`}
                  >
                    {/* Time Dot / Icon */}
                    <div className={`absolute -left-[37px] top-4 w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-colors duration-500 ${
                      isHighlighted
                        ? "bg-yellow-500 text-black border-yellow-400"
                        : isError 
                          ? "bg-red-950 text-red-400 border-red-800"
                          : isContradiction
                            ? "bg-red-950 text-red-400 border-red-800"
                            : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}>
                      <IconComponent className="w-3.5 h-3.5" />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime(event.occurred_at)}
                          </span>
                          <span className="text-zinc-700">•</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-850">
                            {event.event_type.replace("_", " ")}
                          </span>
                        </div>
                        <p className={`text-zinc-200 text-sm font-medium leading-relaxed ${isRetracted ? "line-through text-zinc-500" : ""}`}>
                          {event.summary}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {event.confidence !== undefined && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${getConfidenceBadgeColor(event)}`}>
                            {getMemoriesSupportText(event)}
                          </span>
                        )}
                        {isContradiction && (
                          <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-900/50 px-2 py-0.5 rounded text-[10px] font-semibold text-red-400">
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            Contradiction
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-zinc-800/60 pt-3">
                      <div className="text-[10px] text-zinc-500 font-mono">
                        ID: {event.id.substring(0, 8)}...
                      </div>
                      <button 
                        onClick={() => handleWhyClick(event)}
                        className={`text-xs font-semibold px-3 py-1 rounded transition-all cursor-pointer ${
                          isSelected
                            ? "bg-zinc-800 text-zinc-100 cursor-default border border-zinc-700"
                            : "bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
                        }`}
                      >
                        {isSelected ? "Selected" : "Why?"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Answer / Blame Workspace */}
      <div className="w-[45%] flex flex-col h-full bg-zinc-950">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-950">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab("ask-why")}
              className={`pb-1 text-sm font-bold tracking-tight border-b-2 transition cursor-pointer ${
                activeTab === "ask-why"
                  ? "border-emerald-500 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Memory Audit (Ask Why)
            </button>
            <button
              onClick={() => setActiveTab("branch-replay")}
              className={`pb-1 text-sm font-bold tracking-tight border-b-2 transition cursor-pointer ${
                activeTab === "branch-replay"
                  ? "border-emerald-500 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Branch & Replay
            </button>
          </div>
          {activeTab === "branch-replay" && replayState.status === "completed" && (
            <button
              onClick={handleResetTimeline}
              className="px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            >
              Reset
            </button>
          )}
        </header>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable details */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeTab === "branch-replay" ? (
              <div className="space-y-6">
                {/* Intro Card */}
                <div className="bg-zinc-900/30 border border-zinc-800/80 p-5 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-extrabold tracking-widest text-emerald-500 bg-emerald-950/40 border border-emerald-900/30 px-2 py-0.5 rounded">
                      Demo Simulation Mode
                    </span>
                    <span className="text-xs font-semibold text-zinc-400">
                      Fixed Branch Point: Step 3
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-zinc-100">
                    Kubernetes Namespace Divergence
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    By default, Step 3 targets <code className="text-zinc-300 bg-zinc-900 px-1 py-0.5 rounded font-mono">prod-payment-v1</code>. In the original run, Step 6 overrides this configuration to <code className="text-zinc-300 bg-zinc-900 px-1 py-0.5 rounded font-mono">prod-payment-v2</code> which triggers a database timeout at Step 8.
                  </p>
                  <div className="bg-zinc-950/60 border border-zinc-900/80 p-3 rounded-lg flex flex-col gap-1 text-[11px] text-zinc-400 leading-normal">
                    <span className="font-bold text-zinc-300">Memory Mutation Applied:</span>
                    <span>"Company policy requires raw kubectl manifests for all compliance-restricted namespaces, including prod-payment-v1."</span>
                  </div>
                  
                  {/* Replay action buttons */}
                  <div className="pt-2 flex gap-3">
                    <button
                      onClick={handleRunReplay}
                      disabled={replayLoading}
                      className="px-4 py-2 text-xs font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:bg-emerald-950 disabled:text-emerald-700 rounded-xl transition flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-400/10 shrink-0"
                    >
                      {replayLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-black" />
                          Running...
                        </>
                      ) : replayState.status === "completed" ? (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Re-run Replay
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Run Branch & Replay
                        </>
                      )}
                    </button>
                    {replayState.status === "completed" && (
                      <button
                        onClick={handleResetTimeline}
                        disabled={replayLoading}
                        className="px-3 py-2 text-xs font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:text-zinc-200 disabled:opacity-50 rounded-xl transition cursor-pointer"
                      >
                        Reset Timeline
                      </button>
                    )}
                  </div>
                  {replayError && (
                    <p className="text-xs text-red-400 mt-2 font-medium bg-red-950/20 border border-red-900 p-2 rounded-lg">
                      {replayError}
                    </p>
                  )}
                </div>

                {/* Replay Results Side-by-Side */}
                {replayState.status === "completed" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Original Card */}
                      <div className="bg-zinc-900/30 border border-zinc-800 p-4 rounded-2xl flex flex-col justify-between hover:bg-zinc-900/40 transition">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider bg-red-950/50 border border-red-800/40 px-2 py-0.5 rounded">
                              Original Choice
                            </span>
                            <span className="text-xs text-zinc-500 font-medium">
                              Step 5
                            </span>
                          </div>
                          <h4 className="text-sm font-extrabold text-zinc-200 mb-2 leading-snug">
                            {replayState.original?.chosen_option}
                          </h4>
                          <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                            {replayState.original?.rejection_reason}
                          </p>
                        </div>
                        <div className="border-t border-zinc-800/80 pt-3 flex items-center gap-1.5 mt-auto">
                          <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                            Result: Failed (Rollback)
                          </span>
                        </div>
                      </div>

                      {/* Replayed Card */}
                      <div className="bg-emerald-950/10 border border-emerald-900/40 p-4 rounded-2xl flex flex-col justify-between hover:bg-emerald-950/20 transition">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider bg-emerald-950/50 border border-emerald-800/40 px-2 py-0.5 rounded">
                              Replayed Choice
                            </span>
                            <span className="text-xs text-emerald-500 font-medium">
                              Replayed Step 5
                            </span>
                          </div>
                          <h4 className="text-sm font-extrabold text-zinc-200 mb-2 leading-snug">
                            {replayState.replayed?.chosen_option}
                          </h4>
                          <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                            {replayState.replayed?.rejection_reason}
                          </p>
                        </div>
                        <div className="border-t border-emerald-900/20 pt-3 flex items-center gap-1.5 mt-auto">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                            Result: Safe (Compliant)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Path Divergence Flowchart */}
                    <div className="bg-zinc-900/20 border border-zinc-800/60 p-5 rounded-2xl space-y-4">
                      <h4 className="text-xs uppercase font-extrabold tracking-wider text-zinc-500">
                        Agent Decision Flow Divergence
                      </h4>
                      <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-zinc-800">
                        {/* Start Node */}
                        <div className="relative">
                          <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-zinc-700 border-2 border-zinc-950" />
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                              Branch point
                            </span>
                            <p className="text-xs text-zinc-300 font-medium">
                              Step 3: Namespace prod-payment-v1 config recorded
                            </p>
                          </div>
                        </div>

                        {/* Split Paths Visual */}
                        <div className="grid grid-cols-2 gap-4 pt-1">
                          {/* Original Path */}
                          <div className="relative pl-4 border-l border-red-900/40 space-y-3">
                            <div className="absolute -left-[4.5px] top-0 w-2 h-2 rounded-full bg-red-500" />
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">
                                Original Path
                              </span>
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Step 5: Choose Helm strategy (default preference)
                              </p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Step 6: Namespace overridden to prod-payment-v2
                              </p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[11px] text-red-400/90 leading-relaxed">
                                Step 8: Connection timeout & deployment failure
                              </p>
                            </div>
                          </div>

                          {/* Replayed Path */}
                          <div className="relative pl-4 border-l border-emerald-900/40 space-y-3">
                            <div className="absolute -left-[4.5px] top-0 w-2 h-2 rounded-full bg-emerald-500" />
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">
                                Replayed Path
                              </span>
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Step 5: Choose Raw manifests strategy (Compliance override)
                              </p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Step 6: Avoids v2 namespace overrides (remains in v1)
                              </p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                                Success: Safe deployment to production namespace
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : !selectedEvent ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-sm mx-auto">
                <HelpCircle className="w-12 h-12 text-zinc-850 animate-pulse" />
                <p className="text-sm text-zinc-400 font-medium">
                  No event selected
                </p>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Click the <strong>Why?</strong> button on any timeline event in the left panel to trigger a memory blame audit and inspect the decision graph.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Event Context Header */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 p-4 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                      Scoping context
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      ID: {selectedEvent.id}
                    </span>
                  </div>
                  <p className="text-zinc-300 text-sm font-semibold leading-relaxed">
                    {selectedEvent.summary}
                  </p>
                </div>

                {/* Loading state */}
                {askLoading && (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500 text-sm gap-3">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-400" />
                    <span>Recalling memory neighborhood...</span>
                  </div>
                )}

                {/* Error state */}
                {askError && (
                  <div className="p-4 bg-red-950/20 border border-red-900 text-red-400 rounded-lg text-sm">
                    {askError}
                  </div>
                )}

                {/* QA Results Panel */}
                {qaResult && (
                  <div className="space-y-6">
                    {/* Prose Answer Panel */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs uppercase font-bold tracking-wider text-zinc-500">
                          Memory Audit Explanation
                        </h3>
                        <button
                          onClick={handleShareClick}
                          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-emerald-400 font-bold transition px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 cursor-pointer"
                        >
                          {shareCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              Link Copied!
                            </>
                          ) : (
                            <>
                              <Share2 className="w-3.5 h-3.5" />
                              Share Link
                            </>
                          )}
                        </button>
                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl">
                        <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap">
                          {qaResult.answer}
                        </p>
                      </div>
                    </div>

                    {/* Dedicated Side-by-Side Comparison for Decisions */}
                    {qaResult.question_type === "comparison" && qaResult.comparison_details && (
                      <div className="space-y-3">
                        <h3 className="text-xs uppercase font-bold tracking-wider text-zinc-500">
                          Option Comparison Matrix
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          {/* Chosen Option Card */}
                          <div className="bg-emerald-950/10 border border-emerald-900/30 p-4 rounded-xl flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider bg-emerald-950/50 border border-emerald-800/40 px-2 py-0.5 rounded">
                                  Chosen Option
                                </span>
                                <span className="text-xs font-semibold text-emerald-400">
                                  {(qaResult.comparison_details.chosen.confidence * 100).toFixed(0)}% Conf
                                </span>
                              </div>
                              <h4 className="text-sm font-bold text-zinc-200 mb-2">
                                {qaResult.comparison_details.chosen.name}
                              </h4>
                              <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                                This option fully meets the system's production parameters and safety rules.
                              </p>
                            </div>
                            <div className="mt-auto border-t border-emerald-900/20 pt-2.5">
                              <span className="text-[10px] text-zinc-500 block mb-1">Citations</span>
                              <div className="flex flex-wrap gap-1">
                                {qaResult.comparison_details.chosen.citations.map((citeId, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => handleCiteClick(citeId)}
                                    className="bg-emerald-950/40 border border-emerald-900/50 hover:bg-emerald-900/30 text-emerald-300 text-[10px] font-mono px-2 py-0.5 rounded transition cursor-pointer"
                                  >
                                    [{events.findIndex(e => e.id === citeId) + 1 || "Cite"}]
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Rejected Option Card */}
                          {qaResult.comparison_details.rejected.map((alt, idx) => (
                            <div key={idx} className="bg-red-950/10 border border-red-900/30 p-4 rounded-xl flex flex-col justify-between">
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider bg-red-950/50 border border-red-800/40 px-2 py-0.5 rounded">
                                    Rejected Alternative
                                  </span>
                                  <span className="text-xs font-semibold text-red-400">
                                    {(alt.confidence * 100).toFixed(0)}% Conf
                                  </span>
                                </div>
                                <h4 className="text-sm font-bold text-zinc-200 mb-2">
                                  {alt.name}
                                </h4>
                                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                                  <strong>Reason:</strong> {alt.rejection_reason}
                                </p>
                              </div>
                              <div className="mt-auto border-t border-red-900/20 pt-2.5">
                                <span className="text-[10px] text-zinc-500 block mb-1">Citations</span>
                                <div className="flex flex-wrap gap-1">
                                  {alt.citations.map((citeId, cIdx) => (
                                    <button
                                      key={cIdx}
                                      onClick={() => handleCiteClick(citeId)}
                                      className="bg-red-950/40 border border-red-900/50 hover:bg-red-900/30 text-red-300 text-[10px] font-mono px-2 py-0.5 rounded transition cursor-pointer"
                                    >
                                      [{events.findIndex(e => e.id === citeId) + 1 || "Cite"}]
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Standard Cited Memories Section */}
                    {qaResult.cited_event_ids && qaResult.cited_event_ids.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs uppercase font-bold tracking-wider text-zinc-500">
                          Cited Memories ({qaResult.cited_event_ids.length})
                        </h3>
                        <div className="space-y-2">
                          {qaResult.cited_event_ids.map((citeId, idx) => {
                            const matchedEvent = events.find(e => e.id === citeId);
                            const stepIdx = events.findIndex(e => e.id === citeId) + 1;
                            
                            return (
                              <div 
                                key={idx}
                                onClick={() => handleCiteClick(citeId)}
                                className={`flex items-center justify-between p-3 rounded-lg border transition cursor-pointer group ${
                                  matchedEvent?.retracted
                                    ? "bg-zinc-950/20 border-zinc-900/40 opacity-40"
                                    : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700"
                                }`}
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div className="text-xs font-bold text-zinc-400 bg-zinc-850 px-2 py-0.5 rounded font-mono shrink-0">
                                    {stepIdx ? `Step ${stepIdx}` : `Log`}
                                  </div>
                                  <span className={`text-xs text-zinc-300 font-medium group-hover:text-zinc-100 transition truncate ${matchedEvent?.retracted ? "line-through text-zinc-500" : ""}`}>
                                    {matchedEvent ? matchedEvent.summary : "Recall Node payload"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {!matchedEvent?.retracted && matchedEvent && (
                                    <button
                                      title="Retract this memory"
                                      onClick={(e) => handleRetractMemory(matchedEvent.id, e)}
                                      className="p-1 rounded hover:bg-red-950/40 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                                    >
                                      <EyeOff className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fixed bottom input for Custom / Follow-up Q&A */}
          {activeTab === "ask-why" && selectedEvent && (
            <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur">
              <form onSubmit={handleCustomSubmit} className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-xl focus-within:border-zinc-700 transition overflow-hidden">
                <input
                  type="text"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  placeholder="Ask a custom question about this event..."
                  className="flex-1 bg-transparent px-4 py-3 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={askLoading || !customQuestion.trim()}
                  className="px-4 text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 transition flex items-center gap-1.5 cursor-pointer font-semibold text-xs py-3 bg-zinc-850 border-l border-zinc-800"
                >
                  Ask
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
