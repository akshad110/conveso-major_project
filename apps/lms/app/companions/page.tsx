import Link from "next/link";
import { Plus } from "lucide-react";
import { getAllCompanions } from "@/lib/actions/companion.actions";
import CompanionCard from "@/components/CompanionCard";
import SearchInput from "@/components/SearchInput";
import SubjectFilter from "@/components/SubjectFilter";
import { getSubjectColor } from "@/lib/utils";

const CompanionsLibrary = async ({ searchParams }: SearchParams) => {
  const filters = await searchParams;
  const subject = filters.subject ? filters.subject : "";
  const topic = filters.topic ? filters.topic : "";

  const companions = await getAllCompanions({ subject, topic });
  const filtered = Boolean(subject || topic);

  return (
    <main className="gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="meta">library</p>
          <h1 className="mt-2">Companions</h1>
        </div>
        <SearchInput />
      </header>

      <SubjectFilter />

      <div className="rule" />

      {companions.length === 0 ? (
        <div className="companion-limit">
          <p className="text-lg text-[var(--ink)]">
            {filtered ? "Nothing matches that." : "No companions yet."}
          </p>
          <p className="max-w-[44ch] text-sm leading-relaxed text-[var(--ink-dim)]">
            {filtered
              ? "Try a different subject, or clear the search to see everything."
              : "A companion is a tutor with a subject, a topic and a voice. Make one and it is ready to talk."}
          </p>
          {filtered ? (
            <Link href="/companions" className="btn btn-ghost">
              Clear filters
            </Link>
          ) : (
            <Link href="/companions/new" className="btn btn-flame">
              <Plus size={14} /> Build a companion
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="meta">
            {companions.length} {companions.length === 1 ? "companion" : "companions"}
            {subject ? ` · ${subject}` : ""}
            {topic ? ` · “${topic}”` : ""}
          </p>

          <section className="companions-grid">
            {companions.map((companion) => (
              <CompanionCard
                key={companion.id}
                {...companion}
                color={getSubjectColor(companion.subject)}
              />
            ))}
          </section>
        </>
      )}
    </main>
  );
};

export default CompanionsLibrary;
