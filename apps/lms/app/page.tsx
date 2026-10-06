import Link from "next/link";
import CompanionCard from "@/components/CompanionCard";
import CompanionsList from "@/components/CompanionsList";
import CTA from "@/components/CTA";
import Waveform from "@/components/session/Waveform";
import {
  getAllCompanions,
  getRecentSessions,
} from "@/lib/actions/companion.actions";
import { getSubjectColor } from "@/lib/utils";

const Page = async () => {
  const companions = await getAllCompanions({ limit: 3 });
  const recentSessionsCompanions = await getRecentSessions(10);

  return (
    <main className="flex flex-col gap-14 pb-20 pt-10">
      {/*
        The hero is the product's one sentence, and the waveform sits inside it
        rather than beside it — because the waveform *is* the middle of that
        sentence. Speech goes in on the line above, a document comes out on the
        line below, and the thing between them is the session. No stat blocks,
        no gradient headline, no screenshot of a dashboard.
      */}
      <section className="pt-4">
        <p className="meta">voice sessions</p>

        <h1 className="mt-4 max-w-[26ch] text-balance">
          Say it out loud.
          <span className="mt-1 block text-[var(--ink-faint)]">
            It gets written down.
          </span>
        </h1>

        <div className="mt-7 max-w-xl">
          <Waveform state="listening" />
        </div>

        <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-[var(--ink-dim)]">
          Talk to a tutor that knows your topic. Ask about recursion and a
          working program appears in the editor beside you, in whichever of
          forty-eight languages you are learning. Ask about the Treaty of
          Versailles and the notes build themselves.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/companions" className="btn btn-flame">
            Browse companions
          </Link>
          <Link href="/companions/new" className="btn btn-ghost">
            Build your own
          </Link>
          <a href="https://nexume-ai-x9gr.onrender.com/" className="btn btn-ghost">
            ATS Analyzer
          </a>
        </div>
      </section>

      <div className="rule" />

      <section>
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-2xl">Popular companions</h2>
          <Link
            href="/companions"
            className="meta transition-colors hover:text-[var(--ink)]"
          >
            see all
          </Link>
        </div>

        {companions.length === 0 ? (
          <p className="text-sm text-[var(--ink-dim)]">
            No companions yet.{" "}
            <Link href="/companions/new" className="text-[var(--flame)]">
              Build the first one.
            </Link>
          </p>
        ) : (
          <div className="companions-grid">
            {companions.map((companion) => (
              <CompanionCard
                key={companion.id}
                {...companion}
                color={getSubjectColor(companion.subject)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <CompanionsList
          title="Recent sessions"
          companions={recentSessionsCompanions}
          classNames="flex-1 min-w-0"
          empty="Finish a session and it will show up here."
        />
        <div className="w-[360px] shrink-0 max-lg:w-full">
          <CTA />
        </div>
      </section>
    </main>
  );
};

export default Page;
