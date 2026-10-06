"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { subjects, voices } from "@/constants";
import { getSubjectColor, getSubjectGlow, formatDuration } from "@/lib/utils";
import { createCompanion } from "@/lib/actions/companion.actions";

/**
 * The companion builder.
 *
 * The original was five stacked dropdowns. Four of those five fields are closed
 * sets of two to seven options — a dropdown hides a list that would have fitted
 * on one line, and costs a click to reveal what could simply have been shown.
 * So: subjects are pills in their own colour, voice and style are segmented
 * switches, duration is a set of common lengths with a free field for anything
 * else. Nothing here is hidden behind a click.
 *
 * The panel on the right is the card this form is actually producing. It is not
 * decoration — it is the same markup the library renders, so what you see while
 * building is what appears when you are done.
 */

const DURATIONS = [10, 15, 20, 30, 45, 60];
const STYLES = [
  { id: "formal", label: "Formal", note: "structured, precise, exam-shaped" },
  { id: "casual", label: "Casual", note: "conversational, asks you questions back" },
];

type Errors = Partial<Record<"name" | "subject" | "topic" | "duration", string>>;

const CompanionForm = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [voice, setVoice] = useState("female");
  const [style, setStyle] = useState("casual");
  const [duration, setDuration] = useState(15);

  const glow = subject ? getSubjectGlow(subject) : "var(--edge-hot)";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailed(null);

    const next: Errors = {};
    if (!name.trim()) next.name = "Give it a name.";
    if (!subject) next.subject = "Pick a subject.";
    if (!topic.trim()) next.topic = "Say what it should teach.";
    if (!duration || duration < 1) next.duration = "At least one minute.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    startTransition(async () => {
      try {
        const companion = await createCompanion({
          name: name.trim(),
          subject,
          topic: topic.trim(),
          voice,
          style,
          duration: Number(duration),
        });
        if (companion?.id) router.push(`/companions/${companion.id}`);
        else setFailed("The companion could not be saved. Try again.");
      } catch {
        setFailed("The companion could not be saved. Try again.");
      }
    });
  };

  return (
    <div className="flex items-start gap-8 max-lg:flex-col">
      <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col gap-8">
        {/* name ------------------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <label htmlFor="name" className="meta">
            name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Neura the Brainy Explorer"
            className="field h-auto w-full py-3 text-[15px] outline-none placeholder:text-[var(--ink-faint)]"
          />
          {errors.name && <p className="text-xs text-[var(--bad)]">{errors.name}</p>}
        </div>

        {/* subject ---------------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <span className="meta">subject</span>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((s) => {
              const on = subject === s;
              const c = getSubjectGlow(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  aria-pressed={on}
                  className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors"
                  style={{
                    borderColor: on ? c : "var(--edge)",
                    color: on ? c : "var(--ink-faint)",
                    backgroundColor: on ? "var(--panel-raised)" : "transparent",
                  }}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: on ? c : "var(--edge-hot)" }}
                  />
                  {s}
                </button>
              );
            })}
          </div>
          {errors.subject && (
            <p className="text-xs text-[var(--bad)]">{errors.subject}</p>
          )}
        </div>

        {/* topic ------------------------------------------------------ */}
        <div className="flex flex-col gap-2.5">
          <label htmlFor="topic" className="meta">
            what it teaches
          </label>
          <textarea
            id="topic"
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Recursion and how a call stack unwinds"
            className="field h-auto w-full resize-none py-3 text-[15px] leading-relaxed outline-none placeholder:text-[var(--ink-faint)]"
          />
          <p className="text-xs text-[var(--ink-faint)]">
            One topic, said plainly. The companion opens the session on this and
            stays near it.
          </p>
          {errors.topic && <p className="text-xs text-[var(--bad)]">{errors.topic}</p>}
        </div>

        {/* voice ------------------------------------------------------ */}
        <div className="flex flex-col gap-2.5">
          <span className="meta">voice</span>
          <div className="flex gap-1.5">
            {Object.keys(voices).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVoice(v)}
                aria-pressed={voice === v}
                data-active={voice === v ? "true" : undefined}
                className="flex-1 rounded-[var(--radius-tool)] border border-[var(--edge)] px-4 py-2.5 text-sm capitalize text-[var(--ink-faint)] transition-colors hover:border-[var(--edge-hot)] data-[active=true]:border-[var(--edge-hot)] data-[active=true]:bg-[var(--panel-raised)] data-[active=true]:text-[var(--ink)]"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* style ------------------------------------------------------ */}
        <div className="flex flex-col gap-2.5">
          <span className="meta">style</span>
          <div className="flex gap-1.5 max-sm:flex-col">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyle(s.id)}
                aria-pressed={style === s.id}
                data-active={style === s.id ? "true" : undefined}
                className="flex-1 rounded-[var(--radius-tool)] border border-[var(--edge)] px-4 py-3 text-left transition-colors hover:border-[var(--edge-hot)] data-[active=true]:border-[var(--edge-hot)] data-[active=true]:bg-[var(--panel-raised)]"
              >
                <span className="block text-sm text-[var(--ink)]">{s.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                  {s.note}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* duration --------------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <span className="meta">length</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                aria-pressed={duration === d}
                data-active={duration === d ? "true" : undefined}
                className="rounded-full border border-[var(--edge)] px-3 py-1.5 font-mono text-[11px] text-[var(--ink-faint)] transition-colors hover:border-[var(--edge-hot)] data-[active=true]:border-[var(--ink-dim)] data-[active=true]:text-[var(--ink)]"
              >
                {d}m
              </button>
            ))}
            <input
              type="number"
              min={1}
              aria-label="Custom length in minutes"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="field h-auto w-20 py-1.5 text-center font-mono text-[11px] outline-none"
            />
          </div>
          {errors.duration && (
            <p className="text-xs text-[var(--bad)]">{errors.duration}</p>
          )}
        </div>

        <div className="rule" />

        {failed && <p className="text-sm text-[var(--bad)]">{failed}</p>}

        <button type="submit" disabled={pending} className="btn btn-flame w-full">
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Building
            </>
          ) : (
            "Build companion"
          )}
        </button>
      </form>

      {/* live preview ------------------------------------------------- */}
      <aside className="w-[320px] shrink-0 max-lg:w-full lg:sticky lg:top-8">
        <p className="meta mb-3">preview</p>
        <div
          className="companion-card"
          style={{ ["--subject-lit" as string]: glow }}
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className="flex size-[42px] shrink-0 items-center justify-center rounded-[10px]"
              style={{
                backgroundColor: subject ? getSubjectColor(subject) : "var(--panel-raised)",
              }}
            >
              {subject && (
                <Image
                  src={`/icons/${subject}.svg`}
                  alt={subject}
                  width={20}
                  height={20}
                />
              )}
            </div>
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
              style={{ color: glow }}
            >
              {subject || "subject"}
            </span>
          </div>

          <div>
            <p className="text-lg leading-snug text-[var(--ink)]">
              {name.trim() || "Untitled companion"}
            </p>
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ink-dim)]">
              {topic.trim() || "No topic yet."}
            </p>
          </div>

          <p className="meta mt-auto">
            {formatDuration(duration || 0)} · {voice} · {style}
          </p>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[var(--ink-faint)]">
          {subject === "coding"
            ? "Coding companions open with a live editor beside the transcript."
            : subject === "language" || subject === "law"
              ? "This subject opens in a 3D scene beside the transcript."
              : "This companion opens with a notes board beside the transcript."}
        </p>
      </aside>
    </div>
  );
};

export default CompanionForm;
