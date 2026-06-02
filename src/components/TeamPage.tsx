import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getMemberRankSummary, type MemberRankSummary, type RankProfile } from "../lib/memberRanks";
import {
  getCaseCommissionAmountForProfiles,
  getCasePersonalAmountForProfiles,
  getCompletedCommissionAmountForProfiles,
} from "../lib/salesCaseMetrics";
import {
  SalesCaseModal,
  getCaseStatusClasses,
  normalizeCaseStatus,
  type ProjectOption,
  type SalesCasePayoutRecord,
  type SalesCaseRecord,
} from "./SalesCaseModal";

type TeamProfile = RankProfile & {
  name: string | null;
  email: string | null;
  is_active: boolean | null;
};

type TeamPageProps = {
  userId: string;
  role: string | null;
  rank: string | null;
};

type TeamCaseRow = {
  id: string;
  memberIds: string[];
  memberLabels: string;
  createdAt: Date | null;
  projectId: string | null;
  projectName: string;
  unitNumber: string;
  spaPrice: number;
  customerName: string;
  bookingDate: string;
  bookingMonthValue: string | null;
  createdByLabel: string;
  bookingFormUrl: string | null;
  status: string;
  nettPrice: number;
  totalCommission: number;
  personalGdv: number;
  personalSalesConverted: number;
  completedCommission: number;
};

const MONTH_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

const SALES_CASE_STATUS_FILTER_OPTIONS = [
  "Pending",
  "Signed LO",
  "Claimable",
  "Approve",
  "Completed",
  "Cancel",
  "Reject",
];

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const hasDecimals = Math.round(value) !== value;
  return value.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString();
};

const formatRankLabel = (value: string | null | undefined) => (value ? value.replace("_", " ") : "-");

const isMemberProfile = (profile: TeamProfile) =>
  profile.role === "agent" || profile.role === "leader" || ["agent", "pre_leader", "leader"].includes(profile.rank ?? "");

const isLeaderProfile = (profile: Pick<TeamProfile, "role" | "rank"> | null | undefined) =>
  Boolean(profile && (profile.role === "leader" || profile.rank === "leader"));

const isPreLeaderProfile = (profile: Pick<TeamProfile, "rank"> | null | undefined) =>
  Boolean(profile && profile.rank === "pre_leader");

const getMonthInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

const getDateMonthValue = (date: Date | null) => {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return getMonthInputValue(date);
};

const getNextRankTarget = (rank: string | null | undefined) => {
  if (rank === "agent") {
    return {
      nextRank: "pre_leader",
      requirements: [
        { key: "personal", label: "Personal", target: 120000 },
        { key: "recruits", label: "Recruits", target: 3 },
      ],
    };
  }

  if (rank === "pre_leader") {
    return {
      nextRank: "leader",
      isHighestRank: false,
      requirements: [
        { key: "personal", label: "Personal", target: 300000 },
        { key: "group", label: "Group", target: 100000 },
      ],
    };
  }

  return {
    nextRank: "leader",
    isHighestRank: true,
    requirements: [
      { key: "personal", label: "Personal", target: 300000 },
      { key: "group", label: "Group", target: 100000 },
    ],
  };
};

