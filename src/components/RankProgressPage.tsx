import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getCompletedCaseIds, getMemberRankSummary, type MemberRank, type MemberRankSummary, type RankCase, type RankPayout, type RankProfile } from "../lib/memberRanks";
import { SalesCaseModal, getCaseStatusClasses, type ProjectOption, type SalesCaseRecord } from "./SalesCaseModal";

type ProgressProfile = RankProfile & {
  name: string | null;
  email: string | null;
  is_active: boolean | null;
  avatar_url: string | null;
  avatar_position_x: number | null;
  avatar_position_y: number | null;
  avatar_zoom: number | null;
};

type RankProgressPageProps = {
  role: string | null;
  userId: string | null;
};

type RelatedCaseRow = {
  record: SalesCaseRecord;
  completedAt: string | null;
  personalCommission: number;
  teamCommission: number;
  relationLabels: string[];
};

type ProgressPayout = RankPayout & {
  paid_at: string | null;
};

const DEFAULT_AVATAR_URL = "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas";
const RANK_FILTER_OPTIONS: Array<{ value: "all" | MemberRank; label: string }> = [
  { value: "all", label: "All Ranks" },
  { value: "leader", label: "Leader" },
  { value: "pre_leader", label: "Pre Leader" },
  { value: "agent", label: "Agent" },
];

const RANK_DISPLAY_ORDER: MemberRank[] = ["leader", "pre_leader", "agent"];

const isMemberProfile = (profile: Pick<ProgressProfile, "role" | "rank">) =>
  profile.role !== "admin" &&
  profile.role !== "super_admin" &&
  (profile.role === "agent" ||
    profile.role === "leader" ||
    profile.rank === "agent" ||
    profile.rank === "pre_leader" ||
    profile.rank === "leader");

const formatDateLabel = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString("en-MY");
};

