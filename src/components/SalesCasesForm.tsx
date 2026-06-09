import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { fetchNotificationProfiles, notifyDeleteRequest } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";
import { getCaseCommissionStructure, getShortCommissionStructureLabel } from "../lib/commissionStructures";
import { getCasePersonalAmountForProfile, getStoredInvolvedProfileId } from "../lib/salesCaseMetrics";
import {
  getCaseStatusClasses,
  hasCaseWorkflowColumns,
  isCaseLockedForEditing,
  normalizeCaseStatus,
  SalesCaseModal,
  type SalesCasePayoutRecord,
  type ProjectOption,
  type SalesCaseRecord,
} from "./SalesCaseModal";

type ProfileOption = {
  id: string;
  name: string | null;
  email: string | null;
  rank: string | null;
  recruit_by: string | null;
};

type SalesCasesFormProps = {
  userId: string;
};

type SalesCaseListRow =
  | {
      id: string;
      rowType: "case";
      record: SalesCaseRecord;
      payout: null;
      createdAt: string;
    }
  | {
      id: string;
      rowType: "top_up";
      record: SalesCaseRecord;
      payout: SalesCasePayoutRecord;
      createdAt: string;
    };

type TopUpSalesCaseListRow = Extract<SalesCaseListRow, { rowType: "top_up" }>;

