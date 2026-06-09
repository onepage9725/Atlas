import { useEffect, useMemo, useState } from "react";
import { Save, Trash2, Pencil, Upload } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { getMemberRankSummary, type MemberRankSummary, type RankCase, type RankPayout, type RankProfile } from "../lib/memberRanks";

const roleOptions = ["super_admin", "admin", "leader", "agent"] as const;
const createRoleOptions = ["super_admin", "admin", "agent"] as const;
const memberRankOptions = ["agent", "pre_leader", "leader"] as const;

const getDefaultMemberRankForRole = (role: string | null | undefined): (typeof memberRankOptions)[number] =>
  role === "super_admin" ? "leader" : "agent";

type UserProfile = RankProfile & {
  name: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  is_active: boolean | null;
  avatar_url: string | null;
  avatar_position_x: number | null;
  avatar_position_y: number | null;
  avatar_zoom: number | null;
};

const shouldAutoManageRank = (profile: Pick<UserProfile, "role" | "rank">) => {
  if (profile.role === "admin" || profile.role === "super_admin") {
    return false;
  }

  return (
    profile.role === "agent" ||
    profile.role === "leader" ||
    profile.rank === "agent" ||
    profile.rank === "pre_leader" ||
    profile.rank === "leader"
  );
};

const isLeaderProfile = (profile: Pick<UserProfile, "role" | "rank"> | null | undefined) =>
  Boolean(profile && (profile.rank === "leader" || profile.role === "leader"));

const isPreLeaderProfile = (profile: Pick<UserProfile, "rank"> | null | undefined) =>
  Boolean(profile && profile.rank === "pre_leader");

const isAgentProfile = (profile: Pick<UserProfile, "role" | "rank"> | null | undefined) =>
  Boolean(profile && (profile.rank === "agent" || profile.role === "agent"));

const formatRankLabel = (value: string | null | undefined) => (value ? value.replace("_", " ") : "-");

const getResolvedMemberRank = (
  profile: UserProfile,
  memberRankSummary: MemberRankSummary | undefined
) => {
  if (!shouldAutoManageRank(profile)) {
    return null;
  }

  return memberRankSummary?.rank ?? profile.rank ?? null;
};

const formatPointValue = (value: number | null | undefined) => {
  const numericValue = Number(value ?? 0);
  const minimumFractionDigits = Number.isInteger(numericValue) ? 0 : 2;

  return numericValue.toLocaleString("en-MY", {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  });
};

