import { CLASSROOM_URL, COURT_CASES, courtroomUrl } from "@/lib/scenes";

/**
 * A law or language companion is a door into a room that lives on its own site.
 * The link is the launch. Nothing is asked of the session API first.
 */
export default function SceneDoor({ kind }: { kind: "law" | "language" }) {
  if (kind === "language") {
    return (
      <main className="scene-launch">
        <div className="panel grid h-full min-h-0 place-items-center p-8">
          <div className="max-w-md text-center">
            <p className="meta">classroom</p>
            <h1 className="mt-3 font-display text-2xl">Language room</h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-dim)]">
              The 3D classroom opens in its own tab.
            </p>
            <a
              href={CLASSROOM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-flame mt-7 inline-flex w-full justify-center"
            >
              Open classroom
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="scene-launch">
      <div className="panel grid h-full min-h-0 place-items-center overflow-auto p-8">
        <div className="w-full max-w-lg">
          <p className="meta text-center">courtroom</p>
          <h1 className="mt-3 text-center font-display text-2xl">Choose a case</h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-[var(--ink-dim)]">
            Both matters open the same 3D courtroom, in a new tab.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            {COURT_CASES.map((matter) => (
              <a
                key={matter.id}
                href={courtroomUrl(matter.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[12px] border border-[var(--edge)] px-4 py-4 transition-colors hover:border-[var(--ink-faint)]"
              >
                <span className="block font-display text-lg text-[var(--ink)]">{matter.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-[var(--ink-dim)]">
                  {matter.detail}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
