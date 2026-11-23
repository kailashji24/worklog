import { useState } from "react";
import { PROJECT_COLORS, type Project } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../context";
import { Icon } from "../icons";

/** Settings card: add, rename, recolour, archive and delete projects. */
export default function ProjectsCard() {
  const { projects, refreshProjects, toast, changed } = useApp();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      await refreshProjects();
      changed();
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const add = () => {
    const n = name.trim();
    if (!n) return;
    run(async () => {
      await api.createProject({ name: n });
      setName("");
    });
  };

  return (
    <section className="card">
      <h3>
        Projects<span>{projects.filter((p) => !p.archived).length} active</span>
      </h3>
      <p className="mute" style={{ marginTop: 0 }}>
        What you're working on, like "Barcode API" or "Traceability DB". Each task gets a project and an area. Archived projects disappear from the
        picker but keep their history in reports.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="wide"
          value={name}
          maxLength={60}
          placeholder="New project name"
          aria-label="New project name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn pri" onClick={add} disabled={!name.trim()}>
          <Icon name="plus" size={16} />
          Add project
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="mute">No projects yet.</p>
      ) : (
        <ul className="plist">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              confirming={confirmDelete === p.id}
              onRename={(n) => run(() => api.updateProject(p.id, { name: n }))}
              onColor={(c) => run(() => api.updateProject(p.id, { color: c }))}
              onArchive={() => run(() => api.updateProject(p.id, { archived: !p.archived }), p.archived ? "Project restored" : "Project archived")}
              onDelete={() => {
                if (confirmDelete !== p.id) return setConfirmDelete(p.id);
                setConfirmDelete(null);
                run(() => api.deleteProject(p.id), "Project deleted. Its tasks are kept without a project.");
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({
  p,
  confirming,
  onRename,
  onColor,
  onArchive,
  onDelete,
}: {
  p: Project;
  confirming: boolean;
  onRename: (n: string) => void;
  onColor: (c: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [val, setVal] = useState(p.name);
  const [pick, setPick] = useState(false);
  return (
    <li className={p.archived ? "archived" : ""}>
      <button className="swatch" style={{ background: p.color }} aria-label={`Change colour of ${p.name}`} onClick={() => setPick(!pick)} />
      <input
        value={val}
        maxLength={60}
        aria-label="Project name"
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => (val.trim() && val.trim() !== p.name ? onRename(val.trim()) : setVal(p.name))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {p.archived && <span className="chip">Archived</span>}
      <button className="btn sm ghost" onClick={onArchive}>
        {p.archived ? "Restore" : "Archive"}
      </button>
      <button className={`btn sm ${confirming ? "danger" : "ghost"}`} onClick={onDelete} aria-label={`Delete ${p.name}`}>
        {confirming ? "Confirm delete" : <Icon name="trash" size={15} />}
      </button>
      {pick && (
        <div className="swatches">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch${c === p.color ? " on" : ""}`}
              style={{ background: c }}
              aria-label={`Use colour ${c}`}
              onClick={() => {
                onColor(c);
                setPick(false);
              }}
            />
          ))}
        </div>
      )}
    </li>
  );
}
