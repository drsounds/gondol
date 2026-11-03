import { useState } from "react";
import { callAppFunction } from "gondol/api/client";
import "./hello.css";

/** The app's page: asks its own backend function for a greeting. */
export function HelloPage() {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function greet(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const answer = await callAppFunction<{ text: string }>("hello", "greet", { name });
      setGreeting(answer.text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="remote-hello">
      <h1 className="panel-title">Hello from a remote app</h1>
      <form onSubmit={greet} className="remote-hello__form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
        <button type="submit">Greet me</button>
      </form>
      {greeting && <p className="remote-hello__greeting">{greeting}</p>}
      {error && <p className="muted">{error}</p>}
    </section>
  );
}
