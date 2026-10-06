"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { LANGUAGES, LANGUAGE_GROUPS, type LanguageSpec } from "@/constants/languages";

/**
 * The language list, opened as a panel rather than a native <select>.
 *
 * Forty-eight languages in a dropdown is a scroll; forty-eight languages in a
 * searchable panel is a choice. Typing filters, the arrow keys move, Enter
 * picks — because anyone reaching for this is already on the keyboard.
 */

interface Props {
  value: string;
  onSelect: (spec: LanguageSpec) => void;
  onClose: () => void;
}

export default function LanguagePicker({ value, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Grouped for browsing, flat for keyboard movement — the same array in two
  // shapes so the highlight cannot drift out of step with what is on screen.
  const { grouped, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (l: LanguageSpec) =>
      !q ||
      l.label.toLowerCase().includes(q) ||
      l.id.includes(q) ||
      l.ext.includes(q) ||
      (l.piston ?? "").includes(q);

    const g = LANGUAGE_GROUPS.map((name) => ({
      name,
      items: LANGUAGES.filter((l) => l.group === name && match(l)),
    })).filter((s) => s.items.length > 0);

    return { grouped: g, flat: g.flatMap((s) => s.items) };
  }, [query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[cursor]) onSelect(flat[cursor]);
    }
  };

  let index = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <button
        aria-label="Close language picker"
        onClick={onClose}
        className="absolute inset-0 bg-[#070610]/80 cursor-default"
      />

      <div className="panel relative w-full max-w-xl overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-[var(--edge)] px-4">
          <Search size={15} className="shrink-0 text-[var(--ink-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 48 languages"
            className="h-12 w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div ref={listRef} className="no-scrollbar max-h-[52vh] overflow-y-auto p-2">
          {grouped.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-[var(--ink-dim)]">
              Nothing matches “{query}”.
            </p>
          )}

          {grouped.map((section) => (
            <div key={section.name} className="mb-1">
              <p className="meta px-3 pb-1 pt-3">{section.name}</p>
              {section.items.map((lang) => {
                index += 1;
                const active = index === cursor;
                const chosen = lang.id === value;
                return (
                  <button
                    key={lang.id}
                    data-cursor={active}
                    onMouseEnter={() => setCursor(flat.indexOf(lang))}
                    onClick={() => onSelect(lang)}
                    className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left transition-colors ${
                      active ? "bg-[var(--panel-raised)]" : ""
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm text-[var(--ink)]">
                        {lang.label}
                      </span>
                      {lang.note && (
                        <span className="block truncate text-xs text-[var(--ink-faint)]">
                          {lang.note}
                        </span>
                      )}
                    </span>

                    {!lang.piston && lang.id !== "html" && (
                      <span className="meta text-[var(--ink-faint)]">editor only</span>
                    )}
                    <span className="chip shrink-0">.{lang.ext}</span>
                    {chosen && <Check size={14} className="shrink-0 text-[var(--flame)]" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--edge)] px-4 py-2.5">
          <span className="meta">↑↓ move</span>
          <span className="meta">↵ select</span>
          <span className="meta">esc close</span>
        </div>
      </div>
    </div>
  );
}
