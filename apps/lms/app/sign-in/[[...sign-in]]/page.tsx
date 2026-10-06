import { SignIn } from "@clerk/nextjs";
import Waveform from "@/components/session/Waveform";

export default function Page() {
  return (
    <main className="min-h-[calc(100vh-140px)] justify-center">
      <div className="flex items-center gap-16 max-lg:flex-col max-lg:items-stretch max-lg:gap-10">
        <section className="min-w-0 flex-1">
          <p className="meta">converso</p>
          <h1 className="mt-4 max-w-[16ch] text-balance">
            Sign in and start talking.
          </h1>
          <div className="mt-7 max-w-md">
            <Waveform state="listening" />
          </div>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-[var(--ink-dim)]">
            Your companions, your transcripts and your saved code stay attached
            to your account, so a session you leave halfway is still there when
            you come back.
          </p>
        </section>

        <div className="shrink-0 max-lg:self-center">
          <SignIn />
        </div>
      </div>
    </main>
  );
}