const formatCurrencyLabel = (value: number) =>
  `RM ${value.toLocaleString("en-MY", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const formatRankLabel = (value: string | null | undefined) => (value ? value.replace("_", " ") : "-");

const formatProgressValue = (value: number) => {
  const minimumFractionDigits = Number.isInteger(value) ? 0 : 2;

  return value.toLocaleString("en-MY", {
    minimumFractionDigits,
    maximumFractionDigits: 2,
  });
};

const getAvatarStyle = (profile: Pick<ProgressProfile, "avatar_url" | "avatar_position_x" | "avatar_position_y" | "avatar_zoom">) => ({
  backgroundImage: `url(${profile.avatar_url || DEFAULT_AVATAR_URL})`,
  backgroundPosition: `${profile.avatar_position_x ?? 50}% ${profile.avatar_position_y ?? 50}%`,
  backgroundSize: `${(profile.avatar_zoom ?? 1) * 100}% ${(profile.avatar_zoom ?? 1) * 100}%`,
  backgroundRepeat: "no-repeat",
});

const getNextRankTarget = (rank: MemberRank) => {
  if (rank === "agent") {
    return {
      nextRank: "pre_leader",
      isHighestRank: false,
      requirements: [
        { key: "personal", label: "Personal", target: 120000 },
        { key: "recruits", label: "Recruits", target: 3 },
      ],
    } as const;
  }

  if (rank === "pre_leader") {
    return {
      nextRank: "leader",
      isHighestRank: false,
      requirements: [
        { key: "personal", label: "Personal", target: 300000 },
        { key: "group", label: "Group", target: 100000 },
      ],
    } as const;
  }

  return {
    nextRank: "leader",
    isHighestRank: true,
    requirements: [
      { key: "personal", label: "Personal", target: 300000 },
      { key: "group", label: "Group", target: 100000 },
    ],
  } as const;
};

const rankOrder = new Map<MemberRank, number>(RANK_DISPLAY_ORDER.map((rank, index) => [rank, index]));

const isHigherRankAchieved = (summary: MemberRankSummary) => {
  const currentOrder = rankOrder.get(summary.rank) ?? Number.POSITIVE_INFINITY;
  const eligibleOrder = rankOrder.get(summary.eligibleRank) ?? Number.POSITIVE_INFINITY;
  return eligibleOrder < currentOrder;
};

const getDownlineProfileIds = (profileId: string, profiles: ProgressProfile[]) => {
  const profilesByRecruiter = new Map<string, ProgressProfile[]>();

  profiles.forEach((profile) => {
    if (!profile.recruit_by) {
      return;
    }

    const recruiterProfiles = profilesByRecruiter.get(profile.recruit_by) ?? [];
    recruiterProfiles.push(profile);
    profilesByRecruiter.set(profile.recruit_by, recruiterProfiles);
  });

  const visitedIds = new Set<string>();
  const collectedIds = new Set<string>();

  const collectDescendants = (currentProfileId: string) => {
    if (visitedIds.has(currentProfileId)) {
      return;
    }

    visitedIds.add(currentProfileId);

    const directProfiles = profilesByRecruiter.get(currentProfileId) ?? [];

    directProfiles.forEach((profile) => {
      collectedIds.add(profile.id);
      collectDescendants(profile.id);
    });
  };

  collectDescendants(profileId);

  return collectedIds;
};

export function RankProgressPage({ role, userId }: RankProgressPageProps) {
  const [profiles, setProfiles] = useState<ProgressProfile[]>([]);
  const [rankCases, setRankCases] = useState<RankCase[]>([]);
  const [rankPayouts, setRankPayouts] = useState<ProgressPayout[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedRank, setSelectedRank] = useState<"all" | MemberRank>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<SalesCaseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canViewPage = role === "admin" || role === "super_admin";

  useEffect(() => {
    if (!canViewPage) {
      return;
    }

    const loadData = async () => {
      setError(null);

      const [profileResult, rankCaseResult, payoutResult, caseResult, projectResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, name, email, role, rank, recruit_by, personal_points, group_points, is_active, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom"
          )
          .is("deleted_at", null),
        supabase.from("sales_cases").select("id, created_by, involved_user_ids, status"),
        supabase.from("sales_case_payouts").select("sales_case_id, profile_id, payout_type, payout_status, total_amount, paid_at"),
        supabase.from("sales_cases").select("*").order("created_at", { ascending: false }),
        supabase
          .from("projects")
          .select(
            "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
          )
          .eq("is_hidden", false),
      ]);

      if (profileResult.error) {
        setError(profileResult.error.message);
        return;
      }

      if (rankCaseResult.error) {
        setError(rankCaseResult.error.message);
        return;
      }

      if (payoutResult.error) {
        setError(payoutResult.error.message);
        return;
      }

      if (caseResult.error) {
        setError(caseResult.error.message);
        return;
      }

      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }

      setProfiles((profileResult.data as ProgressProfile[]) ?? []);
      setRankCases((rankCaseResult.data as RankCase[]) ?? []);
      setRankPayouts((payoutResult.data as ProgressPayout[]) ?? []);
      setCases((caseResult.data as SalesCaseRecord[]) ?? []);
      setProjects((projectResult.data as ProjectOption[]) ?? []);
    };

    void loadData();
  }, [canViewPage]);

  const memberProfiles = useMemo(
    () => profiles.filter((profile) => (profile.is_active ?? true) && isMemberProfile(profile)),
    [profiles]
  );

  const memberRankSummaries = useMemo(() => {
    const map = new Map<string, MemberRankSummary>();

    memberProfiles.forEach((profile) => {
      map.set(profile.id, getMemberRankSummary(profile, memberProfiles, rankCases, rankPayouts));
    });

    return map;
  }, [memberProfiles, rankCases, rankPayouts]);

  const filteredProfiles = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return memberProfiles
      .filter((profile) => {
        const summaryRank = memberRankSummaries.get(profile.id)?.rank ?? "agent";

        if (selectedRank !== "all" && summaryRank !== selectedRank) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const profileName = (profile.name || "").toLowerCase();
        return profileName.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const leftRank = memberRankSummaries.get(left.id)?.rank ?? "agent";
        const rightRank = memberRankSummaries.get(right.id)?.rank ?? "agent";
        const rankDifference = (rankOrder.get(leftRank) ?? 999) - (rankOrder.get(rightRank) ?? 999);

        if (rankDifference !== 0) {
          return rankDifference;
        }

        const leftName = (left.name || left.email || "").toLowerCase();
        const rightName = (right.name || right.email || "").toLowerCase();
        return leftName.localeCompare(rightName);
      });
  }, [memberProfiles, memberRankSummaries, searchTerm, selectedRank]);

  const selectedProfile = useMemo(
    () => filteredProfiles.find((profile) => profile.id === selectedProfileId) ?? memberProfiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [filteredProfiles, memberProfiles, selectedProfileId]
  );

  const selectedProfileScopeIds = useMemo(() => {
    if (!selectedProfileId) {
      return new Set<string>();
    }

    return new Set<string>([selectedProfileId, ...Array.from(getDownlineProfileIds(selectedProfileId, memberProfiles))]);
  }, [memberProfiles, selectedProfileId]);

  const completedCaseIds = useMemo(() => getCompletedCaseIds(rankCases, rankPayouts), [rankCases, rankPayouts]);

  const relatedCases = useMemo(() => {
    if (!selectedProfileId) {
      return [] as RelatedCaseRow[];
    }

    return cases.reduce<RelatedCaseRow[]>((rows, record) => {
      if (!completedCaseIds.has(record.id)) {
        return rows;
      }

      const relationLabels: string[] = [];
      const involvedIds = record.involved_user_ids ?? [];
      const relatedPayouts = rankPayouts.filter((payout) => payout.sales_case_id === record.id && payout.profile_id === selectedProfileId);
      const standardCasePayouts = rankPayouts.filter(
        (payout) => payout.sales_case_id === record.id && payout.payout_type === "standard" && payout.payout_status === "Paid"
      );
      const completedAt = rankPayouts
        .filter((payout) => payout.sales_case_id === record.id && payout.payout_status === "Paid" && payout.paid_at)
        .map((payout) => payout.paid_at)
        .sort((left, right) => new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime())[0] ?? null;
      const personalCommission = standardCasePayouts.reduce(
        (sum, payout) => (payout.profile_id === selectedProfileId ? sum + Number(payout.total_amount ?? 0) : sum),
        0
      );
      const teamCommission = standardCasePayouts.reduce(
        (sum, payout) => (selectedProfileScopeIds.has(payout.profile_id) ? sum + Number(payout.total_amount ?? 0) : sum),
        0
      );
      const isOwner = record.created_by === selectedProfileId;
      const isInvolved = involvedIds.includes(selectedProfileId) && !isOwner;
      const hasOverridePayout = relatedPayouts.length > 0 && !isOwner && !isInvolved;

      if (isOwner) {
        relationLabels.push("Own");
      }

      if (isInvolved) {
        relationLabels.push("Involved");
      }

      if (hasOverridePayout) {
        relationLabels.push("Override");
      }

      if (relationLabels.length === 0) {
        return rows;
      }

      rows.push({
        record,
        completedAt,
        personalCommission,
        teamCommission,
        relationLabels: Array.from(new Set(relationLabels)),
      });

      return rows;
    }, []);
  }, [cases, completedCaseIds, rankPayouts, selectedProfileId, selectedProfileScopeIds]);

  const relatedCaseProjectNames = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => {
      map.set(project.id, project.project_name || "Unnamed project");
    });
    return map;
  }, [projects]);

  if (!canViewPage) {
    return (
      <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600 shadow-sm">
          You do not have permission to access this section.
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Rank Progress</h2>
          <p className="mt-1 text-sm text-gray-500">
            Review each member&apos;s progress toward the next rank, with leader rows shown first.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-3 md:w-auto md:grid-cols-2">
          <div className="md:min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Rank</label>
            <select
              value={selectedRank}
              onChange={(event) => setSelectedRank(event.target.value as "all" | MemberRank)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {RANK_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:min-w-[260px]">
            <label className="mb-1 block text-xs font-medium text-gray-700">Search User Name</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by user name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500 shadow-sm">
          No matching members found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredProfiles.map((profile) => {
            const summary = memberRankSummaries.get(profile.id);
            const resolvedRank = summary?.rank ?? "agent";
            const target = getNextRankTarget(resolvedRank);

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelectedProfileId(profile.id)}
                className="rounded-xl border border-gray-100 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-12 w-12 shrink-0 rounded-full border border-gray-100 bg-gray-50"
                      style={getAvatarStyle(profile)}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{profile.name || profile.email || "Unnamed member"}</p>
                      <p className="mt-1 text-sm text-gray-500">Current rank: {formatRankLabel(resolvedRank)}</p>
                      <p className="mt-1 text-xs text-gray-400">Eligible rank: {formatRankLabel(summary?.eligibleRank ?? resolvedRank)}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
                    {formatRankLabel(resolvedRank)}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {summary && isHigherRankAchieved(summary) && !target.isHighestRank ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                      Eligible for upgrade to {formatRankLabel(summary.eligibleRank)}. Please update the member rank when ready.
                    </div>
                  ) : null}

                  <p className="text-sm font-medium text-gray-700">
                    {target.isHighestRank
                      ? `Highest rank benchmark: ${formatRankLabel(target.nextRank)}`
                      : `Next rank: ${formatRankLabel(target.nextRank)}`}
                  </p>

                  {target.requirements.map((requirement) => {
                    const currentValue = requirement.key === "personal"
                      ? summary?.personalPoints ?? 0
                      : requirement.key === "group"
                        ? summary?.groupPoints ?? 0
                        : summary?.directRecruitCount ?? 0;
                    const progress = Math.min((currentValue / requirement.target) * 100, 100);

                    return (
                      <div key={requirement.label}>
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                          <span>{requirement.label}</span>
                          <span>{formatProgressValue(currentValue)} / {formatProgressValue(requirement.target)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-200">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="pt-1 text-xs font-medium text-primary">Click to view related cases</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
    {selectedProfile ? (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
        <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Related Cases</h3>
              <p className="mt-1 text-sm text-gray-500">
                {selectedProfile.name || selectedProfile.email || "Unnamed member"} related cases from ownership, involved sales, and override payouts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedProfileId(null)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              Close
            </button>
          </div>

          <div className="max-h-[calc(85vh-88px)] overflow-y-auto px-6 py-5">
            {relatedCases.length === 0 ? (
              <p className="text-sm text-gray-500">No related cases found for this member.</p>
            ) : (
              <div className="space-y-3">
                {relatedCases.map(({ record, completedAt, personalCommission, teamCommission, relationLabels }) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedCase(record)}
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 p-4 text-left transition hover:border-primary/30 hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {relatedCaseProjectNames.get(record.project_id || "") || "Unknown project"}
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          {record.unit_number ? `Unit ${record.unit_number}` : "Unit -"}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          Booking date: {record.booking_date || "-"}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          Completed date: {formatDateLabel(completedAt)}
                        </p>
                      </div>
                      <div className="flex flex-col gap-3 lg:items-end">
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getCaseStatusClasses("Completed")}`}>
                            Completed
                          </span>
                          {relationLabels.map((label) => (
                            <span
                              key={`${record.id}-${label}`}
                              className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-right shadow-sm min-w-[220px]">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total Personal Comm</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrencyLabel(personalCommission)}</p>
                          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-400">Total Team Comm</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrencyLabel(teamCommission)}</p>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null}
    {selectedCase && userId ? (
      <SalesCaseModal
        userId={userId}
        projects={projects}
        initialCase={selectedCase}
        readOnly
        allowCaseOwnerSelection={false}
        enableWorkflowFields
        allowStatusEdit={false}
        allowLoDraftUpload={false}
        onDelete={undefined}
        onClose={() => setSelectedCase(null)}
        onSaved={() => undefined}
      />
    ) : null}
    </>
  );
}