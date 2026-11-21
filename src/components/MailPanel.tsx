import { useEffect, useRef, useState } from "react";
import type { Draft } from "../../shared/report";
import { api } from "../api";
import { copyText, useApp } from "../context";
import { Icon } from "../icons";

const CLIENT_LABEL = { gmail: "Open in Gmail", outlook: "Open in Outlook", app: "Open in mail app" } as const;

export default function MailPanel({ title, sub, draft, draftKey, kind }: { title: string; sub: string; draft: Draft; draftKey: string; kind: "day" | "week" | "month" }) {
  const { settings, toast } = useApp();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastKey = useRef(draftKey);

  // Follow the tasks until you edit the text; switching day/period always resets.
  useEffect(() => {
    if (lastKey.current !== draftKey) {
      lastKey.current = draftKey;
      setDirty(false);
    } else if (dirty) return;
    setSubject(draft.subject);
    setBody(draft.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.subject, draft.body, draftKey]);

  const E = encodeURIComponent;
  const href =
    settings.client === "outlook"
      ? `https://outlook.office.com/mail/deeplink/compose?to=${E(settings.to)}&cc=${E(settings.cc)}&subject=${E(subject)}&body=${E(body)}`
      : settings.client === "app"
        ? `mailto:${settings.to.replace(/\s/g, "")}?cc=${E(settings.cc)}&subject=${E(subject)}&body=${E(body)}`
        : `https://mail.google.com/mail/?view=cm&fs=1&to=${E(settings.to)}&cc=${E(settings.cc)}&su=${E(subject)}&body=${E(body)}`;

  const polish = async () => {
    setBusy(true);
    try {
      setBody(await api.polish(body, kind));
      setDirty(true);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="card mail">
      <h3>
        {title}
        <span>{sub}</span>
      </h3>
      <p className="to">
        {settings.to ? (
          <>
            To: {settings.to}
            {settings.cc && ` · Cc: ${settings.cc}`}
          </>
        ) : (
          <a className="link" href="#settings">
            + Add who receives your updates in Settings
          </a>
        )}
      </p>
      <label className="lb">
        Subject
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <label className="lb">
        Message
        <textarea
          rows={16}
          value={body}
          placeholder="Add tasks and your update email writes itself here."
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <div className="mb">
        <a className="btn pri" href={href} target={settings.client === "app" ? undefined : "_blank"} rel="noopener">
          <Icon name="mail" size={16} />
          {CLIENT_LABEL[settings.client]}
        </a>
        <button className="btn" onClick={async () => toast((await copyText(body)) ? "Message copied" : "Couldn't copy — select the text and press Ctrl+C")}>
          <Icon name="copy" size={16} />
          Copy
        </button>
        <button className="btn" onClick={polish} disabled={busy || !body.trim()}>
          <Icon name="spark" size={16} />
          {busy ? "Writing…" : "Polish with AI"}
        </button>
      </div>
      {dirty && (
        <button
          className="link"
          onClick={() => {
            setDirty(false);
            setSubject(draft.subject);
            setBody(draft.body);
          }}
        >
          Rebuild from tasks (drops your edits)
        </button>
      )}
      <p className="fine">Opens a draft in your own mail; nothing is sent automatically.</p>
    </aside>
  );
}
