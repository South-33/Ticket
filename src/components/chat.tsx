"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { SignInButton, UserProfile, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@convex/_generated/api";
import { ChatCanvas } from "@/components/chat-canvas";

function MemoryNavIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5 6.25H11M5 8.5H11M5 10.75H9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SessionNavIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M6 3H3V13H6" stroke="currentColor" strokeWidth="1.25" />
      <path d="M7.5 8H13" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10.75 5.5L13.25 8L10.75 10.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

type MemoryProfileForm = {
  displayName: string;
  homeCity: string;
  homeAirport: string;
  nationality: string;
  ageBand: string;
  budgetBand: string;
  preferredCabin: string;
  flexibilityLevel: string;
  loyaltyPrograms: string;
};

const EMPTY_MEMORY_PROFILE_FORM: MemoryProfileForm = {
  displayName: "",
  homeCity: "",
  homeAirport: "",
  nationality: "",
  ageBand: "",
  budgetBand: "",
  preferredCabin: "",
  flexibilityLevel: "",
  loyaltyPrograms: "",
};

function parseLoyaltyPrograms(input: string) {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 12);
}

function normalizeFactKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function TravelPreferencesMemory({ open }: { open: boolean }) {
  const memory = useQuery(api.memory.getUserMemory, open ? {} : "skip");
  const upsertUserProfile = useMutation(api.memory.upsertUserProfile);
  const upsertUserMemoryFact = useMutation(api.memory.upsertUserMemoryFact);
  const removeUserMemoryFact = useMutation(api.memory.removeUserMemoryFact);
  const upsertUserPreferenceNote = useMutation(api.memory.upsertUserPreferenceNote);
  const removeUserPreferenceNote = useMutation(api.memory.removeUserPreferenceNote);
  const generateUserMemorySnapshot = useMutation(api.memory.generateUserMemorySnapshot);
  const [profileForm, setProfileForm] = useState<MemoryProfileForm>(EMPTY_MEMORY_PROFILE_FORM);
  const [newFactKey, setNewFactKey] = useState("");
  const [newFactValue, setNewFactValue] = useState("");
  const [newFactSensitive, setNewFactSensitive] = useState(false);
  const [newPreferenceKey, setNewPreferenceKey] = useState("");
  const [newPreferenceValue, setNewPreferenceValue] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingFact, setIsSavingFact] = useState(false);
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const [isGeneratingSnapshot, setIsGeneratingSnapshot] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingFactKey, setDeletingFactKey] = useState<string | null>(null);
  const [editingPreferenceKey, setEditingPreferenceKey] = useState<string | null>(null);
  const [editingPreferenceValue, setEditingPreferenceValue] = useState("");
  const [isSavingPreferenceEdit, setIsSavingPreferenceEdit] = useState(false);
  const [deletingPreferenceKey, setDeletingPreferenceKey] = useState<string | null>(null);

  const profileDisplayName = memory?.profile?.displayName ?? "";
  const profileHomeCity = memory?.profile?.homeCity ?? "";
  const profileHomeAirport = memory?.profile?.homeAirport ?? "";
  const profileNationality = memory?.profile?.nationality ?? "";
  const profileAgeBand = memory?.profile?.ageBand ?? "";
  const profileBudgetBand = memory?.profile?.budgetBand ?? "";
  const profilePreferredCabin = memory?.profile?.preferredCabin ?? "";
  const profileFlexibilityLevel = memory?.profile?.flexibilityLevel ?? "";
  const profileLoyaltyCsv = (memory?.profile?.loyaltyPrograms ?? []).join(", ");

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextForm: MemoryProfileForm = {
      displayName: profileDisplayName,
      homeCity: profileHomeCity,
      homeAirport: profileHomeAirport,
      nationality: profileNationality,
      ageBand: profileAgeBand,
      budgetBand: profileBudgetBand,
      preferredCabin: profilePreferredCabin,
      flexibilityLevel: profileFlexibilityLevel,
      loyaltyPrograms: profileLoyaltyCsv,
    };

    setProfileForm((previous) => {
      const unchanged =
        previous.displayName === nextForm.displayName &&
        previous.homeCity === nextForm.homeCity &&
        previous.homeAirport === nextForm.homeAirport &&
        previous.nationality === nextForm.nationality &&
        previous.ageBand === nextForm.ageBand &&
        previous.budgetBand === nextForm.budgetBand &&
        previous.preferredCabin === nextForm.preferredCabin &&
        previous.flexibilityLevel === nextForm.flexibilityLevel &&
        previous.loyaltyPrograms === nextForm.loyaltyPrograms;
      return unchanged ? previous : nextForm;
    });
  }, [
    open,
    profileAgeBand,
    profileBudgetBand,
    profileDisplayName,
    profileFlexibilityLevel,
    profileHomeAirport,
    profileHomeCity,
    profileLoyaltyCsv,
    profileNationality,
    profilePreferredCabin,
  ]);

  const onSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingProfile(true);

    try {
      await upsertUserProfile({
        displayName: profileForm.displayName.trim() || undefined,
        homeCity: profileForm.homeCity.trim() || undefined,
        homeAirport: profileForm.homeAirport.trim().toUpperCase() || undefined,
        nationality: profileForm.nationality.trim() || undefined,
        ageBand: profileForm.ageBand.trim() || undefined,
        budgetBand: profileForm.budgetBand.trim() || undefined,
        preferredCabin: profileForm.preferredCabin.trim() || undefined,
        flexibilityLevel: profileForm.flexibilityLevel.trim() || undefined,
        loyaltyPrograms: parseLoyaltyPrograms(profileForm.loyaltyPrograms),
      });
      await generateUserMemorySnapshot({});
      setStatusMessage("Saved travel profile preferences.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save travel profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const onSaveFact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const key = normalizeFactKey(newFactKey);
    const value = newFactValue.trim();

    if (!key || !value) {
      setErrorMessage("Fact key and value are required.");
      return;
    }

    setIsSavingFact(true);
    try {
      await upsertUserMemoryFact({
        key,
        value,
        sourceType: "user_confirmed",
        confidence: 1,
        status: "confirmed",
        isSensitive: newFactSensitive,
      });
      await generateUserMemorySnapshot({});
      setNewFactKey("");
      setNewFactValue("");
      setNewFactSensitive(false);
      setStatusMessage(`Saved fact \"${key}\".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save fact.");
    } finally {
      setIsSavingFact(false);
    }
  };

  const onRefreshSnapshot = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsGeneratingSnapshot(true);

    try {
      await generateUserMemorySnapshot({});
      setStatusMessage("Memory snapshot refreshed.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh snapshot.");
    } finally {
      setIsGeneratingSnapshot(false);
    }
  };

  const deleteFact = async (key: string) => {
    setDeletingFactKey(key);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await removeUserMemoryFact({ key });
      await generateUserMemorySnapshot({});
      setStatusMessage(`Deleted fact \"${key}\".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete fact.");
    } finally {
      setDeletingFactKey(null);
    }
  };

  const onSavePreference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const key = normalizeFactKey(newPreferenceKey);
    const value = newPreferenceValue.trim();
    if (!key || !value) {
      setErrorMessage("Preference key and value are required.");
      return;
    }

    setIsSavingPreference(true);
    try {
      await upsertUserPreferenceNote({ key, value });
      await generateUserMemorySnapshot({});
      setNewPreferenceKey("");
      setNewPreferenceValue("");
      setStatusMessage(`Saved preference \"${key}\".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save preference.");
    } finally {
      setIsSavingPreference(false);
    }
  };

  const startEditingPreference = (preference: { key: string; value: string }) => {
    setEditingPreferenceKey(preference.key);
    setEditingPreferenceValue(preference.value);
    setErrorMessage(null);
    setStatusMessage(null);
  };

  const cancelEditingPreference = () => {
    setEditingPreferenceKey(null);
    setEditingPreferenceValue("");
  };

  const saveEditingPreference = async () => {
    if (!editingPreferenceKey) {
      return;
    }
    const value = editingPreferenceValue.trim();
    if (!value) {
      setErrorMessage("Preference value cannot be empty.");
      return;
    }

    setIsSavingPreferenceEdit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await upsertUserPreferenceNote({
        key: editingPreferenceKey,
        value,
      });
      await generateUserMemorySnapshot({});
      setStatusMessage(`Updated preference \"${editingPreferenceKey}\".`);
      cancelEditingPreference();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update preference.");
    } finally {
      setIsSavingPreferenceEdit(false);
    }
  };

  const deletePreference = async (key: string) => {
    setDeletingPreferenceKey(key);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await removeUserPreferenceNote({ key });
      await generateUserMemorySnapshot({});
      if (editingPreferenceKey === key) {
        cancelEditingPreference();
      }
      setStatusMessage(`Deleted preference \"${key}\".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete preference.");
    } finally {
      setDeletingPreferenceKey(null);
    }
  };

  const factRows = memory?.facts ?? [];
  const preferenceRows = memory?.preferences ?? [];

  return (
    <div className="user-memory-panel">
      <p className="user-memory-intro">
        Save travel preferences once so future searches start with your defaults.
      </p>

      <form className="user-memory-section" onSubmit={onSaveProfile}>
        <h4>Travel Profile</h4>
        <div className="user-memory-grid">
          <label>
            <span>Display name</span>
            <input
              value={profileForm.displayName}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, displayName: event.target.value }))}
              placeholder="How Aura should address you"
            />
          </label>
          <label>
            <span>Home city</span>
            <input
              value={profileForm.homeCity}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, homeCity: event.target.value }))}
              placeholder="Example: Manila"
            />
          </label>
          <label>
            <span>Home airport</span>
            <input
              value={profileForm.homeAirport}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, homeAirport: event.target.value }))}
              placeholder="Example: MNL"
              maxLength={5}
            />
          </label>
          <label>
            <span>Preferred cabin</span>
            <input
              value={profileForm.preferredCabin}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, preferredCabin: event.target.value }))}
              placeholder="economy / premium_economy / business"
            />
          </label>
          <label>
            <span>Budget band</span>
            <input
              value={profileForm.budgetBand}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, budgetBand: event.target.value }))}
              placeholder="low / medium / high"
            />
          </label>
          <label>
            <span>Flexibility</span>
            <input
              value={profileForm.flexibilityLevel}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, flexibilityLevel: event.target.value }))}
              placeholder="strict / moderate / flexible"
            />
          </label>
          <label>
            <span>Nationality</span>
            <input
              value={profileForm.nationality}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, nationality: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label>
            <span>Age band</span>
            <input
              value={profileForm.ageBand}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, ageBand: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label className="user-memory-full-width">
            <span>Loyalty programs</span>
            <input
              value={profileForm.loyaltyPrograms}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, loyaltyPrograms: event.target.value }))}
              placeholder="Comma separated, e.g. KrisFlyer, Asia Miles"
            />
          </label>
        </div>
        <div className="user-memory-actions">
          <button type="submit" disabled={isSavingProfile}>
            {isSavingProfile ? "Saving..." : "Save profile"}
          </button>
        </div>
      </form>

      <form className="user-memory-section" onSubmit={onSaveFact}>
        <h4>Quick Memory Fact</h4>
        <div className="user-memory-grid">
          <label>
            <span>Fact key</span>
            <input
              value={newFactKey}
              onChange={(event) => setNewFactKey(event.target.value)}
              placeholder="seat_preference"
            />
          </label>
          <label className="user-memory-full-width">
            <span>Fact value</span>
            <input
              value={newFactValue}
              onChange={(event) => setNewFactValue(event.target.value)}
              placeholder="Aisle seat preferred on long-haul flights"
            />
          </label>
        </div>
        <label className="user-memory-sensitive-toggle">
          <input
            type="checkbox"
            checked={newFactSensitive}
            onChange={(event) => setNewFactSensitive(event.target.checked)}
          />
          Sensitive fact
        </label>
        <div className="user-memory-actions">
          <button type="submit" disabled={isSavingFact}>
            {isSavingFact ? "Saving..." : "Save fact"}
          </button>
          <button type="button" onClick={onRefreshSnapshot} disabled={isGeneratingSnapshot}>
            {isGeneratingSnapshot ? "Refreshing..." : "Refresh snapshot"}
          </button>
        </div>
      </form>

      <form className="user-memory-section" onSubmit={onSavePreference}>
        <h4>Preference Hints (Editable)</h4>
        <p className="user-memory-empty">
          These are soft hints for the assistant. They can be wrong or stale and are never treated as strict truth.
        </p>
        <div className="user-memory-grid">
          <label>
            <span>Preference key</span>
            <input
              value={newPreferenceKey}
              onChange={(event) => setNewPreferenceKey(event.target.value)}
              placeholder="hotel_area"
            />
          </label>
          <label className="user-memory-full-width">
            <span>Preference value</span>
            <input
              value={newPreferenceValue}
              onChange={(event) => setNewPreferenceValue(event.target.value)}
              placeholder="Prefer quiet neighborhoods with rail access"
            />
          </label>
        </div>
        <div className="user-memory-actions">
          <button type="submit" disabled={isSavingPreference}>
            {isSavingPreference ? "Saving..." : "Save preference"}
          </button>
        </div>

        {preferenceRows.length > 0 && (
          <div className="user-memory-facts">
            {preferenceRows.slice(0, 12).map((preference) => (
              <div key={`${preference.key}-${preference.updatedAt}`} className="user-memory-fact-row">
                <div className="user-memory-fact-head">
                  <strong>{preference.key}</strong>
                  <div className="user-memory-fact-controls">
                    <button className="user-memory-inline-btn" type="button" onClick={() => startEditingPreference(preference)}>
                      Edit
                    </button>
                    <button
                      className="user-memory-inline-btn user-memory-inline-btn-danger"
                      type="button"
                      onClick={() => void deletePreference(preference.key)}
                      disabled={deletingPreferenceKey === preference.key}
                    >
                      {deletingPreferenceKey === preference.key ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
                {editingPreferenceKey === preference.key ? (
                  <div className="user-memory-fact-editor">
                    <input
                      value={editingPreferenceValue}
                      onChange={(event) => setEditingPreferenceValue(event.target.value)}
                      placeholder="Updated preference"
                    />
                    <div className="user-memory-fact-controls">
                      <button
                        className="user-memory-inline-btn"
                        type="button"
                        onClick={() => void saveEditingPreference()}
                        disabled={isSavingPreferenceEdit}
                      >
                        {isSavingPreferenceEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        className="user-memory-inline-btn"
                        type="button"
                        onClick={cancelEditingPreference}
                        disabled={isSavingPreferenceEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>{preference.value}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </form>

      <section className="user-memory-section">
        <h4>Confirmed Memory</h4>
        <p className="user-memory-empty">
          Confirmed memory is delete-only for safety. To change it, delete the entry and add a corrected one.
        </p>
        {factRows.length === 0 ? (
          <p className="user-memory-empty">No confirmed memory facts yet.</p>
        ) : (
          <div className="user-memory-facts">
            {factRows.slice(0, 12).map((fact) => (
              <div key={`${fact.key}-${fact.updatedAt}`} className="user-memory-fact-row">
                <div className="user-memory-fact-head">
                  <strong>{fact.key}</strong>
                  <div className="user-memory-fact-controls">
                    <button
                      className="user-memory-inline-btn user-memory-inline-btn-danger"
                      type="button"
                      onClick={() => void deleteFact(fact.key)}
                      disabled={deletingFactKey === fact.key}
                    >
                      {deletingFactKey === fact.key ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
                <p>{fact.value}</p>
                <small>
                  {fact.isSensitive ? "Sensitive" : "Standard"} / conf {Math.round(fact.confidence * 100)}%
                </small>
              </div>
            ))}
          </div>
        )}
        {memory?.latestSnapshot && (
          <p className="user-memory-snapshot-meta">
            Snapshot v{memory.latestSnapshot.version} / {formatUtcTimestamp(memory.latestSnapshot.createdAt)}
          </p>
        )}
      </section>

      {statusMessage && <p className="user-memory-status">{statusMessage}</p>}
      {errorMessage && <p className="user-memory-error">{errorMessage}</p>}
    </div>
  );
}

function SidebarUser() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const cachedAvatarUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("aura:lastAvatarUrl");
  }, []);

  const cachedInitials = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("aura:lastAvatarInitial");
  }, []);

  const initials =
    user?.firstName?.[0] ??
    user?.emailAddresses?.[0]?.emailAddress?.[0] ??
    cachedInitials?.[0] ??
    "?";
  const avatarUrl = user?.imageUrl ?? cachedAvatarUrl;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (user?.imageUrl) {
      window.localStorage.setItem("aura:lastAvatarUrl", user.imageUrl);
    }

    if (initials && initials !== "?") {
      window.localStorage.setItem("aura:lastAvatarInitial", initials);
    }
  }, [initials, user?.imageUrl]);

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setOpen(false);
      setIsClosing(false);
    }, 250);
  };

  const handleSignOut = () => {
    window.localStorage.removeItem("aura:lastAvatarUrl");
    window.localStorage.removeItem("aura:lastAvatarInitial");
    window.localStorage.removeItem(SIDEBAR_LAST_USER_ID_KEY);
    void signOut();
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <div className="sidebar-user">
        <button
          className="sidebar-avatar-btn"
          onClick={() => setOpen(true)}
          title="Manage account"
          type="button"
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={initials}
              className="sidebar-avatar-img"
              width={28}
              height={28}
              unoptimized
            />
          ) : (
            <span className="sidebar-avatar-initials">{initials.toUpperCase()}</span>
          )}
        </button>
      </div>

      {open && createPortal(
        <div
          className="user-modal-backdrop"
          data-lenis-prevent
          data-closing={isClosing ? "true" : undefined}
          onClick={closeModal}
        >
          <div className="user-modal-content" data-lenis-prevent onClick={(e) => e.stopPropagation()}>
            <UserProfile routing="hash">
              <UserProfile.Page
                label="Travel Preferences"
                url="travel-preferences"
                labelIcon={<MemoryNavIcon />}
              >
                <TravelPreferencesMemory open={open} />
              </UserProfile.Page>
              <UserProfile.Page label="Session" url="session" labelIcon={<SessionNavIcon />}>
                <div className="user-session-panel">
                  <p>
                    Sign out from this device. Local cached avatar and session hints used by the sidebar will also
                    be cleared.
                  </p>
                  <button className="user-modal-signout" type="button" onClick={handleSignOut}>
                    Sign Out _&gt;
                  </button>
                </div>
              </UserProfile.Page>
            </UserProfile>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const INTRO_RESPONSE =
  "I can help you find better flight deals with AI-assisted deep research.\n\n" +
  "I compare route combinations, scan timing windows, cross-check fare rules, and verify options before recommending them. " +
  "I can also prioritize what matters most to you: lowest price, shortest duration, fewer layovers, or flexible change policies.\n\n" +
  "Share your route, dates, and constraints, and I will return a clear, verifiable shortlist.";

const TYPEWRITER_INITIAL_DELAY_MS = 0;
const TYPEWRITER_MIN_DELAY_MS = 0;
const TYPEWRITER_VARIANCE_MS = 2;
const TYPEWRITER_PUNCTUATION_PAUSE_MS = 25;
const THREAD_SWITCH_FADE_MS = 500;
const THREAD_SWITCH_REVEAL_DELAY_MS = 120;
const THREAD_SWITCH_FAILSAFE_MS = 5000;

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const SIDEBAR_HISTORY_CACHE_KEY_PREFIX = "aura:sidebarHistory:v1";
const SIDEBAR_LAST_USER_ID_KEY = "aura:lastUserId";
const MAX_CACHED_SIDEBAR_THREADS = 8;

const TERMINAL_RESEARCH_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

type CachedSidebarThread = {
  threadId: string;
  title: string;
};

const subscribeNoop = () => {
  return () => {};
};

function getSidebarHistoryCacheKey(userId: string | undefined) {
  return `${SIDEBAR_HISTORY_CACHE_KEY_PREFIX}:${userId ?? "anon"}`;
}

function readCachedSidebarThreads(cacheKey: string): CachedSidebarThread[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const threadId = (item as Record<string, unknown>).threadId;
        const title = (item as Record<string, unknown>).title;
        if (typeof threadId !== "string" || typeof title !== "string") {
          return null;
        }
        return { threadId, title };
      })
      .filter((item): item is CachedSidebarThread => item !== null)
      .slice(0, MAX_CACHED_SIDEBAR_THREADS);
  } catch {
    return [];
  }
}

function writeCachedSidebarThreads(cacheKey: string, threads: CachedSidebarThread[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(threads.slice(0, MAX_CACHED_SIDEBAR_THREADS)));
  } catch {
    // Ignore localStorage write failures.
  }
}

function toResearchStatusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "verifying":
      return "Verifying";
    case "synthesizing":
      return "Synthesizing";
    case "running":
      return "Running";
    case "planned":
      return "Planned";
    case "awaiting_input":
      return "Awaiting Input";
    default:
      return "Queued";
  }
}

function toCandidateLabel(category: string) {
  if (category === "cheapest") {
    return "Cheapest";
  }
  if (category === "best_value") {
    return "Best Value";
  }
  if (category === "most_convenient") {
    return "Most Convenient";
  }
  return category;
}

function formatUtcTimestamp(value: number | undefined) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function freshnessLabel(recheckAfter: number | undefined) {
  if (!recheckAfter) {
    return "unknown";
  }
  return recheckAfter <= Date.now() ? "stale" : "fresh";
}

type ResearchTaskView = {
  key: string;
  label: string;
  status: string;
};

type ResearchFindingView = {
  title: string;
  summary: string;
  createdAt: number;
};

type ResearchSourceView = {
  url: string;
  rank: number;
  title: string;
};

type ResearchCandidateView = {
  category: string;
  title: string;
  summary: string;
  confidence: number;
  verificationStatus: string;
  estimatedTotalUsd: number;
  travelMinutes: number;
  transferCount: number;
  recheckAfter: number;
  primarySourceUrl?: string;
  updatedAt: number;
};

type RankedResultView = {
  category: string;
  rank: number;
  score: number;
  title: string;
  rationale: string;
  verificationStatus: string;
  recheckAfter: number;
  updatedAt: number;
};

type ResearchStageEventView = {
  status: string;
  stage: string;
  progress: number;
  attempt: number;
  errorCode?: string;
  createdAt: number;
};

type ResearchJobView = {
  researchJobId: string;
  status: string;
  stage: string;
  progress: number;
  lastErrorCode?: string;
  nextRunAt?: number;
  error?: string;
  followUpQuestion?: string;
  missingFields?: string[];
  tasks: ResearchTaskView[];
  findings: ResearchFindingView[];
  sources: ResearchSourceView[];
  candidates: ResearchCandidateView[];
  rankedResults: RankedResultView[];
};

function ResearchStatusPanel({
  latestResearchJob,
  stageEvents,
  isResearchActive,
  onRecheckNow,
}: {
  latestResearchJob: ResearchJobView;
  stageEvents: ResearchStageEventView[];
  isResearchActive: boolean;
  onRecheckNow: () => Promise<void>;
}) {
  return (
    <section className="research-status" aria-live="polite">
      <div className="research-status-head">
        <span>Research Pipeline</span>
        <span>{latestResearchJob.stage}</span>
      </div>
      <div className="research-status-progress-track">
        <div
          className="research-status-progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, latestResearchJob.progress))}%` }}
        />
      </div>
      <div className="research-status-meta">
        <span>{toResearchStatusLabel(latestResearchJob.status)}</span>
        <span>{latestResearchJob.progress}%</span>
      </div>
      {(latestResearchJob.lastErrorCode || latestResearchJob.nextRunAt) && (
        <p className="research-status-runtime">
          {latestResearchJob.lastErrorCode ? `Code: ${latestResearchJob.lastErrorCode}` : ""}
          {latestResearchJob.lastErrorCode && latestResearchJob.nextRunAt ? " | " : ""}
          {latestResearchJob.nextRunAt ? `Next retry: ${formatUtcTimestamp(latestResearchJob.nextRunAt)}` : ""}
        </p>
      )}
      {stageEvents.length > 0 && (
        <div className="research-status-events">
          <div className="research-status-events-head">Recent Stage Events</div>
          <ul className="research-status-events-list">
            {stageEvents.map((event) => (
              <li key={`${event.createdAt}-${event.stage}-${event.attempt}`} className="research-status-events-item">
                <span>{formatUtcTimestamp(event.createdAt)}</span>
                <span>{event.stage}</span>
                <span>{toResearchStatusLabel(event.status)} {event.progress}% (#{event.attempt})</span>
                <span>{event.errorCode ? `code: ${event.errorCode}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {latestResearchJob.error && <p className="research-status-error">{latestResearchJob.error}</p>}
      {!isResearchActive && latestResearchJob.status !== "awaiting_input" && (
        <button className="research-status-recheck" type="button" onClick={() => void onRecheckNow()}>
          Recheck Live Data
        </button>
      )}
      {latestResearchJob.followUpQuestion && (
        <p className="research-status-followup">{latestResearchJob.followUpQuestion}</p>
      )}
      {latestResearchJob.missingFields && latestResearchJob.missingFields.length > 0 && (
        <p className="research-status-missing">Missing: {latestResearchJob.missingFields.join(", ")}</p>
      )}
      {latestResearchJob.tasks.length > 0 && (
        <ul className="research-status-tasks">
          {latestResearchJob.tasks.map((task) => (
            <li key={task.key} className={clsx("research-status-task", `status-${task.status}`)}>
              <span>{task.label}</span>
              <span>{toResearchStatusLabel(task.status)}</span>
            </li>
          ))}
        </ul>
      )}
      {!isResearchActive && latestResearchJob.findings.length > 0 && (
        <div className="research-status-findings">
          {latestResearchJob.findings.map((finding) => (
            <p key={`${finding.title}-${finding.createdAt}`}>
              <strong>{finding.title}:</strong> {finding.summary}
            </p>
          ))}
        </div>
      )}
      {latestResearchJob.sources.length > 0 && (
        <div className="research-status-sources">
          {latestResearchJob.sources.map((source) => (
            <a key={`${source.url}-${source.rank}`} href={source.url} target="_blank" rel="noreferrer">
              [{source.rank}] {source.title}
            </a>
          ))}
        </div>
      )}
      {!isResearchActive && latestResearchJob.candidates.length > 0 && (
        <div className="research-candidates">
          {latestResearchJob.candidates.map((candidate) => (
            <article key={`${candidate.category}-${candidate.updatedAt}`} className="research-candidate">
              <div className="research-candidate-head">
                <span>{toCandidateLabel(candidate.category)}</span>
                <span>{Math.round(candidate.confidence * 100)}%</span>
              </div>
              <h4>{candidate.title}</h4>
              <p>{candidate.summary}</p>
              <p className="research-candidate-metrics">
                ${candidate.estimatedTotalUsd} total - {candidate.travelMinutes}m - {candidate.transferCount} transfer(s)
              </p>
              <p className="research-candidate-verification">
                Verification: {candidate.verificationStatus.replaceAll("_", " ")} ({freshnessLabel(candidate.recheckAfter)})
              </p>
              {candidate.primarySourceUrl && (
                <a href={candidate.primarySourceUrl} target="_blank" rel="noreferrer">
                  Open primary source
                </a>
              )}
            </article>
          ))}
        </div>
      )}
      {!isResearchActive && latestResearchJob.rankedResults.length > 0 && (
        <div className="research-ranked-results">
          {latestResearchJob.rankedResults.map((result) => (
            <article key={`${result.category}-${result.rank}-${result.updatedAt}`} className="research-ranked-result">
              <div>
                #{result.rank} {toCandidateLabel(result.category)} - {result.score}
              </div>
              <p>{result.title}</p>
              <small>{result.rationale}</small>
              <small>{result.verificationStatus.replaceAll("_", " ")}</small>
              <small>freshness: {freshnessLabel(result.recheckAfter)}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function getReasoningText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractTaggedPayload(raw: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escapedTag}>([\\s\\S]*?)<\/${escapedTag}>`, "i");
  const match = raw.match(regex);
  return match?.[1]?.trim();
}

function stripAssistantEnvelope(raw: string) {
  return raw
    .replace(/<Response>[\s\S]*?<\/Response>/gi, "")
    .replace(/<MemoryOps>[\s\S]*?<\/MemoryOps>/gi, "")
    .replace(/<TitleOps>[\s\S]*?<\/TitleOps>/gi, "")
    .replace(/<MemoryNote>[\s\S]*?<\/MemoryNote>/gi, "")
    .trim();
}

function parseAssistantOutput(raw: string) {
  const response = extractTaggedPayload(raw, "Response") ?? stripAssistantEnvelope(raw) ?? raw;
  const memoryNote = extractTaggedPayload(raw, "MemoryNote");
  return {
    response: response.trim(),
    memoryNote,
  };
}

function getReasoningKeyPoints(reasoning: string) {
  const cleaned = reasoning.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [] as string[];
  }

  const blocks = cleaned.split(/\n\s*\n+/);
  const points: string[] = [];

  for (const block of blocks) {
    const firstLine = block.split("\n")[0]?.trim();
    if (!firstLine) {
      continue;
    }

    let point = "";
    const markdownHeading = firstLine.match(/^#{1,6}\s+(.+)$/);
    const boldHeading = firstLine.match(/^\*\*(.+)\*\*$/);

    if (markdownHeading) {
      point = markdownHeading[1].trim();
    } else if (boldHeading) {
      point = boldHeading[1].trim();
    } else if (firstLine.length <= 90 && !/[.!?:;]$/.test(firstLine)) {
      point = firstLine;
    }

    if (!point) {
      continue;
    }

    if (!points.includes(point)) {
      points.push(point);
    }
    if (points.length >= 5) {
      break;
    }
  }

  return points;
}

function Message({ message }: { message: UIMessage }) {
  const assistantPayload = useMemo(() => parseAssistantOutput(message.text ?? ""), [message.text]);
  const reasoning = getReasoningText(message);
  const [visibleText, smoothTextState] = useSmoothText(assistantPayload.response, {
    startStreaming: message.status === "streaming",
  });
  const [visibleReasoning, smoothReasoningState] = useSmoothText(reasoning, {
    startStreaming: message.status === "streaming",
  });
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const isReasoningExpanded = isReasoningOpen;
  const isReasoningTypewriterActive = message.status === "streaming" || smoothReasoningState.isStreaming;
  const displayReasoning = isReasoningTypewriterActive ? visibleReasoning : reasoning;
  const reasoningKeyPoints = useMemo(
    () => getReasoningKeyPoints(displayReasoning),
    [displayReasoning],
  );

  if (message.role === "system") {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="message user">
        <div className="message-wrapper">
          <div className="message-meta">User Query</div>
          <div className="message-content">{message.text}</div>
        </div>
      </div>
    );
  }

  const safetyFallback = message.status === "failed" && !(message.text ?? "").trim();
  const displayText = safetyFallback ? "Response blocked by safety policies." : visibleText;
  const isTypewriterActive = message.status === "streaming" || smoothTextState.isStreaming;

  if (!displayText.trim() && !displayReasoning.trim() && !isTypewriterActive && !isReasoningTypewriterActive) {
    return null;
  }

  return (
    <div className="message ai">
      {(displayReasoning || isReasoningTypewriterActive) && (
        <div className="reasoning-container">
          <div className={clsx("reasoning-block", isReasoningExpanded && "open")}>
            <button
              className="reasoning-summary"
              onClick={() => setIsReasoningOpen((current) => !current)}
              type="button"
            >
              Synthesis Process
            </button>
            <div className={clsx("reasoning-points-shell", !isReasoningExpanded && "visible")}>
              {reasoningKeyPoints.length > 0 && (
                <ul className="reasoning-points">
                  {reasoningKeyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className={clsx("reasoning-accordion", isReasoningExpanded && "open")}>
              <div className="reasoning-content-wrapper">
                <div className="message-content reasoning-content">
                  {isReasoningTypewriterActive ? (
                    <>
                      <span className="streaming-text">{displayReasoning}</span>
                      <span className="typewriter-cursor reasoning-cursor" />
                    </>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayReasoning.trim()}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="response-container">
        <div className="message-meta">
          {isTypewriterActive ? "Aura Processing" : "Aura Response"}
        </div>
        {(displayText || isTypewriterActive) && (
          <div className="message-content">
            {isTypewriterActive ? (
              <>
                <span className="streaming-text">{displayText}</span>
                <span className="typewriter-cursor" />
              </>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText.trim()}</ReactMarkdown>
            )}
          </div>
        )}
        {!!assistantPayload.memoryNote && !isTypewriterActive && (
          <p className="assistant-memory-note">Memory updated: {assistantPayload.memoryNote}</p>
        )}
      </div>
    </div>
  );
}

function AuthenticatedChat() {
  const { user } = useUser();
  const threads = useQuery(api.chat.listThreads);
  const createThread = useMutation(api.chat.createThread);
  const deleteThread = useMutation(api.chat.deleteThread);
  const requestLiveRecheck = useMutation(api.research.requestLiveRecheck);
  const sendPrompt = useMutation(api.chat.sendPrompt).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isComposingNew, setIsComposingNew] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [introHtml, setIntroHtml] = useState("");
  const [isIntroTyping, setIsIntroTyping] = useState(false);
  const [isFeedScrolling, setIsFeedScrolling] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [lastKnownUserId, setLastKnownUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(SIDEBAR_LAST_USER_ID_KEY);
  });
  const [cachedSidebarThreads, setCachedSidebarThreads] = useState<CachedSidebarThread[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    const rememberedUserId = window.localStorage.getItem(SIDEBAR_LAST_USER_ID_KEY) ?? undefined;
    return readCachedSidebarThreads(getSidebarHistoryCacheKey(rememberedUserId));
  });

  const sidebarRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const fadingTimerRef = useRef<number | null>(null);
  const dataWaitTimerRef = useRef<number | null>(null);
  const waitingForDataRef = useRef(false);
  const effectiveUserId = user?.id ?? lastKnownUserId ?? undefined;
  const sidebarHistoryCacheKey = useMemo(() => getSidebarHistoryCacheKey(effectiveUserId), [effectiveUserId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!user?.id || user.id === lastKnownUserId) {
      return;
    }
    window.localStorage.setItem(SIDEBAR_LAST_USER_ID_KEY, user.id);
    setLastKnownUserId(user.id);
  }, [lastKnownUserId, user?.id]);

  useEffect(() => {
    setCachedSidebarThreads(readCachedSidebarThreads(sidebarHistoryCacheKey));
  }, [sidebarHistoryCacheKey]);

  useEffect(() => {
    if (!threads) {
      return;
    }

    const compact = threads.map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
    }));
    setCachedSidebarThreads(compact);
    writeCachedSidebarThreads(sidebarHistoryCacheKey, compact);
  }, [threads, sidebarHistoryCacheKey]);

  const sidebarThreads = threads ?? cachedSidebarThreads;


  const switchThread = useCallback(
    (newThreadId: string | null, composingNew: boolean) => {
      if (isFadingOut) return;
      if (!composingNew && newThreadId === activeThreadId && !isComposingNew) return;
      setIsFadingOut(true);
      waitingForDataRef.current = false;
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
      fadingTimerRef.current = window.setTimeout(() => {
        setIsComposingNew(composingNew);
        setActiveThreadId(newThreadId);
        if (composingNew) {
          setSessionVersion((v) => v + 1);
        }
        if (composingNew) {
          // New session: fade out first, then fade straight back in
          setIsFadingOut(false);
        } else {
          // Existing thread: stay invisible until target messages are ready.
          waitingForDataRef.current = true;
          // Failsafe: avoid staying hidden forever if something goes wrong.
          dataWaitTimerRef.current = window.setTimeout(() => {
            waitingForDataRef.current = false;
            setIsFadingOut(false);
          }, THREAD_SWITCH_FAILSAFE_MS);
        }
      }, THREAD_SWITCH_FADE_MS);
    },
    [activeThreadId, isComposingNew, isFadingOut, setSessionVersion, setActiveThreadId, setIsComposingNew],
  );

  const startNew = useCallback(() => {
    switchThread(null, true);
  }, [switchThread]);

  const activeThread = useMemo(
    () => threads?.find((thread) => thread.threadId === activeThreadId),
    [activeThreadId, threads],
  );
  const activeThreadIdForMessages = activeThread?.threadId ?? null;

  const messageFeed = useUIMessages(
    api.chat.listMessages,
    activeThreadIdForMessages ? { threadId: activeThreadIdForMessages } : "skip",
    { initialNumItems: 40, stream: true },
  );
  const latestResearchJob = useQuery(
    api.research.getLatestJobForThread,
    activeThreadIdForMessages ? { threadId: activeThreadIdForMessages } : "skip",
  );
  const stageEventsPage = useQuery(
    api.research.listStageEventsByJob,
    latestResearchJob
      ? {
          researchJobId: latestResearchJob.researchJobId,
          paginationOpts: {
            numItems: 8,
            cursor: null,
          },
        }
      : "skip",
  );
  const stageEvents = stageEventsPage?.page ?? [];

  const visibleMessages = useMemo(
    () => (isComposingNew || !activeThreadIdForMessages ? [] : messageFeed.results),
    [activeThreadIdForMessages, isComposingNew, messageFeed.results],
  );

  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const showIntro = visibleMessages.length === 0 && !isStreaming;
  const isResearchActive = !!latestResearchJob && !TERMINAL_RESEARCH_STATUSES.has(latestResearchJob.status);

  useEffect(() => {
    document.body.classList.toggle("chat-switching", isFadingOut);
    return () => {
      document.body.classList.remove("chat-switching");
    };
  }, [isFadingOut]);

  // Fade back in once the target thread's messages have loaded and scroll is settled.
  useEffect(() => {
    if (waitingForDataRef.current && visibleMessages.length > 0) {
      waitingForDataRef.current = false;
      if (dataWaitTimerRef.current !== null) {
        window.clearTimeout(dataWaitTimerRef.current);
        dataWaitTimerRef.current = null;
      }
      window.requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.requestAnimationFrame(() => {
          dataWaitTimerRef.current = window.setTimeout(() => {
            setIsFadingOut(false);
            dataWaitTimerRef.current = null;
          }, THREAD_SWITCH_REVEAL_DELAY_MS);
        });
      });
    }
  }, [visibleMessages.length]);

  useEffect(() => {
    if (isFadingOut || waitingForDataRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleMessages.length, introHtml, isStreaming, isFadingOut]);

  useEffect(() => {
    if (!showIntro) {
      setIntroHtml("");
      setIsIntroTyping(false);
      return;
    }

    let cancelled = false;
    let i = 0;
    let textBuffer = "";
    let isTag = false;
    let timer = 0;

    setIntroHtml("");
    setIsIntroTyping(true);

    const typeWriter = () => {
      if (cancelled) {
        return;
      }

      if (i >= INTRO_RESPONSE.length) {
        setIsIntroTyping(false);
        return;
      }

      const char = INTRO_RESPONSE.charAt(i);
      if (char === "<") {
        isTag = true;
      }

      textBuffer += char;
      setIntroHtml(textBuffer.replace(/\n/g, "<br />"));

      if (char === ">") {
        isTag = false;
      }

      i += 1;
      let delay = isTag ? 0 : Math.random() * TYPEWRITER_VARIANCE_MS + TYPEWRITER_MIN_DELAY_MS;
      if (char === "." || char === "\n") {
        delay += TYPEWRITER_PUNCTUATION_PAUSE_MS;
      }

      timer = window.setTimeout(typeWriter, delay);
    };

    timer = window.setTimeout(typeWriter, TYPEWRITER_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showIntro, sessionVersion]);

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
    };
  }, []);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "28px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, []);

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isSubmitting) {
      return;
    }

    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
    }
    setIsSubmitting(true);

    try {
      let threadId = activeThreadIdForMessages;
      if (!threadId) {
        const created = await createThread({});
        threadId = created.threadId;
        setIsComposingNew(false);
        setActiveThreadId(threadId);
      }

      if (!threadId) {
        return;
      }

      await sendPrompt({ threadId, prompt });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (event: React.MouseEvent, threadId: string) => {
    event.stopPropagation();
    if (!window.confirm("Delete this session?")) {
      return;
    }

    await deleteThread({ threadId });
    if (activeThreadId === threadId) {
      setIsComposingNew(false);
      setActiveThreadId(null);
    }
  };

  const handleRecheckNow = async () => {
    if (!latestResearchJob || isResearchActive) {
      return;
    }
    await requestLiveRecheck({
      researchJobId: latestResearchJob.researchJobId,
    });
  };

  const handleFeedScroll = () => {
    setIsFeedScrolling((current) => (current ? current : true));

    if (scrollIdleTimerRef.current !== null) {
      window.clearTimeout(scrollIdleTimerRef.current);
    }

    scrollIdleTimerRef.current = window.setTimeout(() => {
      setIsFeedScrolling(false);
    }, 140);
  };

  const researchStatusPanel = latestResearchJob ? (
    <ResearchStatusPanel
      latestResearchJob={latestResearchJob}
      stageEvents={stageEvents}
      isResearchActive={isResearchActive}
      onRecheckNow={handleRecheckNow}
    />
  ) : null;

  return (
    <div className="oracle-shell">
      <div className="noise-overlay" />
      <div className="grid-bg" />
      <ChatCanvas pause={isFeedScrolling} />

      <div className="app-container">
        <aside ref={sidebarRef} className="sidebar">
          <header className="brand">
            <h1>Aura</h1>
            <span>System.v.26</span>
          </header>

          <button className="new-chat-btn" onClick={startNew}>
            <span>New Session</span>
            <span>[+]</span>
          </button>

          <div className="nav-section-title">Context History</div>
          <ul className="history-list" id="historyList">
            {sidebarThreads.length > 0
              ? sidebarThreads.map((thread) => (
                <li className="history-item" key={thread.threadId}>
                  <button
                    className={clsx(
                      "history-link",
                      thread.threadId === activeThreadId && !isComposingNew && "active",
                    )}
                    onClick={() => {
                      switchThread(thread.threadId, false);
                    }}
                  >
                    {thread.title}
                  </button>

                  {threads && (
                    <button
                      className="history-delete"
                      onClick={(event) => {
                        void handleDelete(event, thread.threadId);
                      }}
                      aria-label="Delete session"
                    >
                      [x]
                    </button>
                  )}
                </li>
              ))
              : (
                <li className="history-item">
                  <span className="history-link placeholder">No Sessions yet</span>
                </li>
              )}
          </ul>

          {hasClerk && <SidebarUser />}
        </aside>



        <main className="main-area">
          {researchStatusPanel && (
            <div className="research-status-dock">
              <div className="research-status-shell">{researchStatusPanel}</div>
            </div>
          )}

          <div
            className={clsx("chat-feed", isFadingOut && "fading-out", latestResearchJob && "with-research-dock")}
            id="chatFeed"
            ref={feedRef}
            onScroll={handleFeedScroll}
          >
            {showIntro ? (
              <>
                <div className="message user">
                  <div className="message-wrapper">
                    <div className="message-meta">User Query</div>
                    <div className="message-content">What do you do?</div>
                  </div>
                </div>

                <div className="message ai">
                  <div className="response-container">
                    <div className="message-meta">Aura Response</div>
                    <div
                      className="message-content"
                      id="typewriter-target"
                      dangerouslySetInnerHTML={{
                        __html: `${introHtml}${isIntroTyping ? '<span class="typewriter-cursor"></span>' : ""}`,
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              visibleMessages.map((message) => (
                <Message key={message.key} message={message} />
              ))
            )}
          </div>

          <div className="input-wrapper">
            <div className="input-grid">
              <form className="input-container" onSubmit={(event) => void handleSend(event)}>
                <span className="input-prefix">_&gt;</span>
                <span className="input-fade-layer" aria-hidden />

                <textarea
                  id="userInput"
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                  placeholder="Enter command sequence..."
                  onChange={(event) => {
                    setDraft(event.target.value);
                    resizeTextarea();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={isSubmitting}
                />

                <button
                  className="send-btn"
                  id="sendBtn"
                  type="submit"
                  disabled={isSubmitting || !draft.trim()}
                >
                  [ Execute ]
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function Chat() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const hasMounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [cachedSignedInSession] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("aura:lastSignedIn") === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isAuthenticated) {
      window.localStorage.setItem("aura:lastSignedIn", "1");
      return;
    }

    if (!isLoading) {
      window.localStorage.removeItem("aura:lastSignedIn");
    }
  }, [isAuthenticated, isLoading]);

  if (!hasMounted) {
    return (
      <div className="oracle-shell">
        <div className="noise-overlay" />
        <div className="grid-bg" style={{ left: 0 }} />
      </div>
    );
  }

  if (isAuthenticated || (isLoading && cachedSignedInSession)) {
    return <AuthenticatedChat />;
  }

  if (isLoading) {
    return (
      <div className="oracle-shell auth-screen">
        <div className="noise-overlay" />
        <div className="grid-bg" style={{ left: 0 }} />
        <div className="auth-content-wrapper">
          <div className="auth-message-block" key="loading">
            <div className="message-meta">Restoring Session</div>
            <h2 className="auth-title">Aura Access Protocol</h2>
            <div className="message-content">Checking your authentication status...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="oracle-shell auth-screen">
      <div className="noise-overlay" />
      <div className="grid-bg" style={{ left: 0 }} />
      <div className="auth-content-wrapper">
        <div className="auth-message-block" key="signin">
          <div className="message-meta">Sign In Required</div>
          <h2 className="auth-title">Aura Access Protocol</h2>
          <div className="message-content">
            Please authenticate to start travel research and save your preferences.
          </div>
          {hasClerk ? (
            <SignInButton mode="modal">
              <button className="auth-btn" type="button">
                Authenticate _&gt;
              </button>
            </SignInButton>
          ) : (
            <div className="message-content">Set Clerk environment keys to enable sign-in.</div>
          )}
        </div>
      </div>
    </div>
  );
}