export function UsersForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<(typeof roleOptions)[number]>("admin");
  const [rank, setRank] = useState<(typeof memberRankOptions)[number]>("agent");
  const [recruitById, setRecruitById] = useState("");
  const [personalPoints, setPersonalPoints] = useState("");
  const [groupPoints, setGroupPoints] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [rankCases, setRankCases] = useState<RankCase[]>([]);
  const [rankPayouts, setRankPayouts] = useState<RankPayout[]>([]);
  const [supportsGroupPoints, setSupportsGroupPoints] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarName, setEditAvatarName] = useState("");
  const [editRole, setEditRole] = useState<(typeof roleOptions)[number]>("admin");
  const [editRank, setEditRank] = useState<(typeof memberRankOptions)[number]>("agent");
  const [editRecruitById, setEditRecruitById] = useState("");
  const [editPersonalPoints, setEditPersonalPoints] = useState("");
  const [editGroupPoints, setEditGroupPoints] = useState("");
  const [editBankName, setEditBankName] = useState("");
  const [editBankAccountNumber, setEditBankAccountNumber] = useState("");
  const [editAvatarX, setEditAvatarX] = useState(50);
  const [editAvatarY, setEditAvatarY] = useState(50);
  const [editAvatarZoom, setEditAvatarZoom] = useState(1);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isTogglingActiveId, setIsTogglingActiveId] = useState<string | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<(typeof profiles)[number] | null>(null);
  const [deleteProfileConfirmationText, setDeleteProfileConfirmationText] = useState("");
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [rankFilter, setRankFilter] = useState<"all" | (typeof memberRankOptions)[number]>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");

  const shouldRequireRank = role === "agent" || role === "leader";
  const shouldSelectRecruiter = role === "agent" || role === "leader";
  const shouldRequireGroupPoints = shouldRequireRank && (rank === "pre_leader" || rank === "leader");
  const shouldShowGroupPoints = shouldRequireGroupPoints && supportsGroupPoints;

  const profilesById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const memberRankSummaries = useMemo(() => {
    const map = new Map<string, MemberRankSummary>();

    profiles.forEach((profile) => {
      if (!shouldAutoManageRank(profile)) {
        return;
      }

      map.set(profile.id, getMemberRankSummary(profile, profiles, rankCases, rankPayouts));
    });

    return map;
  }, [profiles, rankCases, rankPayouts]);

  const eligibleRecruiters = useMemo(
    () => profiles.filter((profile) => profile.role !== "admin"),
    [profiles]
  );

  const filteredProfiles = useMemo(() => {
    const normalizedSearch = userSearchTerm.trim().toLowerCase();

    return profiles.filter((profile) => {
      const profileRank = getResolvedMemberRank(profile, memberRankSummaries.get(profile.id));

      if (rankFilter !== "all" && profileRank !== rankFilter) {
        return false;
      }

      const isActive = profile.is_active ?? true;

      if (activeFilter === "active" && !isActive) {
        return false;
      }

      if (activeFilter === "inactive" && isActive) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const profileName = (profile.name || "").toLowerCase();
      const profileEmail = (profile.email || "").toLowerCase();

      return profileName.includes(normalizedSearch) || profileEmail.includes(normalizedSearch);
    });
  }, [activeFilter, memberRankSummaries, profiles, rankFilter, userSearchTerm]);

  const directorySummaryCounts = useMemo(() => {
    let adminCount = 0;
    let leaderCount = 0;
    let preLeaderCount = 0;
    let agentCount = 0;

    profiles.forEach((profile) => {
      if (profile.role === "admin") {
        adminCount += 1;
        return;
      }

      if (!shouldAutoManageRank(profile)) {
        return;
      }

      const resolvedRank = memberRankSummaries.get(profile.id)?.rank ?? (profile.rank === "pre_leader" || profile.rank === "leader" ? profile.rank : "agent");

      if (resolvedRank === "leader") {
        leaderCount += 1;
        return;
      }

      if (resolvedRank === "pre_leader") {
        preLeaderCount += 1;
        return;
      }

      agentCount += 1;
    });

    return { adminCount, leaderCount, preLeaderCount, agentCount };
  }, [memberRankSummaries, profiles]);

  const getProfileLabel = (profileId: string | null | undefined) => {
    if (!profileId) return "-";
    const profile = profilesById.get(profileId);
    return profile?.name || profile?.email || "-";
  };

  const getLeaderProfileId = (
    profile: UserProfile,
    visitedIds = new Set<string>()
  ) => {
    if (visitedIds.has(profile.id)) {
      return null;
    }

    const nextVisitedIds = new Set(visitedIds);
    nextVisitedIds.add(profile.id);

    if (isLeaderProfile(profile)) {
      return profile.id;
    }

    const recruiter = profile.recruit_by ? profilesById.get(profile.recruit_by) : null;
    if (!recruiter) {
      return null;
    }

    if (isLeaderProfile(recruiter)) {
      return recruiter.id;
    }

    if (isPreLeaderProfile(recruiter)) {
      const leader = recruiter.recruit_by ? profilesById.get(recruiter.recruit_by) : null;
      return isLeaderProfile(leader) ? leader?.id ?? null : recruiter.recruit_by ?? null;
    }

    if (isAgentProfile(recruiter)) {
      return getLeaderProfileId(recruiter, nextVisitedIds);
    }

    return null;
  };

  const selectedRecruiter = recruitById ? profilesById.get(recruitById) : null;
  const selectedLeaderId = selectedRecruiter ? getLeaderProfileId(selectedRecruiter) : null;

  const newMemberRankPreview = useMemo(() => {
    if (!shouldRequireRank) {
      return null;
    }

    const parsedPersonalPoints = Number(personalPoints);
    const parsedGroupPoints = Number(groupPoints);

    if (!Number.isFinite(parsedPersonalPoints) || parsedPersonalPoints < 0) {
      return null;
    }

    if (shouldShowGroupPoints && (!Number.isFinite(parsedGroupPoints) || parsedGroupPoints < 0)) {
      return null;
    }

    const draftProfile: UserProfile = {
      id: "draft-member",
      name: null,
      email: email || null,
      role,
      rank,
      recruit_by: shouldSelectRecruiter ? recruitById || null : null,
      personal_points: parsedPersonalPoints,
      group_points: shouldShowGroupPoints ? parsedGroupPoints : 0,
      bank_name: null,
      bank_account_number: null,
      is_active: true,
      avatar_url: null,
      avatar_position_x: null,
      avatar_position_y: null,
      avatar_zoom: null,
    };

    return getMemberRankSummary(draftProfile, [...profiles, draftProfile], rankCases, rankPayouts);
  }, [email, groupPoints, personalPoints, profiles, rank, rankCases, rankPayouts, recruitById, role, shouldRequireRank, shouldSelectRecruiter, shouldShowGroupPoints]);

  const getStoragePathFromUrl = (url: string, bucket: string) => {
    if (!url) {
      return null;
    }

    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
    ];

    for (const marker of markers) {
      const index = url.indexOf(marker);
      if (index !== -1) {
        return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
      }
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return decodeURIComponent(url.split("?")[0]);
    }

    return null;
  };

  const deleteAvatarFromStorage = async (url: string | null) => {
    if (!url) return;
    const path = getStoragePathFromUrl(url, "avatars");
    if (!path) return;
    await supabase.storage.from("avatars").remove([path]);
  };

  const getAvatarPreviewUrl = (url: string | null) => {
    if (!url) {
      return null;
    }

    const path = getStoragePathFromUrl(url, "avatars");

    if (!path) {
      return url;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  };

  const fetchProfiles = async () => {
    const [profileResult, caseResult, payoutResult] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, name, email, role, rank, recruit_by, personal_points, group_points, bank_name, bank_account_number, is_active, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("sales_cases").select("id, created_by, involved_user_ids, status"),
      supabase
        .from("sales_case_payouts")
        .select("sales_case_id, profile_id, payout_type, payout_status, total_amount"),
    ]);

    let profileData = profileResult.data as UserProfile[] | null;

    if (profileResult.error) {
      const fallbackResult = await supabase
        .from("profiles")
        .select(
          "id, name, email, role, rank, recruit_by, personal_points, bank_name, bank_account_number, is_active, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (fallbackResult.error) {
        setError(fallbackResult.error.message);
        return;
      }

      profileData = (fallbackResult.data ?? []).map((profile) => ({
        ...(profile as UserProfile),
        group_points: 0,
      }));
      setSupportsGroupPoints(false);
    } else {
      setSupportsGroupPoints(true);
    }

    if (caseResult.error) {
      setError(caseResult.error.message);
      return;
    }

    if (payoutResult.error) {
      setError(payoutResult.error.message);
      return;
    }

    const nextProfiles = ((profileData ?? []) as UserProfile[]).map((profile) => ({
      ...profile,
      avatar_url: getAvatarPreviewUrl(profile.avatar_url),
    }));
    const nextCases = (caseResult.data ?? []) as RankCase[];
    const nextPayouts = (payoutResult.data ?? []) as RankPayout[];

    setProfiles(nextProfiles);
    setRankCases(nextCases);
    setRankPayouts(nextPayouts);
  };

  const startEditing = (profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    role: string | null;
    rank: string | null;
    recruit_by: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
    avatar_position_x: number | null;
    avatar_position_y: number | null;
    avatar_zoom: number | null;
    personal_points?: number | null;
    group_points?: number | null;
  }) => {
    setEditingId(profile.id);
    setEditName(profile.name ?? "");
    setEditAvatarUrl(profile.avatar_url ?? null);
    setEditAvatarFile(null);
    setEditAvatarName("");
    setEditRole((profile.role ?? "admin") as (typeof roleOptions)[number]);
    setEditRank(
      (profile.rank === "pre_leader" || profile.rank === "leader"
        ? profile.rank
        : getDefaultMemberRankForRole(profile.role)) as (typeof memberRankOptions)[number]
    );
    setEditRecruitById(profile.recruit_by ?? "");
    setEditPersonalPoints((profile.personal_points ?? 0).toString());
    setEditGroupPoints((profile.group_points ?? 0).toString());
    setEditBankName(profile.bank_name ?? "");
    setEditBankAccountNumber(profile.bank_account_number ?? "");
    setEditAvatarX(profile.avatar_position_x ?? 50);
    setEditAvatarY(profile.avatar_position_y ?? 50);
    setEditAvatarZoom(profile.avatar_zoom ?? 1);
    setError(null);
    setSuccess(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditAvatarUrl(null);
    setEditAvatarFile(null);
    setEditAvatarName("");
    setEditRole("admin");
    setEditRank(getDefaultMemberRankForRole("admin"));
    setEditRecruitById("");
    setEditPersonalPoints("");
    setEditGroupPoints("");
    setEditBankName("");
    setEditBankAccountNumber("");
    setEditAvatarX(50);
    setEditAvatarY(50);
    setEditAvatarZoom(1);
  };

  const handleEditAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setEditAvatarFile(file);
    setEditAvatarName(file ? file.name : "");
  };

  const uploadAvatar = async (userId: string) => {
    if (!editAvatarFile) return { newUrl: editAvatarUrl, oldUrl: null };

    const filePath = `${userId}/${Date.now()}-${editAvatarFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, editAvatarFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    return { newUrl: data.publicUrl, oldUrl: editAvatarUrl };
  };

  const handleSaveProfile = async () => {
    if (!editingId) return;

    const parsedPersonalPoints = Number(editPersonalPoints);
    const parsedGroupPoints = Number(editGroupPoints);

    if ((editRole === "agent" || editRole === "leader") && (!Number.isFinite(parsedPersonalPoints) || parsedPersonalPoints < 0)) {
      setError("Please enter valid personal points for this member.");
      return;
    }

    if ((editRole === "agent" || editRole === "leader") && (editRank === "pre_leader" || editRank === "leader") && supportsGroupPoints && (!Number.isFinite(parsedGroupPoints) || parsedGroupPoints < 0)) {
      setError("Please enter valid group points for this member.");
      return;
    }

    setIsSavingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      const { newUrl, oldUrl } = await uploadAvatar(editingId);
      const updatePayload: Record<string, unknown> = {
        name: editName,
        role: editRole,
        rank: editRole === "super_admin" ? "leader" : editRole === "admin" ? null : editRank,
        recruit_by:
          editRole === "agent" || editRole === "leader" ? editRecruitById || null : null,
        personal_points: editRole === "agent" || editRole === "leader" ? parsedPersonalPoints : 0,
        bank_name: editBankName || null,
        bank_account_number: editBankAccountNumber || null,
        avatar_url: newUrl,
        avatar_position_x: editAvatarX,
        avatar_position_y: editAvatarY,
        avatar_zoom: editAvatarZoom,
      };

      if (supportsGroupPoints) {
        updatePayload.group_points =
          editRole === "agent" || editRole === "leader"
            ? editRank === "pre_leader" || editRank === "leader"
              ? parsedGroupPoints
              : 0
            : 0;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setIsSavingProfile(false);
        return;
      }

      setSuccess("Profile updated successfully.");
      await fetchProfiles();
      if (newUrl && oldUrl && newUrl !== oldUrl) {
        await deleteAvatarFromStorage(oldUrl);
      }
      setIsSavingProfile(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      setIsSavingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!pendingDeleteProfile) {
      return;
    }

    if (deleteProfileConfirmationText !== "CONFIRM") {
      setError('Please type "CONFIRM" before deleting this user.');
      return;
    }

    const profileId = pendingDeleteProfile.id;
    const profile = pendingDeleteProfile;

    setIsDeletingId(profileId);
    setError(null);
    setSuccess(null);

    const { data, error: functionError } = await supabase.functions.invoke("clever-service", {
      body: {
        action: "delete-user",
        userId: profileId,
        profileId,
        email: profile.email,
      },
    });

    if (functionError) {
      setError(functionError.message);
      setIsDeletingId(null);
      return;
    }

    if (data?.error) {
      setError(data.error);
      setIsDeletingId(null);
      return;
    }

    try {
      if (profile?.avatar_url) {
        await deleteAvatarFromStorage(profile.avatar_url);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `User deleted, but profile picture cleanup failed: ${err.message}`
          : "User deleted, but profile picture cleanup failed."
      );
      await fetchProfiles();
      if (editingId === profileId) {
        cancelEditing();
      }
      setIsDeletingId(null);
      return;
    }

    setSuccess("User deleted successfully.");
    await fetchProfiles();
    if (editingId === profileId) {
      cancelEditing();
    }
    setPendingDeleteProfile(null);
    setDeleteProfileConfirmationText("");
    setIsDeletingId(null);
  };

  const handleToggleActive = async (profile: UserProfile) => {
    const nextIsActive = !(profile.is_active ?? true);
    const isConfirmed = window.confirm(
      nextIsActive
        ? "Are you sure you want to activate this account? The user will be able to log in again."
        : "Are you sure you want to deactivate this account? The user will not be able to log in until the account is activated again."
    );

    if (!isConfirmed) {
      return;
    }

    setIsTogglingActiveId(profile.id);
    setError(null);
    setSuccess(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ is_active: nextIsActive })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
      setIsTogglingActiveId(null);
      return;
    }

    setSuccess(nextIsActive ? "Account activated successfully." : "Account deactivated successfully.");
    await fetchProfiles();
    setIsTogglingActiveId(null);
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const parsedPersonalPoints = Number(personalPoints);
    const parsedGroupPoints = Number(groupPoints);

    if (shouldRequireRank && (!Number.isFinite(parsedPersonalPoints) || parsedPersonalPoints < 0)) {
      setError("Please enter valid personal points for this member.");
      setIsSubmitting(false);
      return;
    }

    if (shouldShowGroupPoints && (!Number.isFinite(parsedGroupPoints) || parsedGroupPoints < 0)) {
      setError("Please enter valid group points for this member.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const nextRecruitBy = shouldSelectRecruiter ? recruitById || null : null;
    const derivedRank = role === "super_admin" ? "leader" : role === "admin" ? null : shouldRequireRank ? rank : null;
    const createdEmail = email;

    const createUserPayload: Record<string, unknown> = {
      email,
      password,
      role,
    };

    if (shouldRequireRank) {
      createUserPayload.rank = derivedRank ?? "agent";
    }

    if (shouldSelectRecruiter) {
      createUserPayload.recruitBy = nextRecruitBy;
    }

    const { data, error: functionError } = await supabase.functions.invoke("clever-service", {
      body: createUserPayload,
    });

    if (functionError) {
      setError(functionError.message);
      setIsSubmitting(false);
      return;
    }

    if (data?.error) {
      setError(data.error);
      setIsSubmitting(false);
      return;
    }

    const { data: createdProfiles, error: createdProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", createdEmail)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (createdProfileError) {
      setError(`User created, but rank setup failed: ${createdProfileError.message}`);
      await fetchProfiles();
      setIsSubmitting(false);
      return;
    }

    const createdProfileId = createdProfiles?.[0]?.id;

    if (createdProfileId) {
      const updatePayload: Record<string, unknown> = {
        role,
        recruit_by: nextRecruitBy,
        personal_points: shouldRequireRank ? parsedPersonalPoints : 0,
        rank: derivedRank,
      };

      if (supportsGroupPoints) {
        updatePayload.group_points = shouldShowGroupPoints ? parsedGroupPoints : 0;
      }

      const { error: updateCreatedProfileError } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", createdProfileId);

      if (updateCreatedProfileError) {
        setError(`User created, but rank setup failed: ${updateCreatedProfileError.message}`);
        await fetchProfiles();
        setIsSubmitting(false);
        return;
      }
    }

    setSuccess("User created successfully.");
    setEmail("");
    setPassword("");
    setRole("admin");
    setRank(getDefaultMemberRankForRole("admin"));
    setRecruitById("");
    setPersonalPoints("");
    setGroupPoints("");
    await fetchProfiles();
    setIsSubmitting(false);
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
          <p className="text-gray-500 text-sm mt-1">
            Create a new user with a temporary password and role.
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Save className="w-4 h-4" />
          {isSubmitting ? "Creating..." : "Create User"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm mb-4">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">
            New Account
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@company.com"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Temporary password"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as (typeof roleOptions)[number])}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
              >
                {createRoleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            {shouldRequireRank && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starting Role</label>
                <select
                  value={rank}
                  onChange={(event) => setRank(event.target.value as (typeof memberRankOptions)[number])}
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                >
                  {memberRankOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {shouldRequireRank && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Personal Points</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={personalPoints}
                    onChange={(event) => setPersonalPoints(event.target.value)}
                    placeholder="Enter member points"
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setPersonalPoints("0")}
                    className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Start from 0
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">1 point = RM 1 commission.</p>
              </div>
            )}
            {shouldShowGroupPoints && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group Points</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={groupPoints}
                    onChange={(event) => setGroupPoints(event.target.value)}
                    placeholder="Enter group points"
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setGroupPoints("0")}
                    className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Start from 0
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Includes personal points.</p>
              </div>
            )}
            {shouldSelectRecruiter && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recruit By</label>
                <select
                  value={recruitById}
                  onChange={(event) => setRecruitById(event.target.value)}
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                >
                  <option value="">None</option>
                  {eligibleRecruiters.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name || profile.email || "Unnamed member"}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {role === "agent" && recruitById && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Leader Name</label>
                <div className="w-full border border-gray-200 rounded-lg p-2.5 text-sm bg-gray-50 text-gray-700">
                  {getProfileLabel(selectedLeaderId ?? null)}
                </div>
              </div>
            )}
            {shouldRequireRank && newMemberRankPreview && (
              <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
                <div>
                  Current rank: <span className="font-semibold text-gray-900">{formatRankLabel(newMemberRankPreview.rank)}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Personal points: {formatPointValue(newMemberRankPreview.personalPoints)} | Group points: {formatPointValue(newMemberRankPreview.groupPoints)} | Direct recruits: {newMemberRankPreview.directRecruitCount}
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm mt-6">
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-500">Total Admin</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{directorySummaryCounts.adminCount}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-500">Total Leader</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{directorySummaryCounts.leaderCount}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-500">Total Pre Leader</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{directorySummaryCounts.preLeaderCount}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-500">Total Agent</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{directorySummaryCounts.agentCount}</p>
          </div>
        </div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">User Directory</h3>
          <button
            type="button"
            onClick={fetchProfiles}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Refresh
          </button>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Search User</label>
            <input
              type="text"
              value={userSearchTerm}
              onChange={(event) => setUserSearchTerm(event.target.value)}
              placeholder="Search by user name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Rank</label>
            <select
              value={rankFilter}
              onChange={(event) => setRankFilter(event.target.value as "all" | (typeof memberRankOptions)[number])}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All ranks</option>
              {memberRankOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Status</label>
            <select
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value as "all" | "active" | "inactive")}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Profile</th>
                <th className="py-2">Bank Name</th>
                <th className="py-2">Account Number</th>
                <th className="py-2">Member Rank</th>
                <th className="py-2">Personal</th>
                <th className="py-2">Group</th>
                <th className="py-2">Recruit By</th>
                <th className="py-2">Leader</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => (
                <tr key={profile.id} className="border-b border-gray-50">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded-full border border-gray-100 bg-gray-50"
                        style={{
                          backgroundImage: `url(${profile.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas"})`,
                          backgroundPosition: `${profile.avatar_position_x ?? 50}% ${profile.avatar_position_y ?? 50}%`,
                          backgroundSize: `${(profile.avatar_zoom ?? 1) * 100}% ${(profile.avatar_zoom ?? 1) * 100}%`,
                          backgroundRepeat: "no-repeat",
                        }}
                      />
                      <span className="font-medium text-gray-900">
                        {profile.name || "Unnamed user"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-gray-600">{profile.bank_name || "-"}</td>
                  <td className="py-3 text-gray-600">{profile.bank_account_number || "-"}</td>
                  <td className="py-3 text-gray-600">
                    {shouldAutoManageRank(profile) ? (
                      <div>
                        <div>{formatRankLabel(memberRankSummaries.get(profile.id)?.rank ?? profile.rank)}</div>
                        <div className="text-xs text-gray-400">
                          {memberRankSummaries.get(profile.id)?.directRecruitCount ?? 0} recruits
                        </div>
                      </div>
                    ) : profile.role === "super_admin" ? (
                      ""
                    ) : (
                      formatRankLabel(profile.rank)
                    )}
                  </td>
                  <td className="py-3 text-gray-600">
                    {shouldAutoManageRank(profile)
                      ? formatPointValue(memberRankSummaries.get(profile.id)?.personalPoints ?? profile.personal_points)
                      : "-"}
                  </td>
                  <td className="py-3 text-gray-600">
                    {shouldAutoManageRank(profile)
                      ? formatPointValue(memberRankSummaries.get(profile.id)?.groupPoints ?? profile.group_points)
                      : "-"}
                  </td>
                  <td className="py-3 text-gray-600">
                    {getProfileLabel(profile.recruit_by)}
                  </td>
                  <td className="py-3 text-gray-600">
                    {getProfileLabel(getLeaderProfileId(profile))}
                  </td>
                  <td className="py-3 text-gray-600">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                        (profile.is_active ?? true)
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {(profile.is_active ?? true) ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEditing(profile)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:text-gray-900"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(profile)}
                        disabled={isTogglingActiveId === profile.id}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
                          (profile.is_active ?? true)
                            ? "border-amber-200 text-amber-700 hover:text-amber-800"
                            : "border-emerald-200 text-emerald-700 hover:text-emerald-800"
                        } disabled:opacity-60`}
                      >
                        {isTogglingActiveId === profile.id
                          ? ((profile.is_active ?? true) ? "Deactivating..." : "Activating...")
                          : ((profile.is_active ?? true) ? "Deactivate" : "Activate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteProfile(profile);
                          setDeleteProfileConfirmationText("");
                          setError(null);
                          setSuccess(null);
                        }}
                        disabled={isDeletingId === profile.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                        {isDeletingId === profile.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProfiles.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-500">
                    No profiles found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-800">Edit Profile</h4>
                <p className="mt-1 text-sm text-gray-500">Update member details, points, rank, and profile picture.</p>
              </div>
              <button
                type="button"
                onClick={cancelEditing}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder="User name"
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={(event) => setEditRole(event.target.value as (typeof roleOptions)[number])}
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                  >
                    {roleOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                {(editRole === "agent" || editRole === "leader") && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Role</label>
                    <select
                      value={editRank}
                      onChange={(event) => setEditRank(event.target.value as (typeof memberRankOptions)[number])}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      {memberRankOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recruit By</label>
                  <select
                    value={editRecruitById}
                    onChange={(event) => setEditRecruitById(event.target.value)}
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                  >
                    <option value="">None</option>
                    {eligibleRecruiters.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name || profile.email || "Unnamed member"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Personal Points</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editPersonalPoints}
                      onChange={(event) => setEditPersonalPoints(event.target.value)}
                      placeholder="Enter member points"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setEditPersonalPoints("0")}
                      className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-white"
                    >
                      Start from 0
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">1 point = RM 1 commission.</p>
                </div>
                {supportsGroupPoints && (editRole === "agent" || editRole === "leader") && (editRank === "pre_leader" || editRank === "leader") && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Group Points</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editGroupPoints}
                        onChange={(event) => setEditGroupPoints(event.target.value)}
                        placeholder="Enter group points"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setEditGroupPoints("0")}
                        className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-white"
                      >
                        Start from 0
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Includes personal points.</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={editBankName}
                    onChange={(event) => setEditBankName(event.target.value)}
                    placeholder="Bank name"
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account Number</label>
                  <input
                    type="text"
                    value={editBankAccountNumber}
                    onChange={(event) => setEditBankAccountNumber(event.target.value)}
                    placeholder="Account number"
                    className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Profile Picture</label>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full border border-gray-100 overflow-hidden bg-gray-50"
                      style={{
                        backgroundImage: `url(${editAvatarUrl || "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas"})`,
                        backgroundPosition: `${editAvatarX}% ${editAvatarY}%`,
                        backgroundSize: `${editAvatarZoom * 100}% ${editAvatarZoom * 100}%`,
                        backgroundRepeat: "no-repeat",
                      }}
                    />
                    <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-xs cursor-pointer hover:bg-white">
                      <Upload className="h-4 w-4 text-gray-500" />
                      Upload
                      <input type="file" accept="image/*" onChange={handleEditAvatarChange} className="hidden" />
                    </label>
                    <span className="text-xs text-gray-500">{editAvatarName || "No file selected"}</span>
                  </div>
                </div>
              </div>
              {memberRankSummaries.get(editingId) && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
                  <div>
                    Current rank: <span className="font-semibold text-gray-900">{formatRankLabel(memberRankSummaries.get(editingId)?.rank)}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                      Personal points: {formatPointValue(memberRankSummaries.get(editingId)?.personalPoints)} | Group points: {formatPointValue(memberRankSummaries.get(editingId)?.groupPoints)} | Direct recruits: {memberRankSummaries.get(editingId)?.directRecruitCount ?? 0}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Zoom</label>
                  <input
                    type="range"
                    min="1"
                    max="2"
                    step="0.01"
                    value={editAvatarZoom}
                    onChange={(event) => setEditAvatarZoom(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Horizontal</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={editAvatarX}
                    onChange={(event) => setEditAvatarX(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Vertical</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={editAvatarY}
                    onChange={(event) => setEditAvatarY(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={cancelEditing}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                <Save className="h-4 w-4" />
                {isSavingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-100 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-800">Delete user</h3>
              <p className="mt-1 text-sm text-gray-500">
                This action will permanently remove the user account.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm text-gray-600">
              <div>
                Name: <span className="font-medium text-gray-800">{pendingDeleteProfile.name || "Unnamed user"}</span>
              </div>
              <div>
                Email: <span className="font-medium text-gray-800">{pendingDeleteProfile.email || "-"}</span>
              </div>
              <div>
                Role: <span className="font-medium text-gray-800">{pendingDeleteProfile.role || "-"}</span>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Deleting this user will also delete the saved profile picture.
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Type <span className="font-semibold">CONFIRM</span> to delete this user
                </label>
                <input
                  type="text"
                  value={deleteProfileConfirmationText}
                  onChange={(event) => setDeleteProfileConfirmationText(event.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteProfile(null);
                  setDeleteProfileConfirmationText("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                disabled={isDeletingId === pendingDeleteProfile.id}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProfile()}
                disabled={isDeletingId === pendingDeleteProfile.id || deleteProfileConfirmationText !== "CONFIRM"}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingId === pendingDeleteProfile.id ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
