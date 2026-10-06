"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: { label: string; href: string; external?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Companions", href: "/companions" },
  // Was 'my-journey' with no leading slash, which resolved relative to whatever
  // page you happened to be on — from /companions/abc it went looking for
  // /companions/my-journey and 404'd.
  { label: "My Journey", href: "/my-journey" },
  { label: "ATS Analyzer", href: "https://nexume-ai-x9gr.onrender.com/", external: true },
];

const NavItems = () => {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {navItems.map(({ label, href, external }) =>
        external ? (
          <a key={label} href={href} className="nav-link">
            {label}
          </a>
        ) : (
          <Link
            href={href}
            key={label}
            className="nav-link"
            data-active={pathname === href ? "true" : undefined}
          >
            {label}
          </Link>
        ),
      )}
    </nav>
  );
};

export default NavItems;
