"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Mic, MicOff, PhoneOff, Send } from "lucide-react";
import Waveform from "./Waveform";
import { getSubjectColor, getSubjectGlow } from "@/lib/utils";

/**
 * The conversation column.
 *
 * It sits beside the workspace and holds everything that is *said*: who is
 * talking, what has been said so far, and the two controls that matter —
 * the microphone and the way out. The typed composer underneath is not a
 * second-class chat; it is how you ask for code without talking over the
 * tutor, which in a shared room or a library is most of the time.
 */

export interface RailMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Props {
  name: string;
  subject: string;
  topic: string;
  userName: string;
  userImage: string;
  status: "idle" | "connecting" | "live" | "ended";
  speaking: boolean;
  muted: boolean;
  messages: RailMessage[];
  thinking?: boolean;
  /** Only the coding companion takes typed prompts that produce code. */
  composerHint?: string;
  onStart: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onSend: (text: string) => void;
}

export default function SessionRail({
  name,
  subject,
  topic,
  userName,
  userImage,
  status,
  speaking,
  muted,
  messages,
  thinking = false,
  composerHint = "Ask a question",
  onStart,
  onEnd,
  onToggleMic,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const glow = getSubjectGlow(subject);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);

  const waveState =
    status === "connecting"
      ? "connecting"
      : status === "live"
        ? speaking
          ? "speaking"
          : "listening"
        : "idle";

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <aside className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      {/* who */}
      <header className="shrink-0 border-b border-[var(--edge)] p-4">
        <div className="flex items-center gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-[12px]"
            style={{ backgroundColor: getSubjectColor(subject) }}
          >
            <Image
              src={`/icons/${subject}.svg`}
              alt=""
              width={20}
              height={20}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[15px] leading-tight text-[var(--ink)]">
              {name}
            </p>
            <p className="meta truncate" style={{ color: glow }}>
              {subject}
            </p>
          </div>

          {userImage && (
            <Image
              src={userImage}
              alt={userName}
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-full border border-[var(--edge-lit)] object-cover"
            />
          )}
        </div>

        <p className="mt-3 line-clamp-2 text-sm text-[var(--ink-dim)]">{topic}</p>

        <div className="mt-4">
          <Waveform state={waveState} />
          <p className="meta mt-2">
            {status === "idle" && "not connected"}
            {status === "connecting" && "connecting…"}
            {status === "live" && (speaking ? `${name.split(" ")[0]} is speaking` : "listening")}
            {status === "ended" && "session ended"}
          </p>
        </div>
      </header>

      {/* said */}
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !thinking && (
          <p className="mt-6 text-sm leading-relaxed text-[var(--ink-faint)]">
            {status === "live"
              ? "Say something, or type below."
              : "Start the session and the conversation appears here."}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`bubble ${m.role === "user" ? "bubble-you" : "bubble-them"}`}
            >
              <p className="meta mb-1.5" style={m.role === "assistant" ? { color: glow } : undefined}>
                {m.role === "user" ? userName.split(" ")[0] : name.split(" ")[0]}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
            </div>
          ))}

          {thinking && (
            <div className="bubble bubble-them flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-[var(--ink-faint)]" />
              <span className="meta">writing code…</span>
            </div>
          )}
        </div>
      </div>

      {/* say */}
      <div className="shrink-0 border-t border-[var(--edge)] p-3">
        <div className="field flex h-auto items-end gap-2 py-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={composerHint}
            className="max-h-28 min-h-[1.5rem] w-full resize-none bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="btn-icon shrink-0 disabled:opacity-35"
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          {status === "live" ? (
            <>
              <button onClick={onToggleMic} className="btn btn-sm btn-ghost flex-1">
                {muted ? <MicOff size={13} /> : <Mic size={13} />}
                {muted ? "Unmute" : "Mute"}
              </button>
              <button onClick={onEnd} className="btn btn-sm flex-1 border-[var(--bad)] text-[var(--bad)]">
                <PhoneOff size={13} /> End
              </button>
            </>
          ) : (
            <button
              onClick={onStart}
              disabled={status === "connecting"}
              className="btn btn-flame w-full"
            >
              {status === "connecting" ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Connecting
                </>
              ) : status === "ended" ? (
                "Start again"
              ) : (
                "Start session"
              )}
            </button>
          )}
        </div>

        <p className="meta mt-2 text-center">
          {status === "live"
            ? "your mic is open"
            : "voice runs in the browser — no install"}
        </p>
      </div>
    </aside>
  );
}
