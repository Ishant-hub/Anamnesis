"use client";

import React, { useEffect, useState } from "react";
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
  Sparkles
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
  occurred_at: string;
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

  useEffect(() => {
    fetchEvents();
  }, []);

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

  const getConfidenceBadgeColor = (conf: number | undefined) => {
    if (conf === undefined || conf === null) return "bg-zinc-800 text-zinc-400";
    if (conf >= 0.8) return "bg-zinc-800 text-zinc-300 border border-zinc-700";
    if (conf >= 0.5) return "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30";
    return "bg-red-500/20 text-red-500 border border-red-500/30";
  };

  const formatTime = (timeStr: string) => {
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Sidebar / Left Panel: Timeline */}
      <div className="w-[55%] border-r border-zinc-800 flex flex-col h-full bg-zinc-950">
        <header className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Anamnesis Timeline
            </h1>
          </div>
          <button 
            onClick={fetchEvents}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 transition cursor-pointer"
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
            <div className="relative border-l border-zinc-855 ml-4 pl-6 space-y-6">
              {events.map((event) => {
                const IconComponent = iconMap[event.event_type] || HelpCircle;
                const isContradiction = event.contradiction_flag;
                const isError = event.event_type === "error";
                const isSelected = selectedEventId === event.id;

                return (
                  <div 
                    key={event.id}
                    className={`relative p-4 rounded-xl border transition-all ${
                      isSelected 
                        ? "bg-zinc-900 border-zinc-700 shadow-md shadow-black/40"
                        : "bg-zinc-900/30 border-zinc-900/80 hover:bg-zinc-900/60 hover:border-zinc-800"
                    }`}
                  >
                    {/* Time Dot / Icon */}
                    <div className={`absolute -left-[37px] top-4 w-6 h-6 rounded-full flex items-center justify-center text-xs border ${
                      isError 
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
                          <span className="text-zinc-650">•</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-850">
                            {event.event_type.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-zinc-200 text-sm font-medium leading-relaxed">
                          {event.summary}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {event.confidence !== undefined && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${getConfidenceBadgeColor(event.confidence)}`}>
                            {event.confidence.toFixed(2)}
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
                        onClick={() => setSelectedEventId(event.id)}
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
        <header className="px-6 py-5 border-b border-zinc-800 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-zinc-400" />
          <h2 className="text-xl font-bold tracking-tight text-zinc-100">
            Ask Why (Memory Blame)
          </h2>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 overflow-y-auto">
          {selectedEvent ? (
            <div className="w-full max-w-lg bg-zinc-900/30 border border-zinc-800/60 p-6 rounded-xl space-y-4 text-left">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Selected Event Details
              </h3>
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-zinc-500 block">Event Summary</span>
                  <p className="text-zinc-200 text-sm font-medium leading-relaxed">{selectedEvent.summary}</p>
                </div>
                <div>
                  <span className="text-xs text-zinc-500 block font-mono">Type / ID</span>
                  <span className="text-xs text-zinc-300 font-mono">{selectedEvent.event_type} ({selectedEvent.id})</span>
                </div>
                {selectedEvent.chosen_option && (
                  <div>
                    <span className="text-xs text-zinc-500 block">Chosen Option</span>
                    <p className="text-zinc-200 text-sm font-medium">{selectedEvent.chosen_option}</p>
                  </div>
                )}
                {selectedEvent.rejected_alternatives && selectedEvent.rejected_alternatives.length > 0 && (
                  <div>
                    <span className="text-xs text-zinc-500 block mb-1">Rejected Alternatives</span>
                    <ul className="space-y-2 mt-1">
                      {selectedEvent.rejected_alternatives.map((alt, i) => (
                        <li key={i} className="text-xs text-red-400 bg-red-950/20 border border-red-900/40 p-3 rounded-lg">
                          <div className="flex items-center justify-between font-bold text-red-300">
                            <span>{alt.name}</span>
                            <span>{alt.confidence.toFixed(2)}</span>
                          </div>
                          <p className="text-zinc-400 mt-1.5 leading-relaxed">{alt.rejection_reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-zinc-800/60 text-zinc-400 text-xs flex items-center gap-1.5 justify-center">
                <HelpCircle className="w-3.5 h-3.5 text-zinc-500" />
                Ask Why queries will be wired in Prompt 3.
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-sm">
              <HelpCircle className="w-12 h-12 text-zinc-700 mx-auto animate-pulse" />
              <p className="text-sm text-zinc-400 font-medium">
                No event selected
              </p>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Click the <strong>Why?</strong> button on any timeline event in the left panel to blame memories or inspect decisions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
