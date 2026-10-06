import { getCompanion } from "@/lib/actions/companion.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getSubjectColor, getSubjectGlow, formatDuration } from "@/lib/utils";
import CompanionComponent from "@/components/CompanionComponent";
import SceneDoor from "@/components/SceneDoor";

interface CompanionSessionPageProps {
  params: Promise<{ id: string }>;
}

const CompanionSession = async ({ params }: CompanionSessionPageProps) => {
  const { id } = await params;
  const companion = await getCompanion(id);
  const user = await currentUser();

  const { name, subject, topic, duration } = companion;

  if (!user) redirect("/sign-in");
  if (!name) redirect("/companions");

  // Law and language are rooms on their own sites. Open those links; do not
  // wait on the session API, which is what was returning 500.
  if (subject === "law" || subject === "language") {
    return <SceneDoor kind={subject} />;
  }

  const glow = getSubjectGlow(subject);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-6 pt-4 lg:px-8">
      {/* Kept to one line on purpose — every pixel spent here is a pixel the
          editor and the transcript do not get. */}
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link
          href="/companions"
          className="btn-icon shrink-0"
          aria-label="Back to all companions"
        >
          <ArrowLeft size={15} />
        </Link>

        <span
          className="grid size-10 shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: getSubjectColor(subject) }}
        >
          <Image src={`/icons/${subject}.svg`} alt="" width={19} height={19} />
        </span>

        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight">{name}</h1>
          <p className="truncate text-sm text-[var(--ink-dim)]">{topic}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="chip" style={{ color: glow, borderColor: glow }}>
            {subject}
          </span>
          <span className="chip">{formatDuration(duration)}</span>
        </div>
      </header>

      <CompanionComponent
        {...companion}
        companionId={id}
        userName={user.firstName!}
        userImage={user.imageUrl!}
      />
    </main>
  );
};

export default CompanionSession;
