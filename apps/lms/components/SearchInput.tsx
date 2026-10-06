"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { formUrlQuery, removeKeysFromUrlQuery } from "@jsmastery/utils";

/**
 * Topic search, debounced into the URL.
 *
 * The previous version never returned a cleanup from its effect, so the timer
 * was not cancelled between keystrokes — every character queued its own
 * navigation and typing "algebra" pushed seven history entries and seven
 * queries. The `return () => clearTimeout(...)` below is the entire fix, and it
 * is the reason the field now feels like one search rather than several.
 *
 * It also seeds from the URL, so arriving at /companions?topic=arrays shows
 * "arrays" in the box instead of an empty field over filtered results.
 */
const SearchInput = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = useState(searchParams.get("topic") ?? "");

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = value.trim();
      if (next) {
        router.push(
          formUrlQuery({
            params: searchParams.toString(),
            key: "topic",
            value: next,
          }),
          { scroll: false },
        );
      } else if (pathname === "/companions" && searchParams.has("topic")) {
        router.push(
          removeKeysFromUrlQuery({
            params: searchParams.toString(),
            keysToRemove: ["topic"],
          }),
          { scroll: false },
        );
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [value, router, searchParams, pathname]);

  return (
    <div className="field flex items-center gap-2.5 sm:w-64">
      <Search size={14} className="shrink-0 text-[var(--ink-faint)]" />
      <input
        placeholder="Search by topic"
        aria-label="Search companions by topic"
        className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ink-faint)]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {value && (
        <button
          onClick={() => setValue("")}
          className="shrink-0 text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default SearchInput;
