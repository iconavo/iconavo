"use client";

import "@iconavo-ui/icon";
import { addIcons, Icon } from "@iconavo-ui/react";
import { useState } from "react";
import "./iconavo";
import names from "./icons.json";

// Your own icon, added at the top level of a Client Component module: it appears right after
// hydration. Never call addIcons during rendering: on the server, memory is shared by all requests.
addIcons({
  prefix: "acme",
  width: 24,
  height: 24,
  icons: {
    logo: { body: '<path fill="currentColor" d="M4 4h16v16H4z"/>' },
  },
});

export function Client() {
  const [shown, setShown] = useState(false);
  const [red, setRed] = useState(false);
  return (
    <>
      <section data-check="client">
        <h2>Client Component</h2>
        <div className="row">
          <button
            type="button"
            data-check="toggle"
            onClick={() => setShown(!shown)}
          >
            {shown ? "Hide" : "Show"} icons
          </button>
          {shown &&
            names.toggle.map((name) => (
              <Icon key={name} icon={name} width={32} data-name={name} />
            ))}
        </div>
        <div className="row">
          <button type="button" onClick={() => setRed(!red)}>
            Change color
          </button>
          <Icon
            icon="lucide:palette"
            width={32}
            color={red ? "crimson" : undefined}
            data-name="lucide:palette"
          />
        </div>
      </section>

      <section>
        <h2>Your own icons</h2>
        <div className="row">
          <Icon icon="acme:logo" width={32} data-name="acme:logo" />
        </div>
      </section>

      <section data-check="tag">
        <h2>The tag in React</h2>
        <p>
          The tag reads the shared icon store, not <code>IconavoProvider</code>,
          so it loads its icons in the browser.
        </p>
        <div className="row">
          <iconavo-icon icon={names.tag} width="32" />
          <iconavo-icon icon={names.missingTag} width="32" />
        </div>
      </section>

      <section data-check="missing">
        <h2>A missing icon</h2>
        <p>
          In development, a dashed frame marks a name that does not exist, and
          the console shows one warning.
        </p>
        <div className="row">
          <Icon icon={names.missing} width={32} data-name={names.missing} />
        </div>
      </section>
    </>
  );
}
