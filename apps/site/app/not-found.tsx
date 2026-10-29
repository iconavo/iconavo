import Link from "next/link";

export default function NotFound() {
  return (
    <main id="content" className="container home">
      <h1>Page not found</h1>
      <p>
        There is no page at this address.{" "}
        <Link href="/docs">Go to the docs</Link>
      </p>
    </main>
  );
}