export function TeamPage({ userId, role, rank }: TeamPageProps) {
  const today = new Date();
  const [profiles, setProfiles] = useState<TeamProfile[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberSearchTerm, setMemberSearchTerm] = useState("");
  const [selectedMonthValue, setSelectedMonthValue] = useState(() => `${today.getMonth() + 1}`.padStart(2, "0"));
  const [selectedYearValue, setSelectedYearValue] = useState(() => `${today.getFullYear()}`);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [rowTypeFilter, setRowTypeFilter] = useState<"all" | "case">("all");
  const [selectedDownlineId, setSelectedDownlineId] = useState("all");
  const [selectedCase, setSelectedCase] = useState<SalesCaseRecord | null>(null);
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setError(null);

      const [profileResult, caseResult, payoutResult, projectResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, name, email, role, rank, recruit_by, personal_points, group_points, is_active")
          .is("deleted_at", null),
        supabase.from("sales_cases").select("*").order("created_at", { ascending: false }),
        supabase
          .from("sales_case_payouts")
          .select("*")
          .in("payout_status", ["Pending", "Approve", "Paid"])
          .order("created_at", { ascending: false }),
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

      if (caseResult.error) {
        setError(caseResult.error.message);
        return;
      }

      if (payoutResult.error) {
        setError(payoutResult.error.message);
        return;
      }

      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }

      setProfiles((profileResult.data as TeamProfile[]) ?? []);
      setCases((caseResult.data as SalesCaseRecord[]) ?? []);
      setPayouts((payoutResult.data as SalesCasePayoutRecord[]) ?? []);
      setProjects((projectResult.data as ProjectOption[]) ?? []);
    };

    loadData();
  }, []);

  const profileMap = useMemo(() => {
    const map = new Map<string, TeamProfile>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  const payoutMap = useMemo(() => {
    const map = new Map<string, SalesCasePayoutRecord[]>();

    payouts.forEach((payout) => {
      const relatedPayouts = map.get(payout.sales_case_id) ?? [];
      relatedPayouts.push(payout);
      map.set(payout.sales_case_id, relatedPayouts);
    });

    return map;
  }, [payouts]);

  const currentProfile = profileMap.get(userId) ?? null;
  const canViewTeam = role === "agent" || role === "leader" || rank === "agent" || rank === "pre_leader" || rank === "leader";

  const downlineIds = useMemo(() => {
    if (!currentProfile || !canViewTeam) {
      return [] as string[];
    }

    const isCurrentLeader = isLeaderProfile(currentProfile);
    const isCurrentPreLeader = isPreLeaderProfile(currentProfile);

    const byRecruiter = new Map<string, TeamProfile[]>();

    profiles.filter(isMemberProfile).forEach((profile) => {
      if (!profile.recruit_by) {
        return;
      }

      const recruiterProfiles = byRecruiter.get(profile.recruit_by) ?? [];
      recruiterProfiles.push(profile);
      byRecruiter.set(profile.recruit_by, recruiterProfiles);
    });

    const collectedIds = new Set<string>();

    const collectDescendants = (profileId: string, depth: number) => {
      const directReports = byRecruiter.get(profileId) ?? [];

      directReports.forEach((profile) => {
        if (collectedIds.has(profile.id)) {
          return;
        }

        collectedIds.add(profile.id);

        if (isCurrentLeader || (isCurrentPreLeader && depth === 0)) {
          collectDescendants(profile.id, depth + 1);
        }
      });
    };

    collectDescendants(currentProfile.id, 0);

    return Array.from(collectedIds);
  }, [canViewTeam, currentProfile, profiles]);

  const downlineProfiles = useMemo(
    () => downlineIds.map((profileId) => profileMap.get(profileId)).filter((profile): profile is TeamProfile => Boolean(profile)),
    [downlineIds, profileMap]
  );

  const normalizedMemberSearch = memberSearchTerm.trim().toLowerCase();

  const filteredDownlineProfiles = useMemo(
    () =>
      downlineProfiles.filter((profile) => {
        if (!normalizedMemberSearch) {
          return true;
        }

        const name = (profile.name || "").toLowerCase();
        const email = (profile.email || "").toLowerCase();
        return name.includes(normalizedMemberSearch) || email.includes(normalizedMemberSearch);
      }),
    [downlineProfiles, normalizedMemberSearch]
  );

  const downlineRankSummaries = useMemo(() => {
    const map = new Map<string, MemberRankSummary>();

    downlineProfiles.forEach((profile) => {
      map.set(profile.id, getMemberRankSummary(profile, profiles, cases, payouts));
    });

    return map;
  }, [cases, downlineProfiles, payouts, profiles]);

  const currentProfileSummary = useMemo(
    () => (currentProfile ? getMemberRankSummary(currentProfile, profiles, cases, payouts) : null),
    [cases, currentProfile, payouts, profiles]
  );

  const teamCaseRows = useMemo<TeamCaseRow[]>(() => {
    const downlineIdSet = new Set(downlineIds);

    return cases
      .filter((record) => {
        const relatedIds = [record.created_by, ...(record.involved_user_ids ?? [])].filter(Boolean) as string[];
        return relatedIds.some((profileId) => downlineIdSet.has(profileId));
      })
      .map((record) => {
        const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
          (payout) => payout.payout_type !== "tier_upgrade_top_up"
        );
        const displayStatus =
          relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid")
            ? "Completed"
            : normalizeCaseStatus(record.status);
        const memberIds = Array.from(
          new Set(
            [record.created_by, ...(record.involved_user_ids ?? [])].filter(
              (profileId): profileId is string => Boolean(profileId) && downlineIdSet.has(profileId as string)
            )
          )
        );
        const memberLabels = Array.from(
          new Set(
            memberIds.map((profileId) => profileMap.get(profileId)?.name || profileMap.get(profileId)?.email || "Member")
          )
        ).join(", ");
        const createdAt = record.created_at ? new Date(record.created_at) : null;
        const bookingDateValue = record.booking_date ? new Date(record.booking_date) : createdAt;
        const totalCommission = getCaseCommissionAmountForProfiles(
          record,
          record.project_id ? projectMap.get(record.project_id) ?? null : null,
          profiles,
          downlineIdSet
        );
        const personalGdv = getCasePersonalAmountForProfiles(record, record.spa_price ?? 0, downlineIdSet);
        const personalSalesConverted = displayStatus === "Completed"
          ? getCasePersonalAmountForProfiles(record, record.nett_price ?? 0, downlineIdSet)
          : 0;
        const completedCommission = getCompletedCommissionAmountForProfiles(relatedPayouts, downlineIdSet);

        return {
          id: record.id,
          memberIds,
          memberLabels: memberLabels || "Member",
          createdAt,
          projectId: record.project_id,
          projectName: record.project_id ? projectMap.get(record.project_id)?.project_name || "-" : "-",
          unitNumber: record.unit_number || "-",
          spaPrice: record.spa_price ?? 0,
          customerName: record.customer_name || "-",
          bookingDate: formatDate(record.booking_date || record.created_at),
          bookingMonthValue: getDateMonthValue(bookingDateValue),
          createdByLabel: record.created_by
            ? profileMap.get(record.created_by)?.name || profileMap.get(record.created_by)?.email || "-"
            : "-",
          bookingFormUrl: record.booking_form_url || null,
          status: displayStatus,
          nettPrice: record.nett_price ?? 0,
          totalCommission,
          personalGdv,
          personalSalesConverted,
          completedCommission,
        };
      })
      .sort((left, right) => right.nettPrice - left.nettPrice);
  }, [cases, downlineIds, payoutMap, profileMap, profiles, projectMap]);

  const summaryCaseRows = useMemo<TeamCaseRow[]>(() => {
    const teamIdSet = new Set([userId, ...downlineIds]);

    return cases
      .filter((record) => {
        const relatedIds = [record.created_by, ...(record.involved_user_ids ?? [])].filter(Boolean) as string[];
        return relatedIds.some((profileId) => teamIdSet.has(profileId));
      })
      .map((record) => {
        const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
          (payout) => payout.payout_type !== "tier_upgrade_top_up"
        );
        const displayStatus =
          relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid")
            ? "Completed"
            : normalizeCaseStatus(record.status);
        const memberIds = Array.from(
          new Set(
            [record.created_by, ...(record.involved_user_ids ?? [])].filter(
              (profileId): profileId is string => Boolean(profileId) && teamIdSet.has(profileId as string)
            )
          )
        );
        const memberLabels = Array.from(
          new Set(
            memberIds.map((profileId) => profileMap.get(profileId)?.name || profileMap.get(profileId)?.email || "Member")
          )
        ).join(", ");
        const createdAt = record.created_at ? new Date(record.created_at) : null;
        const bookingDateValue = record.booking_date ? new Date(record.booking_date) : createdAt;
        const totalCommission = getCaseCommissionAmountForProfiles(
          record,
          record.project_id ? projectMap.get(record.project_id) ?? null : null,
          profiles,
          teamIdSet
        );
        const personalGdv = getCasePersonalAmountForProfiles(record, record.spa_price ?? 0, teamIdSet);
        const personalSalesConverted = displayStatus === "Completed"
          ? getCasePersonalAmountForProfiles(record, record.nett_price ?? 0, teamIdSet)
          : 0;
        const completedCommission = getCompletedCommissionAmountForProfiles(relatedPayouts, teamIdSet);

        return {
          id: record.id,
          memberIds,
          memberLabels: memberLabels || "Member",
          createdAt,
          projectId: record.project_id,
          projectName: record.project_id ? projectMap.get(record.project_id)?.project_name || "-" : "-",
          unitNumber: record.unit_number || "-",
          spaPrice: record.spa_price ?? 0,
          customerName: record.customer_name || "-",
          bookingDate: formatDate(record.booking_date || record.created_at),
          bookingMonthValue: getDateMonthValue(bookingDateValue),
          createdByLabel: record.created_by
            ? profileMap.get(record.created_by)?.name || profileMap.get(record.created_by)?.email || "-"
            : "-",
          bookingFormUrl: record.booking_form_url || null,
          status: displayStatus,
          nettPrice: record.nett_price ?? 0,
          totalCommission,
          personalGdv,
          personalSalesConverted,
          completedCommission,
        };
      })
      .sort((left, right) => right.nettPrice - left.nettPrice);
  }, [cases, downlineIds, payoutMap, profileMap, profiles, projectMap, userId]);

  const selectedMonth = selectedMonthValue === "all" ? null : `${selectedYearValue}-${selectedMonthValue}`;

  const availableYearOptions = useMemo(() => {
    const yearValues = new Set<string>([selectedYearValue, `${today.getFullYear()}`]);

    teamCaseRows.forEach((item) => {
      if (item.createdAt) {
        yearValues.add(`${item.createdAt.getFullYear()}`);
      }
    });

    return Array.from(yearValues).sort((left, right) => Number(right) - Number(left));
  }, [selectedYearValue, teamCaseRows, today]);

  const availableProjectOptions = useMemo(
    () =>
      projects
        .map((project) => ({ id: project.id, name: project.project_name || "Unnamed project" }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projects]
  );

  const availableDownlineOptions = useMemo(
    () =>
      downlineProfiles
        .map((profile) => ({ id: profile.id, label: profile.name || profile.email || "Unnamed member" }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [downlineProfiles]
  );

  const filteredTeamCaseRows = useMemo(() => {
    return teamCaseRows.filter((item) => {
      if (selectedMonth && getDateMonthValue(item.createdAt) !== selectedMonth) {
        return false;
      }

      if (selectedProjectId !== "all") {
        if (item.projectId !== selectedProjectId) {
          return false;
        }
      }

      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (rowTypeFilter !== "all" && rowTypeFilter !== "case") {
        return false;
      }

      if (selectedDownlineId !== "all" && !item.memberIds.includes(selectedDownlineId)) {
        return false;
      }

      if (normalizedMemberSearch) {
        const matchesMemberText = item.memberLabels.toLowerCase().includes(normalizedMemberSearch);
        const matchesCreatorText = item.createdByLabel.toLowerCase().includes(normalizedMemberSearch);

        if (!matchesMemberText && !matchesCreatorText) {
          return false;
        }
      }

      return true;
    });
  }, [normalizedMemberSearch, projects, rowTypeFilter, selectedDownlineId, selectedMonth, selectedProjectId, statusFilter, teamCaseRows]);

  const filteredSummaryCaseRows = useMemo(() => {
    return summaryCaseRows.filter((item) => {
      if (selectedMonth && getDateMonthValue(item.createdAt) !== selectedMonth) {
        return false;
      }

      if (selectedProjectId !== "all" && item.projectId !== selectedProjectId) {
        return false;
      }

      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [selectedMonth, selectedProjectId, statusFilter, summaryCaseRows]);

  const totalDownlineSales = useMemo(
    () => filteredSummaryCaseRows.reduce((sum, row) => sum + row.totalCommission, 0),
    [filteredSummaryCaseRows]
  );

  const totalDownlineConverted = useMemo(
    () => filteredSummaryCaseRows.reduce((sum, row) => sum + row.completedCommission, 0),
    [filteredSummaryCaseRows]
  );

  const totalTeamMonthlyGDV = useMemo(
    () => filteredSummaryCaseRows.reduce((sum, row) => sum + row.personalGdv, 0),
    [filteredSummaryCaseRows]
  );

  const totalTeamMonthlyConverted = useMemo(
    () => filteredSummaryCaseRows.reduce((sum, row) => sum + row.personalSalesConverted, 0),
    [filteredSummaryCaseRows]
  );

  const shouldShowUpgradeNotice = (summary: MemberRankSummary | null | undefined) =>
    Boolean(summary && summary.rank === "agent" && summary.eligibleRank === "pre_leader");

  if (!canViewTeam) {
    return (
      <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
          You do not have permission to access this section.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      {role !== "super_admin" && currentProfile && currentProfileSummary && (
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-gray-900">My Progress</h2>
            <p className="mt-1 text-sm text-gray-500">View your current rank progress before reviewing your team.</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900">{currentProfile.name || currentProfile.email || "My profile"}</p>
                <p className="mt-1 text-sm text-gray-500">Current rank: {formatRankLabel(currentProfileSummary.rank)}</p>
                <p className="mt-1 text-sm text-gray-500">
                  Recruited by: {currentProfile.recruit_by ? profileMap.get(currentProfile.recruit_by)?.name || profileMap.get(currentProfile.recruit_by)?.email || "-" : "-"}
                </p>
              </div>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
                {formatRankLabel(currentProfileSummary.rank)}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {shouldShowUpgradeNotice(currentProfileSummary) && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  🎉 CONGRATULATIONS! YOU DID IT! Please reach out to admin to get your rank upgraded.
                </div>
              )}
              <p className="text-sm font-medium text-gray-700">
                {getNextRankTarget(currentProfileSummary.rank).isHighestRank
                  ? `Highest rank benchmark: ${formatRankLabel(getNextRankTarget(currentProfileSummary.rank).nextRank)}`
                  : `Next rank: ${formatRankLabel(getNextRankTarget(currentProfileSummary.rank).nextRank)}`}
              </p>
              {getNextRankTarget(currentProfileSummary.rank).requirements.map((requirement) => {
                const currentValue = requirement.key === "personal"
                  ? currentProfileSummary.personalPoints
                  : requirement.key === "group"
                    ? currentProfileSummary.groupPoints
                    : currentProfileSummary.directRecruitCount;
                const progress = Math.min((currentValue / requirement.target) * 100, 100);

                return (
                  <div key={requirement.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                      <span>{requirement.label}</span>
                      <span>{formatAmount(currentValue)} / {formatAmount(requirement.target)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Team</h2>
        <p className="mt-1 text-sm text-gray-500">
          View downline sales cases and the progress each member needs to reach the next rank.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Track by Month</label>
            <select
              value={selectedMonthValue}
              onChange={(event) => setSelectedMonthValue(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Track by Year</label>
            <select
              value={selectedYearValue}
              onChange={(event) => setSelectedYearValue(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {availableYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Downline Members</p>
          <p className="text-2xl font-bold text-gray-900">{downlineProfiles.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Downline Cases</p>
          <p className="text-2xl font-bold text-gray-900">{teamCaseRows.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Total Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalDownlineSales)}</p>
          <p className="mt-2 text-xs text-gray-500">Team commission for the selected month, including your own and downline cases whether completed or not.</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Total Converted</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalDownlineConverted)}</p>
          <p className="mt-2 text-xs text-gray-500">Completed team commission for the selected month, including your own cases.</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Team GDV of the Month</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlyGDV)}</p>
          <p className="mt-2 text-xs text-gray-500">Team personal GDV for the selected month, using the split share for involved salespeople.</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-medium text-gray-500">Team Converted of the Month</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlyConverted)}</p>
          <p className="mt-2 text-xs text-gray-500">Team personal completed sales total for the selected month, using the split share for involved salespeople.</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Rank Progress</h3>
            <p className="mt-1 text-sm text-gray-500">Search a downline member and review the next-rank requirements.</p>
          </div>
          <div className="w-full md:w-80">
            <label className="mb-1 block text-xs font-medium text-gray-700">Search Member</label>
            <input
              type="text"
              value={memberSearchTerm}
              onChange={(event) => setMemberSearchTerm(event.target.value)}
              placeholder="Search by member name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        {filteredDownlineProfiles.length === 0 ? (
          <p className="text-sm text-gray-500">No downline members found.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filteredDownlineProfiles.map((profile) => {
              const summary = downlineRankSummaries.get(profile.id);
              const target = getNextRankTarget(summary?.rank ?? profile.rank);
              const recruiterLabel = profile.recruit_by
                ? profileMap.get(profile.recruit_by)?.name || profileMap.get(profile.recruit_by)?.email || "-"
                : "-";

              return (
                <div key={profile.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">{profile.name || profile.email || "Unnamed member"}</p>
                      <p className="mt-1 text-sm text-gray-500">Current rank: {formatRankLabel(summary?.rank ?? profile.rank)}</p>
                      <p className="mt-1 text-sm text-gray-500">Recruited by: {recruiterLabel}</p>
                    </div>
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
                      {formatRankLabel(summary?.rank ?? profile.rank)}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {shouldShowUpgradeNotice(summary) && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                        🎉 CONGRATULATIONS! YOU DID IT! Please reach out to admin to get your rank upgraded.
                      </div>
                    )}
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
                            <span>{formatAmount(currentValue)} / {formatAmount(requirement.target)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-200">
                            <div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-800">Downline Sales Cases</h3>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Project</label>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All projects</option>
              {availableProjectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All status</option>
              {SALES_CASE_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Row Type</label>
            <select
              value={rowTypeFilter}
              onChange={(event) => setRowTypeFilter(event.target.value as "all" | "case")}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All rows</option>
              <option value="case">Sales cases</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Downline</label>
            <select
              value={selectedDownlineId}
              onChange={(event) => setSelectedDownlineId(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All downline</option>
              {availableDownlineOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2">Member</th>
                <th className="py-2">Created Date</th>
                <th className="py-2">Booking Date</th>
                <th className="py-2">Project</th>
                <th className="py-2">Unit</th>
                <th className="py-2">SPA Price (RM)</th>
                <th className="py-2">Nett Price (RM)</th>
                <th className="py-2">Created By</th>
                <th className="py-2">Booking Form</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeamCaseRows.map((row) => (
                <tr key={row.id} className="border-b border-gray-50">
                  <td className="py-3 text-gray-700">{row.memberLabels}</td>
                  <td className="py-3 text-gray-600">{row.createdAt ? row.createdAt.toLocaleDateString() : "-"}</td>
                  <td className="py-3 text-gray-600">{row.bookingDate}</td>
                  <td className="py-3 text-gray-600">{row.projectName}</td>
                  <td className="py-3 text-gray-600">{row.unitNumber}</td>
                  <td className="py-3 text-gray-600">{formatAmount(row.spaPrice)}</td>
                  <td className="py-3 text-gray-600">{formatAmount(row.nettPrice)}</td>
                  <td className="py-3 text-gray-600">{row.createdByLabel}</td>
                  <td className="py-3 text-gray-600">
                    {row.bookingFormUrl ? (
                      <a
                        href={row.bookingFormUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        View PDF
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="py-3 text-gray-600">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getCaseStatusClasses(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const record = cases.find((item) => item.id === row.id) ?? null;
                          setSelectedCase(record);
                          setIsCaseModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTeamCaseRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-500">
                    No downline sales cases found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCaseModalOpen && (
        <SalesCaseModal
          userId={userId}
          projects={projects}
          initialCase={selectedCase}
          readOnly
          onClose={() => {
            setIsCaseModalOpen(false);
            setSelectedCase(null);
          }}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
}