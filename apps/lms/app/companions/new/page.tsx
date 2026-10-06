import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { newCompanionPermissions } from "@/lib/actions/companion.actions";
import CompanionForm from "@/components/CompanionForm";

const NewCompanion = async () => {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const canCreateCompanion = await newCompanionPermissions();

  if (!canCreateCompanion) {
    return (
      <main>
        <div className="companion-limit">
          <span className="cta-badge">plan limit</span>
          <p className="text-xl text-[var(--ink)]">
            You have used every companion on your plan.
          </p>
          <p className="max-w-[46ch] text-sm leading-relaxed text-[var(--ink-dim)]">
            Your existing companions keep working. Upgrading raises the limit so
            you can build more, and unlocks the longer sessions.
          </p>
          <Link href="/subscription" className="btn btn-flame">
            See plans <ArrowUpRight size={14} />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="gap-8">
      <header>
        <Link
          href="/companions"
          className="meta inline-flex items-center gap-1.5 transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={12} /> companions
        </Link>
        <h1 className="mt-3">Build a companion</h1>
        <p className="mt-3 max-w-[54ch] text-[15px] leading-relaxed text-[var(--ink-dim)]">
          A companion is one tutor with one subject and one topic. Keeping the
          topic narrow is what makes the session useful — build several small
          ones rather than one that knows everything.
        </p>
      </header>

      <div className="rule" />

      <CompanionForm />
    </main>
  );
};

export default NewCompanion;
