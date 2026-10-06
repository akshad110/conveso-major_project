"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Pin, PinOff } from "lucide-react";
import { getSubjectGlow } from "@/lib/utils";
import type { RailMessage } from "@/components/session/SessionRail";

/**
 * The workspace for the subjects that produce notes rather than programs.
 *
 * A voice session has a bad habit: it is excellent while it is happening and
 * gone the moment it ends. This panel is the part you keep. Everything the
 * tutor says arrives here as a card you can pin, your own typing sits beside
 * it, and the whole thing leaves as a markdown file.
 *
 * It deliberately does not try to be clever about what matters. The student
 * decides what to pin, because they are the one who knows what they did not
 * already understand.
 */

interface Props {
  subject: string;
  topic: string;
  companionName: string;
  messages: RailMessage[];
}

const storageKey = (subject: string, topic: string) =>
  `converso:notes:${subject}:${topic}`;

export default function NotesBoard({ subject, topic, companionName, messages }: Props) {
  const [pinned, setPinned] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const glow = getSubjectGlow(subject);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey(subject, topic));
      if (saved) setNotes(saved);
    } catch {
      /* ignore */
    }
  }, [subject, topic]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey(subject, topic), notes);
      } catch {
        /* ignore */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [notes, subject, topic]);

  const said = useMemo(
    () =>
      messages
        .filter((m) => m.role === "assistant" && m.content.trim().length > 12)
        .map((m) => m.content.trim()),
    [messages],
  );

  const toggle = (line: string) =>
    setPinned((p) => (p.includes(line) ? p.filter((x) => x !== line) : [line, ...p]));

  const exportNotes = () => {
    const body = [
      `# ${topic}`,
      ``,
      `${subject} · with ${companionName} · ${new Date().toLocaleDateString()}`,
      ``,
      pinned.length ? `## Kept from the session\n\n${pinned.map((p) => `- ${p}`).join("\n")}` : "",
      notes.trim() ? `\n## My notes\n\n${notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "notes"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--edge)] px-4 py-2.5">
        <span className="meta" style={{ color: glow }}>
          {subject} board
        </span>
        <span className="meta ml-auto">
          {pinned.length} kept · {said.length} said
        </span>
        <button
          onClick={exportNotes}
          className="btn btn-sm btn-ghost"
          disabled={!pinned.length && !notes.trim()}
        >
          <Download size={12} /> Export
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {pinned.length > 0 && (
          <section className="mb-6">
            <p className="meta mb-2">kept</p>
            <div className="flex flex-col gap-2">
              {pinned.map((line) => (
                <article
                  key={line}
                  className="tool flex items-start gap-3 p-3"
                  style={{ borderColor: glow }}
                >
                  <p className="flex-1 text-sm leading-relaxed text-[var(--ink)]">{line}</p>
                  <button
                    onClick={() => toggle(line)}
                    className="btn-icon shrink-0"
                    aria-label="Unpin"
                  >
                    <PinOff size={13} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mb-6">
          <p className="meta mb-2">from the session</p>
          {said.length === 0 ? (
            <p className="text-sm leading-relaxed text-[var(--ink-faint)]">
              Start the session. Everything {companionName.split(" ")[0]} says lands
              here, and you pin the parts worth keeping.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {said
                .filter((line) => !pinned.includes(line))
                .map((line, i) => (
                  <article
                    key={`${i}-${line.slice(0, 24)}`}
                    className="group flex items-start gap-3 rounded-[8px] border border-transparent px-3 py-2 transition-colors hover:border-[var(--edge)] hover:bg-[var(--panel-raised)]"
                  >
                    <p className="flex-1 text-sm leading-relaxed text-[var(--ink-dim)]">
                      {line}
                    </p>
                    <button
                      onClick={() => toggle(line)}
                      className="btn-icon shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Pin this"
                    >
                      <Pin size={13} />
                    </button>
                  </article>
                ))}
            </div>
          )}
        </section>

        <section>
          <p className="meta mb-2">my notes</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write here. It saves as you type and comes back next time."
            className="field h-auto min-h-[9rem] w-full resize-y py-2.5 text-sm leading-relaxed"
          />
        </section>
      </div>
    </div>
  );
}
