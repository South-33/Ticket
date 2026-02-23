"use client";

import { SignInButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { hasConfiguredClerk } from "@/lib/clerk-env";

type PlaybookId = Id<"playbooks">;

const PLAYBOOK_KIND_OPTIONS = ["general", "flights", "train", "concert", "flights_grey_tactics"] as const;
const PLAYBOOK_STATUS_OPTIONS = ["draft", "active", "archived"] as const;
const PLAYBOOK_SCOPE_OPTIONS = ["always", "conditional", "opt_in"] as const;
const PLAYBOOK_RISK_OPTIONS = ["safe", "grey"] as const;

export function PlaybookAdmin() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const hasClerk = hasConfiguredClerk();

  const [selectedPlaybookId, setSelectedPlaybookId] = useState<PlaybookId | null>(null);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<(typeof PLAYBOOK_KIND_OPTIONS)[number]>("general");
  const [scope, setScope] = useState<(typeof PLAYBOOK_SCOPE_OPTIONS)[number]>("always");
  const [riskClass, setRiskClass] = useState<(typeof PLAYBOOK_RISK_OPTIONS)[number]>("safe");
  const [status, setStatus] = useState<(typeof PLAYBOOK_STATUS_OPTIONS)[number]>("active");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [sourceFile, setSourceFile] = useState("");

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upsertPlaybook = useMutation(api.playbooks.upsertPlaybook);

  const playbooksResult = useQuery(api.playbooks.listPlaybooks, {
    paginationOpts: {
      numItems: 50,
      cursor: null,
    },
  });

  const playbooks = useMemo(() => playbooksResult?.page ?? [], [playbooksResult]);

  const effectiveSelectedPlaybookId = useMemo(() => {
    if (playbooks.length === 0) {
      return null;
    }
    if (selectedPlaybookId && playbooks.some((playbook) => playbook._id === selectedPlaybookId)) {
      return selectedPlaybookId;
    }
    return playbooks[0]?._id ?? null;
  }, [playbooks, selectedPlaybookId]);

  function loadPlaybook(playbookId: PlaybookId) {
    const selected = playbooks.find((playbook) => playbook._id === playbookId);
    if (!selected) {
      return;
    }
    setSelectedPlaybookId(playbookId);
    setSlug(selected.slug);
    setTitle(selected.title);
    setDescription(selected.description ?? "");
    setKind(selected.kind);
    setScope(selected.scope);
    setRiskClass(selected.riskClass);
    setStatus(selected.status);
    setContentMarkdown(selected.contentMarkdown);
    setSourceFile(selected.sourceFile ?? "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const playbookId = await upsertPlaybook({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
        scope,
        riskClass,
        status,
        contentMarkdown,
        sourceFile: sourceFile.trim() || undefined,
      });
      setSelectedPlaybookId(playbookId);
      setNotice("Playbook saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function resetDraft() {
    setSelectedPlaybookId(null);
    setSlug("");
    setTitle("");
    setDescription("");
    setKind("general");
    setScope("always");
    setRiskClass("safe");
    setStatus("active");
    setContentMarkdown("");
    setSourceFile("");
  }

  if (isLoading) {
    return <div className="knowledge-admin-state">Loading auth session...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="knowledge-admin-state">
        <h2>Sign In Required</h2>
        <p>You must authenticate to open playbook curation tools.</p>
        {hasClerk ? (
          <SignInButton mode="modal">
            <button className="knowledge-btn" type="button">
              Sign In
            </button>
          </SignInButton>
        ) : (
          <p>Set Clerk environment keys to enable sign-in.</p>
        )}
      </div>
    );
  }

  return (
    <div className="knowledge-admin-page">
      <header className="knowledge-admin-header">
        <div>
          <p className="knowledge-kicker">Playbook Curation</p>
          <h1>Playbook Admin</h1>
        </div>
        <button className="knowledge-btn" type="button" onClick={resetDraft}>
          New Playbook
        </button>
      </header>

      {notice && <p className="knowledge-notice">{notice}</p>}
      {error && <p className="knowledge-error">{error}</p>}

      <section className="knowledge-panel">
        <h2>Playbooks</h2>
        <div className="knowledge-doc-grid">
          {playbooks.map((playbook) => (
            <button
              key={playbook._id}
              className={`knowledge-doc-row ${effectiveSelectedPlaybookId === playbook._id ? "active" : ""}`}
              onClick={() => loadPlaybook(playbook._id)}
              type="button"
            >
              <div>
                <strong>{playbook.slug}</strong>
                <p>{playbook.title}</p>
              </div>
              <span>{playbook.status}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="knowledge-panel">
        <h2>{effectiveSelectedPlaybookId ? "Edit playbook" : "Create playbook"}</h2>
        <form className="knowledge-form" onSubmit={handleSubmit}>
          <label>
            Slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="general" required />
          </label>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="General Playbook" required />
          </label>
          <label>
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short usage summary" />
          </label>
          <div className="knowledge-row">
            <label>
              Kind
              <select value={kind} onChange={(event) => setKind(event.target.value as (typeof PLAYBOOK_KIND_OPTIONS)[number])}>
                {PLAYBOOK_KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select value={scope} onChange={(event) => setScope(event.target.value as (typeof PLAYBOOK_SCOPE_OPTIONS)[number])}>
                {PLAYBOOK_SCOPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Risk
              <select value={riskClass} onChange={(event) => setRiskClass(event.target.value as (typeof PLAYBOOK_RISK_OPTIONS)[number])}>
                {PLAYBOOK_RISK_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as (typeof PLAYBOOK_STATUS_OPTIONS)[number])}>
                {PLAYBOOK_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Source file (optional)
            <input value={sourceFile} onChange={(event) => setSourceFile(event.target.value)} placeholder="playbooks/general.md" />
          </label>
          <label>
            Markdown content
            <textarea
              value={contentMarkdown}
              onChange={(event) => setContentMarkdown(event.target.value)}
              rows={18}
              placeholder="# general.md"
              required
            />
          </label>
          <button className="knowledge-btn" type="submit">
            Save playbook
          </button>
        </form>
      </section>
    </div>
  );
}

export const KnowledgeAdmin = PlaybookAdmin;
