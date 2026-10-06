import { getCompanion } from "@/lib/actions/companion.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getSubjectColor, getSubjectGlow, formatDuration } from "@/lib/utils";
import CompanionComponent from "@/components/CompanionComponent";
import SpatialStage from "@/components/workspace/SpatialStage";

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

  // Law and language are rooms, not documents. The click on the companion is
  // the launch: the 3D scene fills the page and starts on its own.
  if (subject === "law" || subject === "language") {
    const isLaw = subject === "law";
    return (
      <main className="scene-launch">
        <SpatialStage
          autoStart
          subject={subject}
          title={isLaw ? "courtroom" : "classroom"}
          description={
            isLaw
              ? "The hearing itself — bench, box and counsel — opening in this page."
              : "The language classroom. The room opens here; spoken answers need a model only if you ask the teacher."
          }
          envVar={isLaw ? "NEXT_PUBLIC_COURTROOM_URL" : "NEXT_PUBLIC_LANGUAGE_SCENE_URL"}
          src={
            isLaw
              ? process.env.NEXT_PUBLIC_COURTROOM_URL
              : process.env.NEXT_PUBLIC_LANGUAGE_SCENE_URL
          }
          caption={topic}
          companionId={id}
          seats={isLaw}
        />
      </main>
    );
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
