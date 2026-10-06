"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { subjects } from "@/constants";
import { getSubjectGlow } from "@/lib/utils";
import { formUrlQuery, removeKeysFromUrlQuery } from "@jsmastery/utils";

/**
 * Subject filter, as pills rather than a dropdown.
 *
 * There are seven subjects and there will always be seven subjects. Hiding a
 * closed set that small behind a <Select> costs a click to see options that
 * would have fitted on the line, and it throws away the one thing that makes
 * them scannable — each subject has a colour, and here you can see all seven at
 * once.
 *
 * Navigating on click rather than in an effect also fixes a real bug: the old
 * version pushed a URL on mount with an empty subject, so every visit to the
 * library rewrote the address bar to "?subject=" before the user touched
 * anything.
 */
const SubjectFilter = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.get("subject") ?? "";

  const choose = (subject: string) => {
    const url =
      subject === active || subject === "all"
        ? removeKeysFromUrlQuery({
            params: searchParams.toString(),
            keysToRemove: ["subject"],
          })
        : formUrlQuery({
            params: searchParams.toString(),
            key: "subject",
            value: subject,
          });
    router.push(url, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => choose("all")}
        data-active={!active ? "true" : undefined}
        className="rounded-full border border-[var(--edge)] px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] transition-colors hover:border-[var(--edge-hot)] hover:text-[var(--ink)] data-[active=true]:border-[var(--ink-dim)] data-[active=true]:text-[var(--ink)]"
      >
        all
      </button>

      {subjects.map((subject) => {
        const on = active === subject;
        const glow = getSubjectGlow(subject);
        return (
          <button
            key={subject}
            onClick={() => choose(subject)}
            aria-pressed={on}
            className="rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors"
            style={{
              borderColor: on ? glow : "var(--edge)",
              color: on ? glow : "var(--ink-faint)",
              backgroundColor: on ? "var(--panel-raised)" : "transparent",
            }}
          >
            {subject}
          </button>
        );
      })}
    </div>
  );
};

export default SubjectFilter;
