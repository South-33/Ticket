"use client";

import { SignInButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { hasConfiguredClerk } from "@/lib/clerk-env";

type KnowledgeDocId = Id<"knowledgeDocs">;
type KnowledgeItemId = Id<"knowledgeItems">;

const DOC_KIND_OPTIONS = ["all", "skills", "flights", "train", "concert"] as const;
const DOC_STATUS_OPTIONS = ["all", "draft", "active", "archived"] as const;
const ITEM_STATUS_OPTIONS = ["all", "draft", "active", "stale"] as const;

function parseSourceUrls(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function KnowledgeAdmin() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const hasClerk = hasConfiguredClerk();

  const [docKindFilter, setDocKindFilter] = useState<(typeof DOC_KIND_OPTIONS)[number]>("all");
  const [docStatusFilter, setDocStatusFilter] = useState<(typeof DOC_STATUS_OPTIONS)[number]>("all");
  const [itemStatusFilter, setItemStatusFilter] = useState<(typeof ITEM_STATUS_OPTIONS)[number]>("all");
  const [selectedDocId, setSelectedDocId] = useState<KnowledgeDocId | null>(null);

  const [docSlug, setDocSlug] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docKind, setDocKind] = useState<"skills" | "flights" | "train" | "concert">("skills");
  const [docStatus, setDocStatus] = useState<"draft" | "active" | "archived">("draft");
  const [docSummary, setDocSummary] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [itemContent, setItemContent] = useState("");
  const [itemConfidence, setItemConfidence] = useState("0.7");
  const [itemPriority, setItemPriority] = useState("60");
  const [itemStatus, setItemStatus] = useState<"draft" | "active" | "stale">("draft");
  const [itemSources, setItemSources] = useState("");
  const [itemExpiresAt, setItemExpiresAt] = useState("");

  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null);
  const [markdownRequestedAt, setMarkdownRequestedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upsertKnowledgeDoc = useMutation(api.knowledge.upsertKnowledgeDoc);
  const addKnowledgeItem = useMutation(api.knowledge.addKnowledgeItem);
  const updateKnowledgeItem = useMutation(api.knowledge.updateKnowledgeItem);
  const runKnowledgeMaintenance = useMutation(api.knowledge.runKnowledgeMaintenance);

  const docsResult = useQuery(api.knowledge.listKnowledgeDocs, {
    kind: docKindFilter === "all" ? undefined : docKindFilter,
    status: docStatusFilter === "all" ? undefined : docStatusFilter,
    paginationOpts: {
      numItems: 20,
      cursor: null,
    },
  });

  const docs = useMemo(() => docsResult?.page ?? [], [docsResult]);

  const effectiveSelectedDocId = useMemo(() => {
    if (docs.length === 0) {
      return null;
    }
    if (selectedDocId && docs.some((doc) => doc._id === selectedDocId)) {
      return selectedDocId;
    }
    return docs[0]._id;
  }, [docs, selectedDocId]);

  const selectedDoc = useMemo(
    () => docs.find((doc) => doc._id === effectiveSelectedDocId) ?? null,
    [docs, effectiveSelectedDocId],
  );

  const itemsResult = useQuery(
    api.knowledge.listKnowledgeItemsByDoc,
    effectiveSelectedDocId
      ? {
          docId: effectiveSelectedDocId,
          status: itemStatusFilter === "all" ? undefined : itemStatusFilter,
          paginationOpts: {
            numItems: 20,
            cursor: null,
          },
        }
      : "skip",
  );

  const linksResult = useQuery(
    api.knowledge.listKnowledgeLinksByDoc,
    effectiveSelectedDocId
      ? {
          docId: effectiveSelectedDocId,
        }
      : "skip",
  );

  const docSummaryResult = useQuery(
    api.knowledge.getKnowledgeDocForEditor,
    effectiveSelectedDocId
      ? {
          docId: effectiveSelectedDocId,
        }
      : "skip",
  );

  const markdownResult = useQuery(
    api.knowledge.generateKnowledgeMarkdown,
    selectedDoc?.slug && markdownRequestedAt
      ? {
          slug: selectedDoc.slug,
          asOfMs: markdownRequestedAt,
        }
      : "skip",
  );

  const items = itemsResult?.page ?? [];
  const links = linksResult ?? [];

  async function handleDocSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const docId = await upsertKnowledgeDoc({
        slug: docSlug.trim(),
        title: docTitle.trim(),
        kind: docKind,
        status: docStatus,
        summary: docSummary.trim() || undefined,
      });
      setSelectedDocId(docId);
      setNotice("Knowledge doc saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleItemSubmit(event: FormEvent) {
    event.preventDefault();
    if (!effectiveSelectedDocId) {
      setError("Select a knowledge doc first.");
      return;
    }

    setError(null);
    setNotice(null);
    try {
      const confidence = Number(itemConfidence);
      const priority = Number(itemPriority);
      const expiresAtMs = itemExpiresAt ? Date.parse(itemExpiresAt) : undefined;

      await addKnowledgeItem({
        docId: effectiveSelectedDocId,
        key: itemKey.trim(),
        content: itemContent.trim(),
        confidence,
        priority,
        status: itemStatus,
        sourceUrls: parseSourceUrls(itemSources),
        expiresAt: Number.isFinite(expiresAtMs ?? NaN) ? expiresAtMs : undefined,
      });

      setNotice("Knowledge item saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function staleItem(itemId: KnowledgeItemId) {
    setError(null);
    setNotice(null);
    try {
      await updateKnowledgeItem({
        itemId,
        status: "stale",
      });
      setNotice("Item marked stale.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function runMaintenanceNow() {
    setError(null);
    setNotice(null);
    try {
      const result = await runKnowledgeMaintenance({
        asOfMs: Date.now(),
      });
      setMaintenanceResult(`docs visited: ${result.docsVisited}, items staled: ${result.itemsStaled}`);
      setNotice("Maintenance completed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (isLoading) {
    return <div className="knowledge-admin-state">Loading auth session...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="knowledge-admin-state">
        <h2>Sign In Required</h2>
        <p>You must authenticate to open knowledge curation tools.</p>
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
          <p className="knowledge-kicker">Knowledge Curation</p>
          <h1>Playbook Admin</h1>
        </div>
        <button className="knowledge-btn" type="button" onClick={() => void runMaintenanceNow()}>
          Run Maintenance
        </button>
      </header>

      {notice && <p className="knowledge-notice">{notice}</p>}
      {error && <p className="knowledge-error">{error}</p>}
      {maintenanceResult && <p className="knowledge-note">{maintenanceResult}</p>}

      <section className="knowledge-panel">
        <h2>Docs</h2>
        <div className="knowledge-row">
          <label>
            Kind
            <select value={docKindFilter} onChange={(event) => setDocKindFilter(event.target.value as (typeof DOC_KIND_OPTIONS)[number])}>
              {DOC_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={docStatusFilter} onChange={(event) => setDocStatusFilter(event.target.value as (typeof DOC_STATUS_OPTIONS)[number])}>
              {DOC_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="knowledge-list">
          {docs.map((doc) => (
            <button
              key={doc._id}
              className={`knowledge-list-item ${effectiveSelectedDocId === doc._id ? "active" : ""}`}
              type="button"
              onClick={() => setSelectedDocId(doc._id)}
            >
              <strong>{doc.title}</strong>
              <span>
                {doc.kind} | {doc.status}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="knowledge-panel">
        <h2>Upsert Doc</h2>
        <form className="knowledge-form" onSubmit={(event) => void handleDocSubmit(event)}>
          <input placeholder="slug" value={docSlug} onChange={(event) => setDocSlug(event.target.value)} required />
          <input placeholder="title" value={docTitle} onChange={(event) => setDocTitle(event.target.value)} required />
          <div className="knowledge-row">
            <select value={docKind} onChange={(event) => setDocKind(event.target.value as "skills" | "flights" | "train" | "concert")}>
              {DOC_KIND_OPTIONS.filter((option) => option !== "all").map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <select value={docStatus} onChange={(event) => setDocStatus(event.target.value as "draft" | "active" | "archived")}>
              {DOC_STATUS_OPTIONS.filter((option) => option !== "all").map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Summary"
            value={docSummary}
            onChange={(event) => setDocSummary(event.target.value)}
            rows={3}
          />
          <button className="knowledge-btn" type="submit">
            Save Doc
          </button>
        </form>
      </section>

      <section className="knowledge-panel">
        <h2>Selected Doc</h2>
        {docSummaryResult ? (
          <div className="knowledge-note-grid">
            <p>
              <strong>{docSummaryResult.doc.title}</strong> ({docSummaryResult.doc.slug})
            </p>
            <p>active items: {docSummaryResult.activeItemCount}</p>
            <p>stale items: {docSummaryResult.staleItemCount}</p>
            <p>
              latest item update: {docSummaryResult.latestItemUpdatedAt ? new Date(docSummaryResult.latestItemUpdatedAt).toLocaleString() : "n/a"}
            </p>
          </div>
        ) : (
          <p className="knowledge-note">Select a doc to inspect details.</p>
        )}
        <button
          className="knowledge-btn"
          type="button"
          disabled={!selectedDoc}
          onClick={() => setMarkdownRequestedAt(Date.now())}
        >
          Regenerate Markdown Snapshot
        </button>
        {markdownResult && (
          <textarea className="knowledge-markdown" readOnly value={markdownResult.markdown} rows={10} />
        )}
      </section>

      <section className="knowledge-panel">
        <h2>Upsert Item</h2>
        <form className="knowledge-form" onSubmit={(event) => void handleItemSubmit(event)}>
          <input placeholder="key" value={itemKey} onChange={(event) => setItemKey(event.target.value)} required />
          <textarea
            placeholder="content"
            value={itemContent}
            onChange={(event) => setItemContent(event.target.value)}
            rows={4}
            required
          />
          <div className="knowledge-row">
            <input
              placeholder="confidence (0-1)"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={itemConfidence}
              onChange={(event) => setItemConfidence(event.target.value)}
              required
            />
            <input
              placeholder="priority (0-100)"
              type="number"
              min="0"
              max="100"
              step="1"
              value={itemPriority}
              onChange={(event) => setItemPriority(event.target.value)}
              required
            />
          </div>
          <div className="knowledge-row">
            <select value={itemStatus} onChange={(event) => setItemStatus(event.target.value as "draft" | "active" | "stale")}>
              {ITEM_STATUS_OPTIONS.filter((option) => option !== "all").map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={itemExpiresAt}
              onChange={(event) => setItemExpiresAt(event.target.value)}
            />
          </div>
          <textarea
            placeholder="source urls (comma or newline separated)"
            value={itemSources}
            onChange={(event) => setItemSources(event.target.value)}
            rows={3}
          />
          <button className="knowledge-btn" type="submit" disabled={!effectiveSelectedDocId}>
            Save Item
          </button>
        </form>
      </section>

      <section className="knowledge-panel">
        <h2>Items</h2>
        <div className="knowledge-row">
          <label>
            Status
            <select value={itemStatusFilter} onChange={(event) => setItemStatusFilter(event.target.value as (typeof ITEM_STATUS_OPTIONS)[number])}>
              {ITEM_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead>
              <tr>
                <th>key</th>
                <th>status</th>
                <th>priority</th>
                <th>confidence</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td>{item.key}</td>
                  <td>{item.status}</td>
                  <td>{item.priority}</td>
                  <td>{item.confidence.toFixed(2)}</td>
                  <td>
                    <button
                      className="knowledge-link"
                      type="button"
                      disabled={item.status === "stale"}
                      onClick={() => void staleItem(item._id as KnowledgeItemId)}
                    >
                      mark stale
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="knowledge-panel">
        <h2>Doc Links</h2>
        {links.length === 0 ? (
          <p className="knowledge-note">No links for selected doc yet.</p>
        ) : (
          <ul className="knowledge-links">
            {links.map((link) => (
              <li key={link.linkId}>
                {link.label} ({link.fromDocId} -&gt; {link.toDocId})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
