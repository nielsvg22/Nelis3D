import Link from "next/link";
import { Icon } from "./ui";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b hairline bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-white"><Icon name="cube" className="size-4" /></span>
          Nelis3D
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/projects" className="rounded-full px-3 py-2.5 text-ink-2 transition hover:bg-black/5 hover:text-ink">Projects</Link>
          <Link href="/new" className="rounded-full bg-ink px-4 py-2.5 font-medium text-white transition hover:bg-black/85">New</Link>
        </nav>
      </div>
    </header>
  );
}