type DisplaySalesCaseRow = {
  row: SalesCaseListRow;
  projectName: string;
  topUpPayout: SalesCasePayoutRecord | null;
  isCreator: boolean;
  isDeleteRequested: boolean;
  creatorLabel: string;
  createdAt: Date | null;
  bookingDate: Date | null;
  status: string;
  isLocked: boolean;
  viewerCommission: number | null;
  viewerPayout: SalesCasePayoutRecord | null;
  displayStatus: string;
  displayCommission: number | null;
  topUpLabel: string | null;
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

const formatCurrency = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Math.round(value * 100) / 100;
  return `RM ${roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
};

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Math.round(value * 100) / 100;
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

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

export function SalesCasesForm({ userId }: SalesCasesFormProps) {
  const today = new Date();
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<SalesCaseRecord | null>(null);
  const [isReadOnlyModal, setIsReadOnlyModal] = useState(false);
  const [isRequestingId, setIsRequestingId] = useState<string | null>(null);
  const [selectedMonthValue, setSelectedMonthValue] = useState(() => `${today.getMonth() + 1}`.padStart(2, "0"));
  const [selectedYearValue, setSelectedYearValue] = useState(() => `${today.getFullYear()}`);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [rowTypeFilter, setRowTypeFilter] = useState<"all" | "case" | "top_up">("all");

  const caseWorkflowEnabled = useMemo(
    () => cases.some((record) => hasCaseWorkflowColumns(record)),
    [cases]
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileOption>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const payoutMap = useMemo(() => {
    const map = new Map<string, SalesCasePayoutRecord[]>();
    payouts.forEach((payout) => {
      const existing = map.get(payout.sales_case_id) ?? [];
      existing.push(payout);
      map.set(payout.sales_case_id, existing);
    });
    return map;
  }, [payouts]);

  const salesCaseRows = useMemo<SalesCaseListRow[]>(() => {
    const baseRows: SalesCaseListRow[] = cases.map((record) => ({
      id: record.id,
      rowType: "case",
      record,
      payout: null,
      createdAt: record.created_at,
    }));

    const topUpRows = payouts
      .filter((payout) => payout.payout_type === "tier_upgrade_top_up" && payout.profile_id === userId)
      .map((payout) => {
        const record = cases.find((caseRecord) => caseRecord.id === payout.sales_case_id) ?? null;

        if (!record) {
          return null;
        }

        return {
          id: `top-up-${payout.id}`,
          rowType: "top_up" as const,
          record,
          payout,
          createdAt: payout.created_at,
        };
      })
      .filter((row): row is TopUpSalesCaseListRow => Boolean(row));

    return [...topUpRows, ...baseRows].sort((left, right) => {
      const rightTime = new Date(right.createdAt).getTime();
      const leftTime = new Date(left.createdAt).getTime();
      return rightTime - leftTime;
    });
  }, [cases, payouts, userId]);

  const fetchCases = async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("sales_cases")
      .select("*")
      .or(`created_by.eq.${userId},involved_user_ids.cs.{${userId}}`)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setCases((data as SalesCaseRecord[]) ?? []);
  };

  const fetchPayouts = async () => {
    const { data, error: fetchError } = await supabase
      .from("sales_case_payouts")
      .select("*")
      .in("payout_status", ["Pending", "Paid", "Approve"])
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setPayouts((data as SalesCasePayoutRecord[]) ?? []);
  };

  const fetchProjects = async () => {
    const { data, error: fetchError } = await supabase
      .from("projects")
      .select(
        "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
      )
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setProjects((data as ProjectOption[]) ?? []);
  };

  const fetchProfiles = async (profileIds: string[]) => {
    if (profileIds.length === 0) {
      setProfiles([]);
      return;
    }

    const loadedProfiles = new Map<string, ProfileOption>();
    let pendingIds = Array.from(new Set(profileIds));

    while (pendingIds.length > 0) {
      const idsToFetch = pendingIds.filter((profileId) => !loadedProfiles.has(profileId));

      if (idsToFetch.length === 0) {
        break;
      }

      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("id, name, email, rank, recruit_by")
        .in("id", idsToFetch);

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const fetchedProfiles = (data as ProfileOption[]) ?? [];
      fetchedProfiles.forEach((profile) => loadedProfiles.set(profile.id, profile));

      pendingIds = fetchedProfiles
        .map((profile) => profile.recruit_by)
        .filter(
          (profileId): profileId is string =>
            typeof profileId === "string" && profileId.length > 0 && !loadedProfiles.has(profileId)
        );
    }

    setProfiles(Array.from(loadedProfiles.values()));
  };

  useEffect(() => {
    fetchCases();
    fetchProjects();
    fetchPayouts();
  }, [userId]);

  useEffect(() => {
    const profileIds = Array.from(
      new Set(
        cases
          .flatMap((record) => [record.created_by, ...(record.involved_user_ids ?? [])])
          .concat(userId)
          .filter(Boolean)
      )
    ) as string[];
    fetchProfiles(profileIds);
  }, [cases]);

  const getLeaderChain = (
    profile: ProfileOption | null,
    visitedIds = new Set<string>()
  ) => {
    if (!profile) {
      return { preLeader: null, leader: null };
    }

    if (visitedIds.has(profile.id)) {
      return { preLeader: null, leader: null };
    }

    const nextVisitedIds = new Set(visitedIds);
    nextVisitedIds.add(profile.id);

    if (profile.rank === "leader") {
      return { preLeader: null, leader: profile };
    }

    const recruiter = profile.recruit_by ? profileMap.get(profile.recruit_by) ?? null : null;
    if (!recruiter) {
      return { preLeader: null, leader: null };
    }

    if (recruiter.rank === "leader") {
      return { preLeader: null, leader: recruiter };
    }

    if (recruiter.rank === "pre_leader") {
      const leader = recruiter.recruit_by ? profileMap.get(recruiter.recruit_by) ?? null : null;
      return { preLeader: recruiter, leader };
    }

    if (recruiter.rank === "agent") {
      return getLeaderChain(recruiter, nextVisitedIds);
    }

    return { preLeader: null, leader: null };
  };

  const getViewerCommission = (record: SalesCaseRecord) => {
    const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
    const commissionStructure = getCaseCommissionStructure(record, project);
    const viewerProfile = profileMap.get(userId) ?? null;
    const creatorProfile = record.created_by
      ? record.created_by === userId
        ? viewerProfile
        : profileMap.get(record.created_by) ?? null
      : null;
    const involvedUserId = getStoredInvolvedProfileId(record);
    const involvedProfile = involvedUserId
      ? involvedUserId === userId
        ? viewerProfile
        : profileMap.get(involvedUserId) ?? null
      : null;

    if (!project || !viewerProfile || !commissionStructure) {
      return null;
    }

    const participantIds = Array.from(
      new Set([record.created_by, involvedUserId].filter(Boolean))
    ) as string[];

    const participants = [creatorProfile, involvedProfile].filter(
      (profile, index, array): profile is ProfileOption =>
        Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index
    );

    if (participantIds.length === 0) {
      return null;
    }

    const splitAgentPercentage = (commissionStructure.agent_commission ?? 0) / participantIds.length;
    const splitPreLeaderPercentage = (commissionStructure.pre_leader_override ?? 0) / participantIds.length;
    const splitLeaderPercentage = (commissionStructure.leader_override ?? 0) / participantIds.length;
    let totalPercentage = 0;

    participants.forEach((participant) => {
      const chain = getLeaderChain(participant);

      if (participant.id === userId) {
        totalPercentage += splitAgentPercentage;
      }

      if (participant.rank === "agent") {
        const preLeaderRecipient = chain.preLeader ?? chain.leader;
        if (preLeaderRecipient?.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }
        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }
        return;
      }

      if (participant.rank === "pre_leader") {
        if (participant.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }
        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }
        return;
      }

      if (participant.rank === "leader" && participant.id === userId) {
        totalPercentage += splitPreLeaderPercentage + splitLeaderPercentage;
      }
    });

    return (record.nett_price ?? 0) * (totalPercentage / 100);
  };

  const displaySalesCaseRows = useMemo<DisplaySalesCaseRow[]>(() => {
    return salesCaseRows.map((row) => {
      const record = row.record;
      const projectName = record.project_id
        ? projectMap.get(record.project_id)?.project_name || "-"
        : "-";
      const topUpPayout = row.rowType === "top_up" ? row.payout : null;
      const isCreator = record.created_by === userId;
      const isDeleteRequested = Boolean(record.delete_requested);
      const creatorLabel = record.created_by
        ? profileMap.get(record.created_by)?.name || profileMap.get(record.created_by)?.email || "-"
        : "-";
      const createdAt = record.created_at ? new Date(record.created_at) : null;
      const bookingDate = record.booking_date ? new Date(record.booking_date) : null;
      const status = normalizeCaseStatus(record.status);
      const isLocked = isCaseLockedForEditing(record.status);
      const viewerCommission = getViewerCommission(record);
      const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
        (payout) => payout.payout_type !== "tier_upgrade_top_up"
      );
      const viewerPayout = relatedPayouts.find((payout) => payout.profile_id === userId) ?? null;
      const displayStatus = topUpPayout
        ? topUpPayout.payout_status === "Paid"
          ? "Completed"
          : topUpPayout.payout_status
        : viewerPayout?.payout_status === "Paid"
          ? "Completed"
          : status;
      const displayCommission = topUpPayout ? topUpPayout.total_amount : viewerCommission;
      const topUpLabel = topUpPayout
        ? `${getShortCommissionStructureLabel(topUpPayout.source_commission_structure_label) || topUpPayout.source_commission_structure_id || "Previous Tier"} -> ${getShortCommissionStructureLabel(topUpPayout.target_commission_structure_label) || topUpPayout.target_commission_structure_id || "New Tier"}`
        : null;

      return {
        row,
        projectName,
        topUpPayout,
        isCreator,
        isDeleteRequested,
        creatorLabel,
        createdAt,
        bookingDate,
        status,
        isLocked,
        viewerCommission,
        viewerPayout,
        displayStatus,
        displayCommission,
        topUpLabel,
      };
    });
  }, [payoutMap, profileMap, projectMap, salesCaseRows, userId]);

  const selectedMonth = selectedMonthValue === "all" ? null : `${selectedYearValue}-${selectedMonthValue}`;

  const availableYearOptions = useMemo(() => {
    const yearValues = new Set<string>([selectedYearValue, `${today.getFullYear()}`]);

    displaySalesCaseRows.forEach((item) => {
      if (item.createdAt) {
        yearValues.add(`${item.createdAt.getFullYear()}`);
      }
    });

    return Array.from(yearValues).sort((left, right) => Number(right) - Number(left));
  }, [displaySalesCaseRows, selectedYearValue, today]);

  const availableProjectOptions = useMemo(
    () =>
      projects
        .map((project) => ({ id: project.id, name: project.project_name || "Unnamed project" }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projects]
  );

  const matchesSelectedProject = (item: DisplaySalesCaseRow) =>
    selectedProjectId === "all" || item.row.record.project_id === selectedProjectId;

  const selectedMonthRows = useMemo(() => {
    if (!selectedMonth) {
      return displaySalesCaseRows.filter((item) => matchesSelectedProject(item));
    }

    return displaySalesCaseRows.filter((item) => {
      if (getDateMonthValue(item.createdAt) !== selectedMonth) {
        return false;
      }

      return matchesSelectedProject(item);
    });
  }, [displaySalesCaseRows, selectedMonth, selectedProjectId]);

  const filteredSalesCaseRows = useMemo(() => {
    return selectedMonthRows.filter((item) => {

      if (rowTypeFilter !== "all" && item.row.rowType !== rowTypeFilter) {
        return false;
      }

      if (statusFilter !== "all" && item.displayStatus !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [rowTypeFilter, selectedMonthRows, statusFilter]);

  const selectedMonthBaseRows = useMemo(() => {
    return selectedMonthRows.filter((item) => item.row.rowType === "case");
  }, [selectedMonthRows]);

  const totalMonthlyGDV = useMemo(
    () =>
      selectedMonthBaseRows.reduce(
        (sum, item) => sum + getCasePersonalAmountForProfile(item.row.record, item.row.record.spa_price, userId),
        0
      ),
    [selectedMonthBaseRows, userId]
  );

  const totalMonthlyConverted = useMemo(
    () =>
      selectedMonthRows.reduce(
        (sum, item) => sum + (item.displayStatus === "Completed" ? item.displayCommission ?? 0 : 0),
        0
      ),
    [selectedMonthRows]
  );

  const totalMonthlySales = useMemo(
    () => selectedMonthBaseRows.reduce((sum, item) => sum + (item.displayCommission ?? 0), 0),
    [selectedMonthBaseRows]
  );

  const totalMonthlyCaseCount = useMemo(() => selectedMonthBaseRows.length, [selectedMonthBaseRows]);

  const totalMonthlyPendingCases = useMemo(
    () =>
      selectedMonthBaseRows.filter(
        (item) => !["Approve", "Paid", "Completed", "Reject", "Cancel"].includes(item.displayStatus)
      ).length,
    [selectedMonthBaseRows]
  );

  const requestDelete = async (record: SalesCaseRecord) => {
    if (record.created_by !== userId) {
      setError("Only the case creator can request deletion.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRequestingId(record.id);

    const { error: updateError } = await supabase
      .from("sales_cases")
      .update({
        delete_requested: true,
        delete_requested_by: userId,
        delete_requested_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    if (updateError) {
      setError(updateError.message);
      setIsRequestingId(null);
      return;
    }

    await fetchCases();
    setSuccess("Delete request sent successfully.");

    try {
      const notificationProfiles = await fetchNotificationProfiles();
      const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
        (payout) => payout.payout_type !== "tier_upgrade_top_up"
      );

      await notifyDeleteRequest({
        actorUserId: userId,
        salesCaseId: record.id,
        caseOwnerId: record.created_by ?? userId,
        involvedProfileId: getStoredInvolvedProfileId(record),
        projectName: record.project_id ? projectMap.get(record.project_id)?.project_name ?? null : null,
        unitNumber: record.unit_number || null,
        spaPrice: record.spa_price,
        profiles: notificationProfiles,
        commissionRows: relatedPayouts.map((payout) => ({ profileId: payout.profile_id })),
      });
    } catch (notificationError) {
      console.error("Failed to create delete request notifications", notificationError);
    }

    setIsRequestingId(null);
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Cases</h2>
          <p className="text-gray-500 text-sm mt-1">
            Track the sales cases created by your account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingCase(null);
            setIsReadOnlyModal(false);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Plus className="h-4 w-4" />
          Add Case
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

      <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2 xl:grid-cols-5">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyGDV)}</p>
          <p className="text-xs text-gray-500 mt-2">Your personal GDV for cases in the selected period, split with the involved salesperson when applicable.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyConverted)}</p>
          <p className="text-xs text-gray-500 mt-2">Total commission from completed cases in the selected period.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySales)}</p>
          <p className="text-xs text-gray-500 mt-2">Your personal commission from sales cases in the selected period, whether completed or not.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Cases This Month</p>
          <p className="text-2xl font-bold text-gray-900">{totalMonthlyCaseCount}</p>
          <p className="text-xs text-gray-500 mt-2">Total sales cases created or related to you in the selected period.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Pending Cases This Month</p>
          <p className="text-2xl font-bold text-gray-900">{totalMonthlyPendingCases}</p>
          <p className="text-xs text-gray-500 mt-2">Cases in the selected period that are still not approved yet.</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Month</label>
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
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Year</label>
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
              onChange={(event) => setRowTypeFilter(event.target.value as "all" | "case" | "top_up")}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All rows</option>
              <option value="case">Sales cases</option>
              <option value="top_up">Top-up rows</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="px-6 py-2">Created Date</th>
                <th className="px-6 py-2">Booking Date</th>
                <th className="px-6 py-2">Project</th>
                <th className="px-6 py-2">Unit</th>
                <th className="px-6 py-2">SPA Price (RM)</th>
                <th className="px-6 py-2">Nett Price (RM)</th>
                <th className="px-6 py-2">Created By</th>
                <th className="px-6 py-2">Booking Form</th>
                <th className="px-6 py-2">Status</th>
                <th className="px-6 py-2">Commission</th>
                <th className="px-6 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSalesCaseRows.map((item) => {
                const { row, record, projectName, topUpPayout, isCreator, isDeleteRequested, creatorLabel, createdAt, bookingDate, isLocked, viewerPayout, displayStatus, displayCommission, topUpLabel } = {
                  row: item.row,
                  record: item.row.record,
                  projectName: item.projectName,
                  topUpPayout: item.topUpPayout,
                  isCreator: item.isCreator,
                  isDeleteRequested: item.isDeleteRequested,
                  creatorLabel: item.creatorLabel,
                  createdAt: item.createdAt,
                  bookingDate: item.bookingDate,
                  isLocked: item.isLocked,
                  viewerPayout: item.viewerPayout,
                  displayStatus: item.displayStatus,
                  displayCommission: item.displayCommission,
                  topUpLabel: item.topUpLabel,
                };
                const isPersonallyRelatedCase =
                  row.rowType === "case" &&
                  (isCreator || getStoredInvolvedProfileId(record) === userId);

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-50 ${isPersonallyRelatedCase ? "bg-blue-50/60" : "bg-white"}`}
                  >
                    <td className="px-6 py-3 text-gray-600">
                      {row.rowType === "top_up" ? new Date(row.createdAt).toLocaleDateString() : createdAt ? createdAt.toLocaleDateString() : "-"}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {bookingDate ? bookingDate.toLocaleDateString() : "-"}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      <div>{projectName}</div>
                      {topUpLabel && <div className="text-xs text-amber-700">{topUpLabel}</div>}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{record.unit_number || "-"}</td>
                    <td className="px-6 py-3 text-gray-600">{formatAmount(record.spa_price)}</td>
                    <td className="px-6 py-3 text-gray-600">{formatAmount(record.nett_price)}</td>
                    <td className="px-6 py-3 text-gray-600">{creatorLabel}</td>
                    <td className="px-6 py-3 text-gray-600">
                      {record.booking_form_url ? (
                        <a
                          href={record.booking_form_url}
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
                    <td className="px-6 py-3 text-gray-600">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getCaseStatusClasses(displayStatus)}`}
                      >
                        {displayStatus}
                      </span>
                      {(topUpPayout
                        ? Boolean(topUpPayout.payment_receipt_url && topUpPayout.payout_status === "Paid")
                        : Boolean(viewerPayout?.payment_receipt_url && viewerPayout.payout_status === "Paid")) && (
                        <div className="mt-1 text-xs">
                          <a
                            href={(topUpPayout ? topUpPayout.payment_receipt_url : viewerPayout?.payment_receipt_url) as string}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            View Receipt
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{formatCurrency(displayCommission)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {row.rowType === "case" && isCreator && !isLocked ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCase(record);
                                setIsReadOnlyModal(false);
                                setIsModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:text-gray-900"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete(record)}
                              disabled={isDeleteRequested || isRequestingId === record.id}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700 disabled:opacity-60"
                            >
                              <Trash2 className="h-3 w-3" />
                              {isDeleteRequested
                                ? "Requested"
                                : isRequestingId === record.id
                                  ? "Requesting..."
                                  : "Request Delete"}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCase(record);
                              setIsReadOnlyModal(true);
                              setIsModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:text-gray-700"
                          >
                            {row.rowType === "top_up" ? "View Top-Up" : "View only"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredSalesCaseRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-500">
                    No cases found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <SalesCaseModal
          userId={userId}
          projects={projects}
          initialCase={editingCase}
          readOnly={isReadOnlyModal}
          enableWorkflowFields={caseWorkflowEnabled}
          allowStatusEdit={caseWorkflowEnabled && !isReadOnlyModal}
          allowLoDraftUpload={caseWorkflowEnabled && !isReadOnlyModal}
          onClose={() => {
            setIsModalOpen(false);
            setIsReadOnlyModal(false);
          }}
          onSaved={() => fetchCases()}
        />
      )}
    </div>
  );
}
