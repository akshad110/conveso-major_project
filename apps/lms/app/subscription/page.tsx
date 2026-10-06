import { PricingTable } from "@clerk/nextjs";

const Subscription = () => {
  return (
    <main className="gap-8">
      <header>
        <p className="meta">billing</p>
        <h1 className="mt-3">Plans</h1>
        <p className="mt-3 max-w-[54ch] text-[15px] leading-relaxed text-[var(--ink-dim)]">
          Plans differ in how many companions you can keep and how long a single
          session can run. Everything you have already built stays yours on any
          plan.
        </p>
      </header>

      <div className="rule" />

      <PricingTable />
    </main>
  );
};

export default Subscription;
