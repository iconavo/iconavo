export function App() {
  return (
    <>
      <header className="header">
        <span className="logo">Acme</span>
        <nav className="nav">
          <a href="/">Dashboard</a>
          <a href="/projects">Projects</a>
        </nav>
        <button type="button" className="settings">
          Settings
        </button>
      </header>
      <main>
        <h1>Dashboard</h1>
        <p>Welcome back.</p>
      </main>
    </>
  );
}
