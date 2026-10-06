import Link from "next/link";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import NavItems from "@/components/NavItems";

/**
 * The logo is set rather than placed.
 *
 * /public/images/logo.svg is a raster image wrapped in an SVG pattern, drawn
 * for a white page. On this ground it either disappears or carries a pale box
 * around itself, and neither is acceptable at the top of every screen. A
 * wordmark in the display face costs nothing, scales perfectly, and inherits
 * the palette — and the original file is still in the repo if it gets redrawn
 * for dark later.
 */
const Navbar = () => {
  return (
    <nav className="navbar">
      <Link href="/" className="group flex items-center gap-2.5">
        <span className="relative grid size-8 place-items-center rounded-[9px] bg-[var(--flame)]">
          <span className="block size-2 rounded-full bg-[#180c08]" />
        </span>
        <span className="font-display text-[19px] font-bold tracking-[-0.03em] text-[var(--ink)]">
          Converso
        </span>
      </Link>

      <div className="flex items-center gap-3 sm:gap-6">
        <NavItems />

        <SignedOut>
          <SignInButton>
            <button className="btn-signin">Sign in</button>
          </SignInButton>
        </SignedOut>

        <SignedIn>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-8 rounded-full border border-[var(--edge-lit)]",
              },
            }}
          />
        </SignedIn>
      </div>
    </nav>
  );
};

export default Navbar;
