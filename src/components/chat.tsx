"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useStreamingUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { SignInButton, UserProfile, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import clsx from "clsx";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLenis } from "lenis/react";
import { api } from "@convex/_generated/api";
import { ChatCanvas } from "@/components/chat-canvas";
import { ArrowClockwise, Check, CopySimple } from "@phosphor-icons/react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { getNextAutoFollowEnabled } from "@/lib/chat-scroll";
import { hasConfiguredClerk } from "@/lib/clerk-env";
import { buildLatestTurnSnapshot, getMessageIdentity, resolveSelectedVariantId } from "@/lib/latest-turn";

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
  const memoryAudit = useQuery(api.memory.listMemoryOpAudit, open ? { limit: 8 } : "skip");
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
  const auditRows = memoryAudit ?? [];

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

      <section className="user-memory-section">
        <h4>Recent Memory Activity</h4>
        {auditRows.length === 0 ? (
          <p className="user-memory-empty">No memory activity recorded yet.</p>
        ) : (
          <div className="user-memory-audit-list">
            {auditRows.map((event, index) => (
              <div key={`${event.createdAt}-${event.key}-${index}`} className="user-memory-audit-item">
                <div>
                  <strong>{event.action.toUpperCase()}</strong> {event.store} / {event.key}
                </div>
                <p>{event.reason}</p>
                <small>
                  {event.outcome === "applied" ? "Applied" : "Skipped"} / conf {Math.round(event.confidence * 100)}% /
                  {" "}
                  {formatUtcTimestamp(event.createdAt)}
                </small>
              </div>
            ))}
          </div>
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
const THREAD_SWITCH_FAILSAFE_MS = 5000;
const AUTO_FOLLOW_ATTACH_THRESHOLD_PX = 96;
const AUTO_FOLLOW_DETACH_THRESHOLD_PX = 160;
const AUTO_FOLLOW_ANCHOR_MARGIN_PX = 24;
const AUTO_FOLLOW_RESUME_THRESHOLD_PX = 140;
const AUTO_FOLLOW_USER_INTENT_WINDOW_MS = 480;
const AUTO_FOLLOW_PROGRAMMATIC_GUARD_MS = 280;
const AUTO_FOLLOW_SMOOTH_DURATION_S = 0.32;
const AUTO_FOLLOW_SEND_DURATION_S = 0.48;
const AUTO_FOLLOW_STREAM_DURATION_S = 0.28;
const THREAD_SWITCH_REVEAL_OFFSET_RATIO = 0.1;
const THREAD_SWITCH_REVEAL_MIN_OFFSET_PX = 72;
const THREAD_SWITCH_REVEAL_MAX_OFFSET_PX = 112;
const THREAD_SWITCH_REVEAL_DURATION_S = 0.3;
const THREAD_SWITCH_FIRST_REVEAL_OFFSET_PX = 42;
const THREAD_SWITCH_FIRST_REVEAL_DURATION_S = 0.22;
const THREAD_SWITCH_REVEAL_FALLBACK_MS = 900;
const THREAD_SWITCH_LONG_CONVO_VIEWPORT_MULTIPLIER = 1.15;
const THREAD_SWITCH_FINAL_HARD_SNAP_THRESHOLD_PX = 220;
const RETRY_FADE_OUT_MS = 180;
const RESPONSE_VARIANT_SWAP_OUT_MS = 140;
const RESPONSE_VARIANT_SWAP_IN_MS = 220;

const AUTO_FOLLOW_EASING = (t: number) => {
  return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
};

const hasClerk = hasConfiguredClerk();
const SIDEBAR_HISTORY_CACHE_KEY_PREFIX = "aura:sidebarHistory:v1";
const SIDEBAR_LAST_USER_ID_KEY = "aura:lastUserId";
const MAX_CACHED_SIDEBAR_THREADS = 8;

const TERMINAL_RESEARCH_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

type CachedSidebarThread = {
  threadId: string;
  title: string;
};

const subscribeNoop = () => {
  return () => { };
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

type ResearchDialogueEventView = {
  actor: string;
  kind: string;
  message: string;
  detail?: string;
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
  selectedSkillSlugs?: string[];
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  runtimeSignals: {
    plannerMode: "pending" | "llm" | "fallback";
    searchMode: "pending" | "tavily" | "fallback" | "hybrid";
    rankingMode: "pending" | "llm" | "fallback";
    fallbackActive: boolean;
  };
  tasks: ResearchTaskView[];
  findings: ResearchFindingView[];
  sources: ResearchSourceView[];
  candidates: ResearchCandidateView[];
  rankedResults: RankedResultView[];
  dialogueEvents: ResearchDialogueEventView[];
};

function formatRuntimeMode(value: string) {
  return value.replaceAll("_", " ");
}

function formatActorLabel(value: string) {
  return value.trim().toUpperCase();
}

function formatSkillLabel(value: string) {
  return value.replaceAll("_", " ").trim();
}

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
      <div className="research-status-operator-meta">
        <span>Updated: {formatUtcTimestamp(latestResearchJob.updatedAt)}</span>
        {latestResearchJob.startedAt ? <span>Started: {formatUtcTimestamp(latestResearchJob.startedAt)}</span> : null}
        {latestResearchJob.completedAt ? (
          <span>Completed: {formatUtcTimestamp(latestResearchJob.completedAt)}</span>
        ) : null}
      </div>
      <div className="research-runtime-signals">
        <div className="research-runtime-signals-head">Runtime Signals</div>
        <div className="research-runtime-signal-grid">
          <span
            className={clsx(
              "research-runtime-signal",
              latestResearchJob.runtimeSignals.plannerMode === "fallback" && "is-warning",
            )}
          >
            Planner: {formatRuntimeMode(latestResearchJob.runtimeSignals.plannerMode)}
          </span>
          <span
            className={clsx(
              "research-runtime-signal",
              (latestResearchJob.runtimeSignals.searchMode === "fallback" ||
                latestResearchJob.runtimeSignals.searchMode === "hybrid") &&
                "is-warning",
            )}
          >
            Search: {formatRuntimeMode(latestResearchJob.runtimeSignals.searchMode)}
          </span>
          <span
            className={clsx(
              "research-runtime-signal",
              latestResearchJob.runtimeSignals.rankingMode === "fallback" && "is-warning",
            )}
          >
            Ranking: {formatRuntimeMode(latestResearchJob.runtimeSignals.rankingMode)}
          </span>
        </div>
        {latestResearchJob.runtimeSignals.fallbackActive && (
          <p className="research-runtime-callout">
            This run used at least one fallback path. Compare output quality against citations before judging speed.
          </p>
        )}
        {latestResearchJob.selectedSkillSlugs && latestResearchJob.selectedSkillSlugs.length > 0 && (
          <div className="research-runtime-skills">
            {latestResearchJob.selectedSkillSlugs.map((skill) => (
              <span key={skill} className="research-runtime-skill">
                {formatSkillLabel(skill)}
              </span>
            ))}
          </div>
        )}
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
      {latestResearchJob.dialogueEvents.length > 0 && (
        <div className="research-status-dialogue">
          <div className="research-status-events-head">Operator Notes</div>
          <ul className="research-status-events-list">
            {latestResearchJob.dialogueEvents.slice(-4).map((event) => (
              <li
                key={`${event.createdAt}-${event.actor}-${event.kind}`}
                className="research-status-events-item research-status-dialogue-item"
              >
                <span>{formatUtcTimestamp(event.createdAt)}</span>
                <span>
                  {formatActorLabel(event.actor)} / {formatRuntimeMode(event.kind)}
                </span>
                <span>{event.message}</span>
                {event.detail ? <span>{event.detail}</span> : null}
              </li>
            ))}
          </ul>
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

function formatSkillSlugLabel(slug: string) {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function parseSkillLoadNote(raw: string) {
  const tagged = extractTaggedPayload(raw, "SkillOps");
  if (!tagged) {
    return null;
  }

  try {
    const parsed = JSON.parse(tagged) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const action = (parsed as { action?: unknown }).action;
    if (action !== "load") {
      return null;
    }

    const skillsRaw = (parsed as { skills?: unknown }).skills;
    if (!Array.isArray(skillsRaw)) {
      return null;
    }

    const skills = Array.from(
      new Set(
        skillsRaw
          .filter((value): value is string => typeof value === "string")
          .map((value) => formatSkillSlugLabel(value))
          .filter((value) => value.length > 0),
      ),
    );

    if (skills.length === 0) {
      return null;
    }

    if (skills.length === 1) {
      return `Loaded \`${skills[0]}\` skill.`;
    }

    return `Loaded ${skills.map((skill) => `\`${skill}\``).join(", ")} skills.`;
  } catch {
    return null;
  }
}

function formatMemoryStoreLabel(store: string) {
  if (store === "profile") {
    return "profile memory";
  }
  if (store === "preference") {
    return "preference memory";
  }
  return "fact memory";
}

function parseMemoryOpsNotes(raw: string) {
  const tagged = extractTaggedPayload(raw, "MemoryOps");
  if (!tagged) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(tagged) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    const notes: string[] = [];
    for (const operation of parsed) {
      if (!operation || typeof operation !== "object") {
        continue;
      }
      const action = (operation as { action?: unknown }).action;
      const store = (operation as { store?: unknown }).store;
      const key = (operation as { key?: unknown }).key;
      const value = (operation as { value?: unknown }).value;

      if (
        (action !== "add" && action !== "update" && action !== "delete")
        || (store !== "fact" && store !== "preference" && store !== "profile")
      ) {
        continue;
      }

      const keyLabel = typeof key === "string" && key.trim().length > 0 ? `\`${key.trim()}\`` : "`item`";
      const storeLabel = formatMemoryStoreLabel(store);
      const valueLabel = typeof value === "string" && value.trim().length > 0 ? ` (\`${value.trim()}\`)` : "";

      if (action === "delete") {
        notes.push(`Removed ${keyLabel} from ${storeLabel}.`);
      } else if (action === "add") {
        notes.push(`Saved ${keyLabel}${valueLabel} to ${storeLabel}.`);
      } else {
        notes.push(`Updated ${keyLabel}${valueLabel} in ${storeLabel}.`);
      }
    }

    return notes;
  } catch {
    return [] as string[];
  }
}

function findTagOpenIndex(raw: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escapedTag}(?:\\s|>)`, "i");
  return raw.search(regex);
}

function parseAssistantEventNotes(raw: string, memoryNote: string | null, skillLoadNote: string | null) {
  const events: Array<{ order: number; note: string }> = [];

  const memoryOpsNotes = parseMemoryOpsNotes(raw);
  if (memoryOpsNotes.length > 0) {
    const order = findTagOpenIndex(raw, "MemoryOps");
    const baseOrder = order === -1 ? Number.MAX_SAFE_INTEGER - 2 : order;
    for (let index = 0; index < memoryOpsNotes.length; index += 1) {
      events.push({ order: baseOrder + index * 0.001, note: memoryOpsNotes[index] });
    }
  }

  if (skillLoadNote) {
    const order = findTagOpenIndex(raw, "SkillOps");
    events.push({ order: order === -1 ? Number.MAX_SAFE_INTEGER - 1 : order, note: skillLoadNote });
  }

  if (memoryNote) {
    const order = findTagOpenIndex(raw, "MemoryNote");
    events.push({ order: order === -1 ? Number.MAX_SAFE_INTEGER : order, note: memoryNote });
  }

  return events.sort((a, b) => a.order - b.order).map((event) => event.note);
}

function stripAssistantEnvelope(raw: string) {
  return raw
    .replace(/<ContractVersion>[\s\S]*?<\/ContractVersion>/gi, "")
    .replace(/<Response>[\s\S]*?<\/Response>/gi, "")
    .replace(/<MemoryOps>[\s\S]*?<\/MemoryOps>/gi, "")
    .replace(/<ResearchOps>[\s\S]*?<\/ResearchOps>/gi, "")
    .replace(/<SkillOps>[\s\S]*?<\/SkillOps>/gi, "")
    .replace(/<TitleOps>[\s\S]*?<\/TitleOps>/gi, "")
    .replace(/<MemoryNote>[\s\S]*?<\/MemoryNote>/gi, "")
    .trim();
}

function parseAssistantOutput(raw: string) {
  const response = extractTaggedPayload(raw, "Response") ?? stripAssistantEnvelope(raw) ?? raw;
  const memoryNote = extractTaggedPayload(raw, "MemoryNote") ?? null;
  const skillLoadNote = parseSkillLoadNote(raw);
  const eventNotes = parseAssistantEventNotes(raw, memoryNote, skillLoadNote);
  return {
    response: response.trim(),
    memoryNote,
    skillLoadNote,
    eventNotes,
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

function hasMessageReasoningPanelContent(message: UIMessage) {
  const reasoning = getReasoningText(message);
  if (reasoning.trim().length > 0) {
    return true;
  }
  const payload = parseAssistantOutput(message.text ?? "");
  return payload.eventNotes.length > 0;
}

type ResponseVariantControls = {
  current: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

function Message({
  message,
  onCopy,
  onRetry,
  canRetry = true,
  hideActions = false,
  showInlinePendingCursor = false,
  animateReasoningSummaryOut = false,
  variantControls,
  isRetryFading = false,
  variantSwapPhase,
}: {
  message: UIMessage;
  onCopy?: () => void;
  onRetry?: () => void;
  canRetry?: boolean;
  hideActions?: boolean;
  showInlinePendingCursor?: boolean;
  animateReasoningSummaryOut?: boolean;
  variantControls?: ResponseVariantControls;
  isRetryFading?: boolean;
  variantSwapPhase?: "out" | "in" | null;
}) {
  const assistantPayload = useMemo(() => parseAssistantOutput(message.text ?? ""), [message.text]);
  const reasoning = getReasoningText(message);
  const [visibleText, smoothTextState] = useSmoothText(assistantPayload.response, {
    startStreaming: message.status === "streaming",
  });
  const [visibleReasoning, smoothReasoningState] = useSmoothText(reasoning, {
    startStreaming: message.status === "streaming" || message.status === "pending",
  });
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  const isReasoningExpanded = isReasoningOpen;
  const isReasoningTypewriterActive =
    message.status === "streaming"
    || message.status === "pending"
    || smoothReasoningState.isStreaming;
  const displayReasoning = isReasoningTypewriterActive ? visibleReasoning : reasoning;
  const eventNotes = assistantPayload.eventNotes;
  const reasoningKeyPoints = useMemo(
    () => getReasoningKeyPoints(displayReasoning),
    [displayReasoning],
  );
  const collapsedReasoningPoints = useMemo(
    () => [
      ...reasoningKeyPoints,
      ...eventNotes,
    ],
    [reasoningKeyPoints, eventNotes],
  );
  const hasReasoningPanelContent = Boolean(displayReasoning || isReasoningTypewriterActive || eventNotes.length > 0);

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
  const isTypewriterActive =
    message.status === "streaming"
    || message.status === "pending"
    || smoothTextState.isStreaming;

  const handleCopy = () => {
    onCopy?.();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  if (!displayText.trim() && !displayReasoning.trim() && !isTypewriterActive && !isReasoningTypewriterActive) {
    return null;
  }

  return (
    <div className="message ai">
      {hasReasoningPanelContent && (
        <div className="reasoning-container">
          <div className={clsx("reasoning-block", isReasoningExpanded && "open")}>
            <button
              className={clsx(
                "reasoning-summary",
                variantSwapPhase === "out" && animateReasoningSummaryOut && "variant-swapping-out",
              )}
              onClick={() => setIsReasoningOpen((current) => !current)}
              type="button"
            >
              Reasoning Process
            </button>
            <div
              className={clsx(
                "reasoning-content-shell",
                isRetryFading && "retry-fading-content",
                variantSwapPhase === "out" && "variant-swapping-out",
                variantSwapPhase === "in" && "variant-swapping-in",
              )}
            >
              <div className={clsx("reasoning-points-shell", !isReasoningExpanded && "visible")}>
                {collapsedReasoningPoints.length > 0 && (
                  <ul className="reasoning-points">
                    {collapsedReasoningPoints.map((point, index) => (
                      <li key={`${point}-${index}`}>
                        <MarkdownRenderer content={point} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={clsx("reasoning-accordion", isReasoningExpanded && "open")}>
                <div className="reasoning-content-wrapper">
                  <div className={clsx("message-content reasoning-content", isReasoningTypewriterActive && "is-streaming")}>
                    {(displayReasoning || isReasoningTypewriterActive) && (
                      <>
                        <MarkdownRenderer content={displayReasoning} isStreaming={isReasoningTypewriterActive} />
                      </>
                    )}
                    {eventNotes.length > 0 && (
                      <ul className="reasoning-points reasoning-points-inline">
                        {eventNotes.map((note, index) => (
                          <li key={`${note}-${index}`}>
                            <MarkdownRenderer content={note} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
        <div
          className={clsx(
            "response-content-shell",
            isRetryFading && !showInlinePendingCursor && "retry-fading-content",
            showInlinePendingCursor && "inline-pending-cursor",
            variantSwapPhase === "out" && "variant-swapping-out",
            variantSwapPhase === "in" && "variant-swapping-in",
          )}
        >
          <div className="response-text-shell">
            {(displayText || isTypewriterActive || showInlinePendingCursor) && (
              <div className={clsx("message-content", isTypewriterActive && "is-streaming")}>
                {showInlinePendingCursor ? (
                  <span className="typewriter-cursor" aria-label="Generating response" />
                ) : (
                  <MarkdownRenderer content={displayText} isStreaming={isTypewriterActive} />
                )}
              </div>
            )}
          </div>

          {!isTypewriterActive && !hideActions && (
            <div className="message-footer">
              <div className="message-actions">
                <button
                  className="message-action-btn"
                  type="button"
                  onClick={handleCopy}
                  title="Copy response"
                >
                  {showCopied ? (
                    <Check size={13} weight="bold" />
                  ) : (
                    <CopySimple size={13} />
                  )}
                  <span>{showCopied ? "Copied" : "Copy"}</span>
                </button>

                {onRetry && (
                  <button
                    className="message-action-btn"
                    type="button"
                    onClick={onRetry}
                    title="Regenerate response"
                    disabled={!canRetry}
                  >
                    <ArrowClockwise size={13} />
                    <span>Retry</span>
                  </button>
                )}
              </div>

              {variantControls && variantControls.total > 1 && (
                <div className="message-variant-switcher">
                  <button
                    type="button"
                    className="message-variant-btn"
                    onClick={variantControls.onPrev}
                    disabled={!variantControls.canPrev}
                    aria-label="Previous response variant"
                  >
                    Prev
                  </button>
                  <span className="message-variant-indicator">
                    {variantControls.current}/{variantControls.total}
                  </span>
                  <button
                    type="button"
                    className="message-variant-btn"
                    onClick={variantControls.onNext}
                    disabled={!variantControls.canNext}
                    aria-label="Next response variant"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target.isContentEditable;
}

function AuthenticatedChat() {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const threads = useQuery(api.chat.listThreads, isAuthenticated ? {} : "skip");
  const createThread = useMutation(api.chat.createThread);
  const deleteThread = useMutation(api.chat.deleteThread);
  const requestLiveRecheck = useMutation(api.research.requestLiveRecheck);
  const retryPrompt = useMutation(api.chat.retryPrompt);
  const sendPrompt = useMutation(api.chat.sendPrompt).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isComposingNew, setIsComposingNew] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [awaitingAssistantThreadId, setAwaitingAssistantThreadId] = useState<string | null>(null);
  const [selectedLatestVariantId, setSelectedLatestVariantId] = useState<string | null>(null);
  const [latestResponseVariantSwapPhase, setLatestResponseVariantSwapPhase] = useState<"out" | "in" | null>(null);
  const [animateReasoningSummaryOut, setAnimateReasoningSummaryOut] = useState(false);
  const [retryFadingMessageKey, setRetryFadingMessageKey] = useState<string | null>(null);
  const [isRetryWaitingCursor, setIsRetryWaitingCursor] = useState(false);
  const [introHtml, setIntroHtml] = useState("");
  const [isIntroTyping, setIsIntroTyping] = useState(false);
  const [isFeedScrolling, setIsFeedScrolling] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isThreadSwitchRevealing, setIsThreadSwitchRevealing] = useState(false);
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
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const fadingTimerRef = useRef<number | null>(null);
  const dataWaitTimerRef = useRef<number | null>(null);
  const threadSwitchRevealTimerRef = useRef<number | null>(null);
  const waitingForDataRef = useRef(false);
  const awaitingAssistantBaselineKeyRef = useRef<string | null>(null);
  const keepAttachedUntilFreshAssistantRef = useRef(false);
  const threadSwitchTokenRef = useRef(0);
  const hasCompletedFirstThreadSwitchRef = useRef(false);
  const isThreadSwitchTransitionRef = useRef(false);
  const isFeedEndVisibleRef = useRef(true);
  const wasAtBottomOnHiddenRef = useRef(true);
  const autoFollowLastUserIntentRef = useRef(0);
  const autoFollowProgrammaticUntilRef = useRef(0);
  const touchLastYRef = useRef<number | null>(null);
  const scrollDebugCounterRef = useRef(0);
  const latestPersistedVariantCountRef = useRef(0);
  const latestResponseVariantSwapOutTimerRef = useRef<number | null>(null);
  const latestResponseVariantSwapInTimerRef = useRef<number | null>(null);
  const activeThreadIdDebugRef = useRef<string | null>(null);
  const isFadingOutDebugRef = useRef(false);
  const isThreadSwitchRevealingDebugRef = useRef(false);
  const autoFollowEnabledRef = useRef(true);
  const lastScrollPositionRef = useRef(0);
  const lenis = useLenis();
  const effectiveUserId = user?.id ?? lastKnownUserId ?? undefined;
  const sidebarHistoryCacheKey = useMemo(() => getSidebarHistoryCacheKey(effectiveUserId), [effectiveUserId]);

  const getCurrentScrollPosition = useCallback(() => {
    if (lenis) {
      return lenis.actualScroll;
    }
    return window.scrollY;
  }, [lenis]);

  const getBottomDistance = useCallback(() => {
    if (lenis) {
      return Math.max(0, lenis.limit - lenis.actualScroll);
    }
    return Math.max(0, document.documentElement.scrollHeight - (window.scrollY + window.innerHeight));
  }, [lenis]);

  const isNearBottom = useCallback(
    (threshold = AUTO_FOLLOW_ATTACH_THRESHOLD_PX) => {
      return getBottomDistance() <= threshold;
    },
    [getBottomDistance],
  );

  const getThreadSwitchRevealOffset = useCallback(() => {
    if (typeof window === "undefined") {
      return THREAD_SWITCH_REVEAL_MIN_OFFSET_PX;
    }
    const desired = window.innerHeight * THREAD_SWITCH_REVEAL_OFFSET_RATIO;
    return Math.max(
      THREAD_SWITCH_REVEAL_MIN_OFFSET_PX,
      Math.min(THREAD_SWITCH_REVEAL_MAX_OFFSET_PX, desired),
    );
  }, []);

  useEffect(() => {
    activeThreadIdDebugRef.current = activeThreadId;
    isFadingOutDebugRef.current = isFadingOut;
    isThreadSwitchRevealingDebugRef.current = isThreadSwitchRevealing;
  }, [activeThreadId, isFadingOut, isThreadSwitchRevealing]);

  const logScrollDebug = useCallback((event: string, details?: Record<string, unknown>) => {
    scrollDebugCounterRef.current += 1;
    const seq = scrollDebugCounterRef.current;
    const now = Number(performance.now().toFixed(1));
    const bottomDistance = Number(getBottomDistance().toFixed(1));
    const lenisLimit = lenis ? Number(lenis.limit.toFixed(1)) : null;
    const lenisActual = lenis ? Number(lenis.actualScroll.toFixed(1)) : null;

    console.log(`[scroll-debug #${seq}] ${event}`, {
      t: now,
      attached: autoFollowEnabledRef.current,
      anchorVisible: isFeedEndVisibleRef.current,
      transitionActive: isThreadSwitchTransitionRef.current,
      isFadingOut: isFadingOutDebugRef.current,
      isThreadSwitchRevealing: isThreadSwitchRevealingDebugRef.current,
      bottomDistance,
      lenisLimit,
      lenisActual,
      activeThreadId: activeThreadIdDebugRef.current,
      ...(details ?? {}),
    });
  }, [getBottomDistance, lenis]);

  const scrollToPageBottom = useCallback((options?: {
    immediate?: boolean;
    force?: boolean;
    duration?: number;
    lock?: boolean;
    bottomOffsetPx?: number;
    onComplete?: () => void;
    reason?: string;
  }) => {
    const immediate = options?.immediate ?? false;
    const force = options?.force ?? true;
    const lock = options?.lock ?? false;
    const duration = options?.duration ?? AUTO_FOLLOW_SMOOTH_DURATION_S;
    const bottomOffsetPx = Math.max(0, options?.bottomOffsetPx ?? 0);
    const onComplete = options?.onComplete;
    const reason = options?.reason ?? "unknown";
    const lenisLimitBefore = lenis ? Number(lenis.limit.toFixed(1)) : null;
    const lenisActualBefore = lenis ? Number(lenis.actualScroll.toFixed(1)) : null;

    logScrollDebug("scrollToBottom:request", {
      reason,
      immediate,
      force,
      lock,
      duration,
      bottomOffsetPx,
      lenisLimitBefore,
      lenisActualBefore,
    });

    autoFollowProgrammaticUntilRef.current = Date.now() + AUTO_FOLLOW_PROGRAMMATIC_GUARD_MS;

    if (lenis) {
      const target = Math.max(0, lenis.limit - bottomOffsetPx);
      lenis.scrollTo(target, {
        duration,
        immediate,
        force,
        lock,
        easing: AUTO_FOLLOW_EASING,
        onComplete,
      });
      window.requestAnimationFrame(() => {
        logScrollDebug("scrollToBottom:applied", {
          reason,
          transport: "lenis",
          target,
          lenisLimitAfter: Number(lenis.limit.toFixed(1)),
          lenisActualAfter: Number(lenis.actualScroll.toFixed(1)),
        });
      });
      return;
    }
    if (feedEndRef.current && bottomOffsetPx <= 0) {
      feedEndRef.current.scrollIntoView({ block: "end", behavior: immediate ? "auto" : "smooth" });
      window.requestAnimationFrame(() => {
        logScrollDebug("scrollToBottom:applied", {
          reason,
          transport: "dom-anchor",
        });
      });
      if (onComplete) {
        if (immediate) {
          onComplete();
        } else {
          window.setTimeout(onComplete, Math.max(80, Math.ceil(duration * 1000)));
        }
      }
      return;
    }
    const target = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - bottomOffsetPx);
    window.scrollTo({ top: target, behavior: immediate ? "auto" : "smooth" });
    window.requestAnimationFrame(() => {
      logScrollDebug("scrollToBottom:applied", {
        reason,
        transport: "window-scroll",
        target,
      });
    });
    if (onComplete) {
      if (immediate) {
        onComplete();
      } else {
        window.setTimeout(onComplete, Math.max(80, Math.ceil(duration * 1000)));
      }
    }
  }, [lenis, logScrollDebug]);

  useEffect(() => {
    const anchor = feedEndRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      return;
    }

    logScrollDebug("observer:mounted", {
      target: "chat-feed-end",
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const inView = entry.isIntersecting;
        isFeedEndVisibleRef.current = inView;
        if (inView) {
          autoFollowEnabledRef.current = true;
        }
        logScrollDebug("observer:anchor-visibility", {
          inView,
          intersectionRatio: Number(entry.intersectionRatio.toFixed(3)),
        });
      },
      {
        root: null,
        threshold: 0,
        rootMargin: `0px 0px -${AUTO_FOLLOW_ANCHOR_MARGIN_PX}px 0px`,
      },
    );

    observer.observe(anchor);

    return () => {
      logScrollDebug("observer:unmounted", {
        target: "chat-feed-end",
      });
      observer.disconnect();
    };
  }, [logScrollDebug]);

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

  const clearVariantSwapTimers = useCallback(() => {
    if (latestResponseVariantSwapOutTimerRef.current !== null) {
      window.clearTimeout(latestResponseVariantSwapOutTimerRef.current);
      latestResponseVariantSwapOutTimerRef.current = null;
    }
    if (latestResponseVariantSwapInTimerRef.current !== null) {
      window.clearTimeout(latestResponseVariantSwapInTimerRef.current);
      latestResponseVariantSwapInTimerRef.current = null;
    }
  }, []);


  const switchThread = useCallback(
    (newThreadId: string | null, composingNew: boolean) => {
      if (isFadingOut) return;
      if (!composingNew && newThreadId === activeThreadId && !isComposingNew) return;

      threadSwitchTokenRef.current += 1;
      const switchToken = threadSwitchTokenRef.current;
      isThreadSwitchTransitionRef.current = true;
      logScrollDebug("thread-switch:start", {
        switchToken,
        newThreadId,
        composingNew,
      });
      setAwaitingAssistantThreadId(null);
      awaitingAssistantBaselineKeyRef.current = null;
      keepAttachedUntilFreshAssistantRef.current = false;
      setRetryFadingMessageKey(null);
      setIsRetryWaitingCursor(false);
      clearVariantSwapTimers();
      setLatestResponseVariantSwapPhase(null);
      setAnimateReasoningSummaryOut(false);
      setSelectedLatestVariantId(null);
      autoFollowLastUserIntentRef.current = 0;
      setIsFadingOut(true);
      setIsThreadSwitchRevealing(false);
      waitingForDataRef.current = false;
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
      if (threadSwitchRevealTimerRef.current !== null) window.clearTimeout(threadSwitchRevealTimerRef.current);
      fadingTimerRef.current = window.setTimeout(() => {
        if (threadSwitchTokenRef.current !== switchToken) {
          logScrollDebug("thread-switch:stale-fade-skip", {
            switchToken,
          });
          return;
        }
        logScrollDebug("thread-switch:fade-complete", {
          switchToken,
          newThreadId,
          composingNew,
        });
        setIsComposingNew(composingNew);
        setActiveThreadId(newThreadId);
        if (composingNew) {
          setSessionVersion((v) => v + 1);
          setIsFadingOut(false);
          isThreadSwitchTransitionRef.current = false;
          logScrollDebug("thread-switch:new-composition-complete", {
            switchToken,
          });
          return;
        }

        waitingForDataRef.current = true;
        logScrollDebug("thread-switch:waiting-for-data", {
          switchToken,
          newThreadId,
        });
        dataWaitTimerRef.current = window.setTimeout(() => {
          if (threadSwitchTokenRef.current !== switchToken) {
            logScrollDebug("thread-switch:stale-failsafe-skip", {
              switchToken,
            });
            return;
          }
          waitingForDataRef.current = false;
          setIsThreadSwitchRevealing(false);
          setIsFadingOut(false);
          isThreadSwitchTransitionRef.current = false;
          logScrollDebug("thread-switch:failsafe-fired", {
            switchToken,
          });
        }, THREAD_SWITCH_FAILSAFE_MS);
      }, THREAD_SWITCH_FADE_MS);
    },
    [
      activeThreadId,
      isComposingNew,
      isFadingOut,
      clearVariantSwapTimers,
      logScrollDebug,
      setSessionVersion,
      setActiveThreadId,
      setIsComposingNew,
    ],
  );

  const startNew = useCallback(() => {
    switchThread(null, true);
  }, [switchThread]);

  const activeThreadIdForMessages = isAuthenticated ? activeThreadId : null;

  const paginatedMessageFeed = usePaginatedQuery(
    api.chat.listMessages,
    activeThreadIdForMessages ? { threadId: activeThreadIdForMessages } : "skip",
    { initialNumItems: 40 },
  );
  const paginatedFeedResults = paginatedMessageFeed.results as UIMessage[];
  const streamStartOrder = paginatedFeedResults.length > 0
    ? Math.min(...paginatedFeedResults.map((message) => message.order))
    : 0;
  const streamMessages = useStreamingUIMessages(
    api.chat.listMessages,
    !activeThreadIdForMessages || paginatedMessageFeed.status === "LoadingFirstPage"
      ? "skip"
      : {
        threadId: activeThreadIdForMessages,
        paginationOpts: {
          cursor: null,
          numItems: 0,
        },
      },
    { startOrder: streamStartOrder },
  );
  const mergedMessageFeed = useMemo(() => {
    const statusRank = (status: UIMessage["status"]) => {
      if (status === "success" || status === "failed") {
        return 3;
      }
      if (status === "streaming") {
        return 2;
      }
      return 1;
    };

    const combined = [...paginatedFeedResults, ...((streamMessages ?? []) as UIMessage[])].sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      if (a.stepOrder !== b.stepOrder) {
        return a.stepOrder - b.stepOrder;
      }
      return a._creationTime - b._creationTime;
    });

    return combined.reduce<UIMessage[]>((messages, message) => {
      const last = messages.at(-1);
      if (!last || getMessageIdentity(last) !== getMessageIdentity(message)) {
        messages.push(message);
        return messages;
      }

      if (statusRank(message.status) >= statusRank(last.status)) {
        messages[messages.length - 1] = message;
      }
      return messages;
    }, []);
  }, [paginatedFeedResults, streamMessages]);

  const messageFeed = useMemo(
    () => ({ results: mergedMessageFeed }),
    [mergedMessageFeed],
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

  const latestTurnSnapshot = useMemo(
    () => buildLatestTurnSnapshot(visibleMessages),
    [visibleMessages],
  );
  const latestTurnUserMessage = latestTurnSnapshot.latestUserMessage;
  const latestTurnUserMessageId = latestTurnUserMessage?.id;
  const includeTransientAssistantVariants =
    awaitingAssistantThreadId !== null
    && activeThreadIdForMessages === awaitingAssistantThreadId;
  const latestTurnPersistedVariants = latestTurnSnapshot.persistedVariants;
  const latestTurnTransientVariant = includeTransientAssistantVariants
    ? latestTurnSnapshot.latestTransientVariant
    : null;

  useEffect(() => {
    const variantCount = latestTurnPersistedVariants.length;
    const previousCount = latestPersistedVariantCountRef.current;
    latestPersistedVariantCountRef.current = variantCount;

    if (variantCount === 0) {
      clearVariantSwapTimers();
      setLatestResponseVariantSwapPhase(null);
      setAnimateReasoningSummaryOut(false);
      setIsRetryWaitingCursor(false);
      setSelectedLatestVariantId(null);
      return;
    }

    setSelectedLatestVariantId((current) => {
      return resolveSelectedVariantId({
        previousSelectedVariantId: current,
        persistedVariants: latestTurnPersistedVariants,
        freezeAutoLatest: retryFadingMessageKey !== null,
        previousVariantCount: previousCount,
      });
    });
  }, [clearVariantSwapTimers, latestTurnPersistedVariants, retryFadingMessageKey]);

  const selectedLatestResponseVariant = useMemo(() => {
    if (latestTurnPersistedVariants.length === 0) {
      return null;
    }
    if (selectedLatestVariantId) {
      const selected = latestTurnPersistedVariants.find((variant) => variant.id === selectedLatestVariantId);
      if (selected) {
        return selected;
      }
    }
    return latestTurnPersistedVariants.at(-1) ?? null;
  }, [latestTurnPersistedVariants, selectedLatestVariantId]);

  const selectedLatestResponseVariantId = selectedLatestResponseVariant
    ? selectedLatestResponseVariant.id
    : null;

  const selectedLatestResponseVariantListIndex = useMemo(() => {
    if (!selectedLatestResponseVariantId) {
      return -1;
    }
    return latestTurnPersistedVariants.findIndex((variant) => variant.id === selectedLatestResponseVariantId);
  }, [latestTurnPersistedVariants, selectedLatestResponseVariantId]);

  const startLatestResponseVariantSwap = useCallback((targetIndex: number) => {
    if (latestResponseVariantSwapPhase !== null) {
      return;
    }
    if (targetIndex === selectedLatestResponseVariantListIndex) {
      return;
    }
    if (targetIndex < 0 || targetIndex >= latestTurnPersistedVariants.length) {
      return;
    }

    const currentVariant = selectedLatestResponseVariant;
    const targetVariant = latestTurnPersistedVariants[targetIndex] ?? null;
    const shouldAnimateReasoningOut = Boolean(
      currentVariant
      && targetVariant
      && hasMessageReasoningPanelContent(currentVariant.message)
      && !hasMessageReasoningPanelContent(targetVariant.message),
    );

    clearVariantSwapTimers();
    setAnimateReasoningSummaryOut(shouldAnimateReasoningOut);
    setLatestResponseVariantSwapPhase("out");
    latestResponseVariantSwapOutTimerRef.current = window.setTimeout(() => {
      setSelectedLatestVariantId(targetVariant?.id ?? null);
      setLatestResponseVariantSwapPhase("in");
      latestResponseVariantSwapOutTimerRef.current = null;
      latestResponseVariantSwapInTimerRef.current = window.setTimeout(() => {
        setLatestResponseVariantSwapPhase(null);
        setAnimateReasoningSummaryOut(false);
        latestResponseVariantSwapInTimerRef.current = null;
      }, RESPONSE_VARIANT_SWAP_IN_MS);
    }, RESPONSE_VARIANT_SWAP_OUT_MS);
  }, [
    clearVariantSwapTimers,
    latestResponseVariantSwapPhase,
    latestTurnPersistedVariants,
    selectedLatestResponseVariant,
    selectedLatestResponseVariantListIndex,
  ]);

  const displayLatestAssistantMessage = useMemo(() => {
    if (!latestTurnUserMessage) {
      return null;
    }
    if (isRetryWaitingCursor) {
      return selectedLatestResponseVariant?.message ?? latestTurnSnapshot.latestPersistedVariant?.message ?? null;
    }
    if (latestTurnTransientVariant) {
      return latestTurnTransientVariant.message;
    }
    return selectedLatestResponseVariant?.message ?? latestTurnSnapshot.latestPersistedVariant?.message ?? null;
  }, [
    isRetryWaitingCursor,
    latestTurnSnapshot.latestPersistedVariant,
    latestTurnTransientVariant,
    latestTurnUserMessage,
    selectedLatestResponseVariant,
  ]);

  const renderedMessages = useMemo(() => {
    if (!latestTurnUserMessage) {
      return visibleMessages;
    }
    if (!displayLatestAssistantMessage) {
      return latestTurnSnapshot.historyMessages;
    }
    return [...latestTurnSnapshot.historyMessages, displayLatestAssistantMessage];
  }, [displayLatestAssistantMessage, latestTurnSnapshot.historyMessages, latestTurnUserMessage, visibleMessages]);

  const latestTurnAssistantMessage = displayLatestAssistantMessage;

  const latestTurnAssistantIsRenderable = useMemo(() => {
    if (!latestTurnAssistantMessage) {
      return false;
    }
    if (latestTurnAssistantMessage.status === "streaming" || latestTurnAssistantMessage.status === "failed") {
      return true;
    }

    const parsed = parseAssistantOutput(latestTurnAssistantMessage.text ?? "");
    if (parsed.response.trim().length > 0 || parsed.eventNotes.length > 0) {
      return true;
    }
    return getReasoningText(latestTurnAssistantMessage).trim().length > 0;
  }, [latestTurnAssistantMessage]);

  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const hasFreshAssistantForAwaitedTurn = useMemo(() => {
    if (!latestTurnAssistantMessage) {
      return false;
    }
    return getMessageIdentity(latestTurnAssistantMessage) !== awaitingAssistantBaselineKeyRef.current;
  }, [latestTurnAssistantMessage]);

  const hasFreshAssistantStarted = useMemo(() => {
    if (!latestTurnAssistantMessage || !hasFreshAssistantForAwaitedTurn) {
      return false;
    }
    if (latestTurnAssistantMessage.status === "pending" || latestTurnAssistantMessage.status === "streaming") {
      return true;
    }
    return latestTurnAssistantIsRenderable;
  }, [hasFreshAssistantForAwaitedTurn, latestTurnAssistantIsRenderable, latestTurnAssistantMessage]);

  const isAwaitingAssistant =
    awaitingAssistantThreadId !== null
    && activeThreadIdForMessages === awaitingAssistantThreadId
    && !hasFreshAssistantStarted;
  const isWaitingForAssistantMessage =
    awaitingAssistantThreadId !== null
    && activeThreadIdForMessages === awaitingAssistantThreadId
    && !hasFreshAssistantStarted;
  const isOutputting = isSubmitting || isAwaitingAssistant || isStreaming;
  const shouldAutoFollow = isOutputting;
  const showIntro = visibleMessages.length === 0 && !isStreaming;
  const isResearchActive = !!latestResearchJob && !TERMINAL_RESEARCH_STATUSES.has(latestResearchJob.status);

  useEffect(() => {
    if (!awaitingAssistantThreadId || activeThreadIdForMessages !== awaitingAssistantThreadId) {
      return;
    }

    const latestAssistantKey = latestTurnAssistantMessage ? getMessageIdentity(latestTurnAssistantMessage) : null;
    const latestAssistantStatus = latestTurnAssistantMessage?.status ?? null;

    if (
      hasFreshAssistantForAwaitedTurn
      && latestAssistantKey
      && (latestAssistantStatus === "success" || latestAssistantStatus === "failed")
      && latestTurnAssistantIsRenderable
    ) {
      logScrollDebug("awaiting:cleared", {
        reason: "fresh-assistant-renderable",
        threadId: awaitingAssistantThreadId,
        baselineKey: awaitingAssistantBaselineKeyRef.current,
        latestAssistantKey,
      });
      setAwaitingAssistantThreadId(null);
      awaitingAssistantBaselineKeyRef.current = null;
      keepAttachedUntilFreshAssistantRef.current = false;
    }
  }, [
    activeThreadIdForMessages,
    awaitingAssistantThreadId,
    hasFreshAssistantForAwaitedTurn,
    hasFreshAssistantStarted,
    latestTurnAssistantIsRenderable,
    latestTurnAssistantMessage,
    logScrollDebug,
  ]);

  useEffect(() => {
    if (!keepAttachedUntilFreshAssistantRef.current || !hasFreshAssistantStarted) {
      return;
    }
    keepAttachedUntilFreshAssistantRef.current = false;
    if (retryFadingMessageKey !== null) {
      setSelectedLatestVariantId(latestTurnSnapshot.latestPersistedVariant?.id ?? null);
    }
    setRetryFadingMessageKey(null);
    setIsRetryWaitingCursor(false);
    logScrollDebug("awaiting:fresh-started", {
      baselineKey: awaitingAssistantBaselineKeyRef.current,
      latestAssistantKey: latestTurnAssistantMessage ? getMessageIdentity(latestTurnAssistantMessage) : null,
    });
  }, [
    hasFreshAssistantStarted,
    latestTurnAssistantMessage,
    latestTurnPersistedVariants.length,
    latestTurnSnapshot.latestPersistedVariant,
    logScrollDebug,
    retryFadingMessageKey,
  ]);

  useEffect(() => {
    document.body.classList.toggle("chat-switching", isFadingOut);
    return () => {
      document.body.classList.remove("chat-switching");
    };
  }, [isFadingOut]);

  useEffect(() => {
    if (waitingForDataRef.current && visibleMessages.length > 0) {
      const switchToken = threadSwitchTokenRef.current;
      logScrollDebug("thread-switch:data-ready", {
        switchToken,
        visibleMessageCount: visibleMessages.length,
      });
      waitingForDataRef.current = false;
      if (dataWaitTimerRef.current !== null) {
        window.clearTimeout(dataWaitTimerRef.current);
        dataWaitTimerRef.current = null;
      }
      window.requestAnimationFrame(() => {
        if (threadSwitchTokenRef.current !== switchToken) {
          return;
        }

        const resizeLenis = (source: string) => {
          if (!lenis) {
            return;
          }
          const limitBefore = Number(lenis.limit.toFixed(1));
          lenis.resize();
          logScrollDebug("thread-switch:lenis-resize", {
            source,
            switchToken,
            limitBefore,
            limitAfter: Number(lenis.limit.toFixed(1)),
          });
        };

        const finalizeReveal = (
          reason: string,
          options?: {
            forceFinalSnap?: boolean;
          },
        ) => {
          if (threadSwitchTokenRef.current !== switchToken) {
            return;
          }
          if (threadSwitchRevealTimerRef.current !== null) {
            window.clearTimeout(threadSwitchRevealTimerRef.current);
            threadSwitchRevealTimerRef.current = null;
          }

          const bottomDistanceNow = getBottomDistance();
          const shouldForceSnap = Boolean(
            options?.forceFinalSnap
            || reason === "timeout"
            || bottomDistanceNow > THREAD_SWITCH_FINAL_HARD_SNAP_THRESHOLD_PX,
          );

          const completeTransition = (completionReason: string) => {
            if (threadSwitchTokenRef.current !== switchToken) {
              return;
            }
            setIsThreadSwitchRevealing(false);
            setIsFadingOut(false);
            isThreadSwitchTransitionRef.current = false;
            hasCompletedFirstThreadSwitchRef.current = true;
            logScrollDebug("thread-switch:reveal-complete", {
              switchToken,
              reason,
              completionReason,
              forcedSnap: shouldForceSnap,
              bottomDistance: Number(bottomDistanceNow.toFixed(1)),
            });
          };

          if (shouldForceSnap) {
            resizeLenis("finalize-snap-hard");
            scrollToPageBottom({
              immediate: true,
              duration: 0,
              force: true,
              reason: "thread-switch-verify-final-hard",
            });
            completeTransition("hard-final-correction");
            return;
          }

          completeTransition("primary-scroll-complete");
        };

        autoFollowEnabledRef.current = true;
        const feedHeight = feedRef.current?.scrollHeight ?? 0;
        const viewportHeight = window.innerHeight;
        const isFirstThreadReveal = !hasCompletedFirstThreadSwitchRef.current;
        const isLongConversation = feedHeight > viewportHeight * THREAD_SWITCH_LONG_CONVO_VIEWPORT_MULTIPLIER;
        const revealOffset = getThreadSwitchRevealOffset();
        const microScrollOffset = isLongConversation
          ? (isFirstThreadReveal ? Math.min(revealOffset, THREAD_SWITCH_FIRST_REVEAL_OFFSET_PX) : revealOffset)
          : 0;
        const shouldMicroScroll = microScrollOffset > 0;
        const revealDuration = isFirstThreadReveal
          ? THREAD_SWITCH_FIRST_REVEAL_DURATION_S
          : THREAD_SWITCH_REVEAL_DURATION_S;

        resizeLenis("hidden-position");
        scrollToPageBottom({
          immediate: true,
          duration: 0,
          force: true,
          bottomOffsetPx: microScrollOffset,
          reason: "thread-switch-hidden-position",
        });
        lastScrollPositionRef.current = getCurrentScrollPosition();
        setIsThreadSwitchRevealing(true);
        setIsFadingOut(false);
        logScrollDebug("thread-switch:reveal-start", {
          switchToken,
          revealOffset: microScrollOffset,
          shouldMicroScroll,
          isFirstThreadReveal,
          isLongConversation,
          revealDuration,
          feedHeight,
          viewportHeight,
        });

        if (threadSwitchRevealTimerRef.current !== null) {
          window.clearTimeout(threadSwitchRevealTimerRef.current);
        }
        threadSwitchRevealTimerRef.current = window.setTimeout(() => {
          if (threadSwitchTokenRef.current !== switchToken) {
            return;
          }
          logScrollDebug("thread-switch:reveal-timeout", {
            switchToken,
          });
          finalizeReveal("timeout", {
            forceFinalSnap: true,
          });
        }, THREAD_SWITCH_REVEAL_FALLBACK_MS);

        if (!shouldMicroScroll || microScrollOffset <= 0) {
          window.requestAnimationFrame(() => {
            finalizeReveal("no-micro-scroll");
          });
          return;
        }

        window.requestAnimationFrame(() => {
          if (threadSwitchTokenRef.current !== switchToken) {
            return;
          }
          resizeLenis("reveal-micro-scroll");
          scrollToPageBottom({
            force: true,
            lock: true,
            duration: revealDuration,
            reason: "thread-switch-reveal-micro-scroll",
            onComplete: () => {
              if (threadSwitchTokenRef.current !== switchToken) {
                return;
              }
              finalizeReveal("micro-scroll-complete");
            },
          });
        });
      });
    }
  }, [
    getBottomDistance,
    getThreadSwitchRevealOffset,
    getCurrentScrollPosition,
    lenis,
    logScrollDebug,
    scrollToPageBottom,
    visibleMessages.length,
  ]);

  const streamingUpdateKey = useMemo(() => {
    if (!latestTurnAssistantMessage) {
      return "none";
    }
    const length = latestTurnAssistantMessage.text?.length ?? 0;
    return `${latestTurnAssistantMessage.status}:${length}`;
  }, [latestTurnAssistantMessage]);

  useEffect(() => {
    if (
      !shouldAutoFollow
      || !autoFollowEnabledRef.current
      || isFadingOut
      || isThreadSwitchTransitionRef.current
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (lenis) {
        lenis.resize();
      }
      scrollToPageBottom({
        force: true,
        duration: AUTO_FOLLOW_STREAM_DURATION_S,
        reason: "stream-follow",
      });
    });
  }, [
    isFadingOut,
    lenis,
    scrollToPageBottom,
    shouldAutoFollow,
    streamingUpdateKey,
    visibleMessages.length,
  ]);

  // Content-growth auto-follow via ResizeObserver.
  // Catches smooth-text typewriter growth AFTER the backend stream has ended
  // (when shouldAutoFollow is already false but content is still expanding).
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || typeof ResizeObserver === "undefined") {
      return;
    }

    let prevHeight = 0;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const h = entry.contentRect.height;
      const grew = h > prevHeight + 2;
      prevHeight = h;

      if (!grew) return;
      if (!autoFollowEnabledRef.current) return;
      if (isThreadSwitchTransitionRef.current) return;

      requestAnimationFrame(() => {
        if (!autoFollowEnabledRef.current) return;
        if (isThreadSwitchTransitionRef.current) return;

        if (lenis) {
          lenis.resize();
        }
        scrollToPageBottom({
          force: true,
          duration: AUTO_FOLLOW_STREAM_DURATION_S,
          reason: "content-growth-follow",
        });
      });
    });

    ro.observe(feed);
    return () => ro.disconnect();
  }, [lenis, scrollToPageBottom]);

  useEffect(() => {
    if (!keepAttachedUntilFreshAssistantRef.current) {
      return;
    }
    if (!awaitingAssistantThreadId || activeThreadIdForMessages !== awaitingAssistantThreadId) {
      return;
    }
    if (isThreadSwitchTransitionRef.current || isFadingOut) {
      return;
    }

    autoFollowEnabledRef.current = true;
    if (!isFeedEndVisibleRef.current) {
      logScrollDebug("awaiting:follow-reconcile", {
        threadId: awaitingAssistantThreadId,
      });
      window.requestAnimationFrame(() => {
        if (lenis) {
          lenis.resize();
        }
        scrollToPageBottom({
          force: true,
          duration: AUTO_FOLLOW_STREAM_DURATION_S,
          reason: "awaiting-follow",
        });
      });
    }
  }, [
    activeThreadIdForMessages,
    awaitingAssistantThreadId,
    isFadingOut,
    lenis,
    logScrollDebug,
    scrollToPageBottom,
    visibleMessages.length,
  ]);

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
    const markUserUpIntent = (source: string, details?: Record<string, unknown>) => {
      autoFollowLastUserIntentRef.current = Date.now();
      logScrollDebug("follow:user-up-intent", {
        source,
        ...(details ?? {}),
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        markUserUpIntent("wheel", {
          deltaY: event.deltaY,
        });
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (
        event.key === "ArrowUp"
        || event.key === "PageUp"
        || event.key === "Home"
        || (event.key === " " && event.shiftKey)
      ) {
        markUserUpIntent("keyboard", {
          key: event.key,
        });
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchLastYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (typeof currentY !== "number") {
        return;
      }
      const previousY = touchLastYRef.current;
      if (typeof previousY === "number" && currentY - previousY > 2) {
        markUserUpIntent("touch", {
          deltaY: currentY - previousY,
        });
      }
      touchLastYRef.current = currentY;
    };

    const clearTouchTrack = () => {
      touchLastYRef.current = null;
    };

    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", clearTouchTrack, { passive: true });
    window.addEventListener("touchcancel", clearTouchTrack, { passive: true });

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", clearTouchTrack);
      window.removeEventListener("touchcancel", clearTouchTrack);
    };
  }, [logScrollDebug]);

  useEffect(() => {
    const markFeedScrolling = () => {
      setIsFeedScrolling((current) => (current ? current : true));
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = window.setTimeout(() => {
        setIsFeedScrolling(false);
      }, 140);
    };

    const syncFollowFromCurrentPosition = () => {
      const current = getCurrentScrollPosition();
      if (isThreadSwitchTransitionRef.current) {
        lastScrollPositionRef.current = current;
        return;
      }

      const wasAttached = autoFollowEnabledRef.current;
      const bottomDistance = getBottomDistance();
      const movedUp = current < lastScrollPositionRef.current - 1;
      const hasRecentUserUpIntent = Date.now() - autoFollowLastUserIntentRef.current <= AUTO_FOLLOW_USER_INTENT_WINDOW_MS;
      const isProgrammaticWindow = Date.now() <= autoFollowProgrammaticUntilRef.current;
      autoFollowEnabledRef.current = getNextAutoFollowEnabled({
        wasEnabled: autoFollowEnabledRef.current,
        isOutputting: shouldAutoFollow,
        movedUp: movedUp && hasRecentUserUpIntent && !isProgrammaticWindow,
        bottomDistance,
        attachThresholdPx: AUTO_FOLLOW_ATTACH_THRESHOLD_PX,
        detachThresholdPx: AUTO_FOLLOW_DETACH_THRESHOLD_PX,
      });

      if (wasAttached !== autoFollowEnabledRef.current) {
        logScrollDebug("follow:attach-changed", {
          wasAttached,
          isAttached: autoFollowEnabledRef.current,
          movedUp,
          hasRecentUserUpIntent,
          isProgrammaticWindow,
          bottomDistance: Number(bottomDistance.toFixed(1)),
          shouldAutoFollow,
        });
      }

      lastScrollPositionRef.current = current;
      markFeedScrolling();
    };

    const syncCurrentWithoutMarking = () => {
      const current = getCurrentScrollPosition();
      lastScrollPositionRef.current = current;
      if (isNearBottom(AUTO_FOLLOW_ATTACH_THRESHOLD_PX)) {
        autoFollowEnabledRef.current = true;
      }
    };

    syncCurrentWithoutMarking();

    let unsubscribeLenis: (() => void) | null = null;
    if (lenis) {
      unsubscribeLenis = lenis.on("scroll", syncFollowFromCurrentPosition);
    } else {
      window.addEventListener("scroll", syncFollowFromCurrentPosition, { passive: true });
    }

    const handleResize = () => {
      if (isThreadSwitchTransitionRef.current) {
        logScrollDebug("resize:skipped-transition", {});
        return;
      }
      if (isNearBottom(AUTO_FOLLOW_ATTACH_THRESHOLD_PX)) {
        autoFollowEnabledRef.current = true;
      }
      if (autoFollowEnabledRef.current) {
        logScrollDebug("resize:follow", {});
        scrollToPageBottom({
          force: true,
          duration: AUTO_FOLLOW_STREAM_DURATION_S,
          reason: "resize-follow",
        });
      }

      lastScrollPositionRef.current = getCurrentScrollPosition();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      if (unsubscribeLenis) {
        unsubscribeLenis();
      } else {
        window.removeEventListener("scroll", syncFollowFromCurrentPosition);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, [
    getBottomDistance,
    getCurrentScrollPosition,
    isNearBottom,
    lenis,
    logScrollDebug,
    scrollToPageBottom,
    shouldAutoFollow,
  ]);

  useEffect(() => {
    const resumeFollow = () => {
      if (document.visibilityState === "hidden") {
        logScrollDebug("visibility:resume-skipped-hidden", {});
        return;
      }
      if (!activeThreadIdForMessages) {
        logScrollDebug("visibility:resume-skipped-no-thread", {});
        return;
      }
      if (isThreadSwitchTransitionRef.current || isFadingOut) {
        logScrollDebug("visibility:resume-skipped-transition", {});
        return;
      }
      if (!autoFollowEnabledRef.current) {
        logScrollDebug("visibility:resume-skipped-detached", {});
        return;
      }
      if (!wasAtBottomOnHiddenRef.current && !isNearBottom(AUTO_FOLLOW_RESUME_THRESHOLD_PX)) {
        logScrollDebug("visibility:resume-skipped-away-from-bottom", {
          wasAtBottomOnHidden: wasAtBottomOnHiddenRef.current,
        });
        return;
      }
      if (isFeedEndVisibleRef.current) {
        logScrollDebug("visibility:resume-skipped-anchor-visible", {});
        return;
      }

      logScrollDebug("visibility:resume-follow", {});
      scrollToPageBottom({
        force: true,
        duration: AUTO_FOLLOW_STREAM_DURATION_S,
        reason: "visibility-resume-follow",
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasAtBottomOnHiddenRef.current = isNearBottom(AUTO_FOLLOW_RESUME_THRESHOLD_PX);
        logScrollDebug("visibility:hidden", {
          wasAtBottomOnHidden: wasAtBottomOnHiddenRef.current,
        });
        return;
      }
      resumeFollow();
    };

    const handleFocus = () => {
      resumeFollow();
    };

    const handlePageShow = () => {
      resumeFollow();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [activeThreadIdForMessages, isFadingOut, isNearBottom, logScrollDebug, scrollToPageBottom]);

  useEffect(() => {
    const handleKeydownCapture = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key.length !== 1) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return;
      }

      event.preventDefault();
      setDraft((current) => `${current}${event.key}`);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        const cursorPos = textarea.value.length;
        textarea.setSelectionRange(cursorPos, cursorPos);
        textarea.style.height = "28px";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
      });
    };

    window.addEventListener("keydown", handleKeydownCapture);
    return () => {
      window.removeEventListener("keydown", handleKeydownCapture);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearVariantSwapTimers();
      if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
      if (threadSwitchRevealTimerRef.current !== null) window.clearTimeout(threadSwitchRevealTimerRef.current);
      isThreadSwitchTransitionRef.current = false;
      keepAttachedUntilFreshAssistantRef.current = false;
    };
  }, [clearVariantSwapTimers]);

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
    setRetryFadingMessageKey(null);
    setIsRetryWaitingCursor(false);
    clearVariantSwapTimers();
    setLatestResponseVariantSwapPhase(null);
    setAnimateReasoningSummaryOut(false);
    autoFollowEnabledRef.current = true;
    autoFollowLastUserIntentRef.current = 0;
    keepAttachedUntilFreshAssistantRef.current = true;
    logScrollDebug("send:start", {
      promptLength: prompt.length,
      activeThreadIdForMessages,
    });
    window.requestAnimationFrame(() => {
      scrollToPageBottom({
        force: true,
        duration: AUTO_FOLLOW_SEND_DURATION_S,
        reason: "send-initial-follow",
      });
      lastScrollPositionRef.current = getCurrentScrollPosition();
    });
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
    }
    setIsSubmitting(true);

    try {
      let threadId = activeThreadIdForMessages;
      if (!threadId) {
        const created = await createThread({});
        threadId = created.threadId;
        logScrollDebug("send:create-thread", {
          threadId,
        });
        threadSwitchTokenRef.current += 1;
        isThreadSwitchTransitionRef.current = true;
        setIsFadingOut(true);
        setIsThreadSwitchRevealing(false);
        waitingForDataRef.current = true;
        if (dataWaitTimerRef.current !== null) {
          window.clearTimeout(dataWaitTimerRef.current);
        }
        if (threadSwitchRevealTimerRef.current !== null) {
          window.clearTimeout(threadSwitchRevealTimerRef.current);
        }
        dataWaitTimerRef.current = window.setTimeout(() => {
          waitingForDataRef.current = false;
          setIsThreadSwitchRevealing(false);
          setIsFadingOut(false);
          isThreadSwitchTransitionRef.current = false;
          keepAttachedUntilFreshAssistantRef.current = false;
          dataWaitTimerRef.current = null;
          logScrollDebug("send:create-thread-failsafe", {
            threadId,
          });
        }, THREAD_SWITCH_FAILSAFE_MS);
        setIsComposingNew(false);
        setActiveThreadId(threadId);
      }

      if (!threadId) {
        return;
      }

      awaitingAssistantBaselineKeyRef.current = latestTurnAssistantMessage
        ? getMessageIdentity(latestTurnAssistantMessage)
        : null;
      setAwaitingAssistantThreadId(threadId);
      logScrollDebug("awaiting:set", {
        threadId,
        baselineKey: awaitingAssistantBaselineKeyRef.current,
      });
      logScrollDebug("send:dispatch", {
        threadId,
      });
      await sendPrompt({ threadId, prompt });
      logScrollDebug("send:dispatched", {
        threadId,
      });
    } catch (error) {
      setAwaitingAssistantThreadId(null);
      awaitingAssistantBaselineKeyRef.current = null;
      keepAttachedUntilFreshAssistantRef.current = false;
      logScrollDebug("send:error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      setIsSubmitting(false);
      logScrollDebug("send:finally", {
        isSubmitting: false,
      });
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

  const handleRetry = useCallback(
    async (targetMessage: UIMessage) => {
      if (targetMessage.role !== "assistant" || isSubmitting) {
        return;
      }

      const threadId = activeThreadIdForMessages;
      const promptMessageId = latestTurnUserMessageId;
      const targetMessageId = getMessageIdentity(targetMessage);
      const isLatestTurnVariant = latestTurnPersistedVariants.some(
        (variant) => variant.id === targetMessageId,
      );

      if (!threadId || typeof promptMessageId !== "string" || !isLatestTurnVariant) {
        logScrollDebug("retry:ignored", {
          reason: !threadId
            ? "missing-thread"
            : typeof promptMessageId !== "string"
              ? "missing-latest-user-id"
              : "non-latest-turn",
          targetKey: targetMessageId,
        });
        return;
      }

      setIsSubmitting(true);
      setRetryFadingMessageKey(targetMessageId);
      setIsRetryWaitingCursor(false);
      clearVariantSwapTimers();
      setLatestResponseVariantSwapPhase(null);
      setAnimateReasoningSummaryOut(false);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, RETRY_FADE_OUT_MS);
      });
      setIsRetryWaitingCursor(true);

      autoFollowEnabledRef.current = true;
      autoFollowLastUserIntentRef.current = 0;
      keepAttachedUntilFreshAssistantRef.current = true;
      awaitingAssistantBaselineKeyRef.current = latestTurnAssistantMessage
        ? getMessageIdentity(latestTurnAssistantMessage)
        : targetMessageId;
      setAwaitingAssistantThreadId(threadId);

      logScrollDebug("retry:start", {
        threadId,
        promptMessageId,
        baselineKey: awaitingAssistantBaselineKeyRef.current,
        targetKey: targetMessageId,
      });

      window.requestAnimationFrame(() => {
        scrollToPageBottom({
          force: true,
          duration: AUTO_FOLLOW_SEND_DURATION_S,
          reason: "retry-initial-follow",
        });
        lastScrollPositionRef.current = getCurrentScrollPosition();
      });

      let keepFadedUntilFreshAssistant = false;

      try {
        const result = await retryPrompt({
          threadId,
          promptMessageId,
        });

        logScrollDebug("retry:dispatched", {
          threadId,
          promptMessageId,
          accepted: result.accepted,
          reason: result.reason,
        });

        if (result.accepted || result.reason === "already_pending") {
          keepFadedUntilFreshAssistant = true;
        }

        if (!result.accepted && result.reason !== "already_pending") {
          setAwaitingAssistantThreadId(null);
          awaitingAssistantBaselineKeyRef.current = null;
          keepAttachedUntilFreshAssistantRef.current = false;
          setRetryFadingMessageKey((current) => (current === targetMessageId ? null : current));
          setIsRetryWaitingCursor(false);
        }
      } catch (error) {
        setAwaitingAssistantThreadId(null);
        awaitingAssistantBaselineKeyRef.current = null;
        keepAttachedUntilFreshAssistantRef.current = false;
        setRetryFadingMessageKey((current) => (current === targetMessageId ? null : current));
        setIsRetryWaitingCursor(false);
        logScrollDebug("retry:error", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        setIsSubmitting(false);
        if (!keepFadedUntilFreshAssistant) {
          setRetryFadingMessageKey((current) => (current === targetMessageId ? null : current));
          setIsRetryWaitingCursor(false);
        }
        logScrollDebug("retry:finally", {
          isSubmitting: false,
          keepFadedUntilFreshAssistant,
          isRetryWaitingCursor,
        });
      }
    },
    [
      activeThreadIdForMessages,
      clearVariantSwapTimers,
      getCurrentScrollPosition,
      isSubmitting,
      latestTurnAssistantMessage,
      setLatestResponseVariantSwapPhase,
      latestTurnPersistedVariants,
      latestTurnUserMessageId,
      isRetryWaitingCursor,
      logScrollDebug,
      retryPrompt,
      scrollToPageBottom,
    ],
  );

  return (
    <div className="oracle-shell">
      <div className="noise-overlay" />
      <div className="grid-bg" />
      <ChatCanvas pause={isFeedScrolling || isFadingOut || isThreadSwitchRevealing} />

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
            className={clsx(
              "chat-feed",
              (isFadingOut || isThreadSwitchRevealing) && "thread-switch-active",
              isFadingOut && "fading-out",
              isThreadSwitchRevealing && "revealing",
              latestResearchJob && "with-research-dock",
            )}
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
              <>
                {renderedMessages.map((message) => {
                  const messageId = getMessageIdentity(message);
                  const isSelectedLatestVariant =
                    message.role === "assistant"
                    && selectedLatestResponseVariantId !== null
                    && messageId === selectedLatestResponseVariantId;
                  const showInlinePendingCursor =
                    isSelectedLatestVariant
                    && isRetryWaitingCursor
                    && retryFadingMessageKey === messageId;

                  const renderKey = messageId;

                  const canRetryMessage =
                    isSelectedLatestVariant
                    && !isOutputting
                    && !isFadingOut
                    && !isThreadSwitchTransitionRef.current;

                  const isVariantSwapInProgress =
                    isSelectedLatestVariant
                    && latestResponseVariantSwapPhase !== null;

                  const variantControls =
                    isSelectedLatestVariant
                    && latestTurnPersistedVariants.length > 1
                    && selectedLatestResponseVariantListIndex >= 0
                      ? {
                        current: selectedLatestResponseVariantListIndex + 1,
                        total: latestTurnPersistedVariants.length,
                        canPrev: selectedLatestResponseVariantListIndex > 0 && !isVariantSwapInProgress,
                        canNext: selectedLatestResponseVariantListIndex < latestTurnPersistedVariants.length - 1 && !isVariantSwapInProgress,
                        onPrev: () => {
                          startLatestResponseVariantSwap(selectedLatestResponseVariantListIndex - 1);
                        },
                        onNext: () => {
                          startLatestResponseVariantSwap(selectedLatestResponseVariantListIndex + 1);
                        },
                      }
                      : undefined;

                  return (
                    <Message
                      key={renderKey}
                      message={message}
                      onCopy={() => {
                        navigator.clipboard.writeText(message.text ?? "");
                      }}
                      onRetry={isSelectedLatestVariant ? () => {
                        void handleRetry(message);
                      } : undefined}
                      hideActions={isOutputting}
                      showInlinePendingCursor={showInlinePendingCursor}
                      canRetry={canRetryMessage}
                      variantControls={variantControls}
                      isRetryFading={retryFadingMessageKey === messageId}
                      animateReasoningSummaryOut={isSelectedLatestVariant && animateReasoningSummaryOut}
                      variantSwapPhase={isSelectedLatestVariant ? latestResponseVariantSwapPhase : null}
                    />
                  );
                })}
                {isWaitingForAssistantMessage
                  && !isRetryWaitingCursor
                  && retryFadingMessageKey === null
                  && selectedLatestResponseVariantId === null
                  && (
                  <div className="message ai pending-assistant">
                    <div className="response-container">
                      <div className="message-meta">Aura Response</div>
                      <div className="message-content">
                        <span className="typewriter-cursor" aria-label="Generating response" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={feedEndRef} className="chat-feed-end" aria-hidden />
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
