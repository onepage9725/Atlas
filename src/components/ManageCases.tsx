import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Send } from "lucide-react";
import { notifyCaseAudience } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";
import {
  getCaseCommissionAmountForProfiles,
  getCompletedCommissionAmountForProfiles,
} from "../lib/salesCaseMetrics";
import {
  getCaseStatusClasses,
  hasCaseWorkflowColumns,
  isCaseLockedForEditing,
  MANAGE_CASE_STATUS_OPTIONS,
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
  role: string | null;
  rank: string | null;
  recruit_by: string | null;
};

const MONTH_OPTIONS = [
  { value: "all", label: "All time" },
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

type ManageCasesProps = {
  userId: string;
};

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const hasDecimals = Math.round(value) !== value;
  return value.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

export function ManageCases({ userId }: ManageCasesProps) {
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
  const [pendingDelete, setPendingDelete] = useState<SalesCaseRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isNotingId, setIsNotingId] = useState<string | null>(null);
  const [caseSearchTerm, setCaseSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [selectedYearValue, setSelectedYearValue] = useState<string>(() => `${today.getFullYear()}`);
  const [selectedMonthValue, setSelectedMonthValue] = useState<string>(() => `${today.getMonth() + 1}`.padStart(2, "0"));
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [selectedAgentId, setSelectedAgentId] = useState("all");

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

  const memberProfileIds = useMemo(
    () =>
      new Set(
        profiles
          .filter((profile) => profile.role !== "admin" && profile.role !== "super_admin")
          .map((profile) => profile.id)
      ),
    [profiles]
  );

  const availableYearOptions = useMemo(() => {
    const yearValues = new Set<string>([selectedYearValue, `${today.getFullYear()}`]);

    cases.forEach((record) => {
      const createdAt = record.created_at ? new Date(record.created_at) : null;

      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        yearValues.add(`${createdAt.getFullYear()}`);
      }
    });

    return Array.from(yearValues).sort((left, right) => Number(right) - Number(left));
  }, [cases, selectedYearValue, today]);

  const matchesSelectedMonth = (record: SalesCaseRecord) => {
    const createdAt = record.created_at ? new Date(record.created_at) : null;

    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return false;
    }

    if (`${createdAt.getFullYear()}` !== selectedYearValue) {
      return false;
    }

    if (selectedMonthValue === "all") {
      return true;
    }

    return `${createdAt.getMonth() + 1}`.padStart(2, "0") === selectedMonthValue;
  };

  const matchesSelectedProject = (record: SalesCaseRecord) =>
    selectedProjectId === "all" || record.project_id === selectedProjectId;

  const matchesSelectedAgent = (record: SalesCaseRecord) =>
    selectedAgentId === "all" ||
    record.created_by === selectedAgentId ||
    (record.involved_user_ids ?? []).includes(selectedAgentId);

  const summaryCases = useMemo(
    () => cases.filter((record) => matchesSelectedMonth(record) && matchesSelectedProject(record) && matchesSelectedAgent(record)),
    [cases, selectedAgentId, selectedMonthValue, selectedProjectId]
  );

  const filteredCases = useMemo(() => {
    const normalizedSearch = caseSearchTerm.trim().toLowerCase();

    return summaryCases.filter((record) => {
      const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
      const projectName = project?.project_name || "";
      const creator = record.created_by
        ? profileMap.get(record.created_by)?.name || profileMap.get(record.created_by)?.email || ""
        : "";
      const relatedMembers = (record.involved_user_ids ?? [])
        .map((profileId) => profileMap.get(profileId)?.name || profileMap.get(profileId)?.email || "")
        .join(" ");
      const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
        (payout) => payout.payout_type !== "tier_upgrade_top_up"
      );
      const status = normalizeCaseStatus(record.status);
      const allRelatedPaid = relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid");
      const displayStatus = allRelatedPaid ? "Completed" : status;

      if (statusFilter !== "all" && displayStatus !== statusFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [creator, relatedMembers, projectName, record.unit_number || ""]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [caseSearchTerm, payoutMap, profileMap, projectMap, statusFilter, summaryCases]);

  const availableProjectOptions = useMemo(
    () =>
      projects
        .map((project) => ({ id: project.id, name: project.project_name || "Unnamed project" }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projects]
  );

  const availableAgentOptions = useMemo(() => {
    const availableIds = new Set(
      summaryCases.flatMap((record) => [record.created_by, ...(record.involved_user_ids ?? [])]).filter(Boolean) as string[]
    );

    return profiles
      .filter((profile) => availableIds.has(profile.id))
      .map((profile) => ({ id: profile.id, label: profile.name || profile.email || "Unnamed member" }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [profiles, summaryCases]);

  const totalMonthlyGDV = useMemo(
    () => summaryCases.reduce((sum, record) => sum + (record.spa_price ?? 0), 0),
    [summaryCases]
  );

  const totalMonthlyNettSales = useMemo(
    () => summaryCases.reduce((sum, record) => sum + (record.nett_price ?? 0), 0),
    [summaryCases]
  );

  const totalMonthlySales = useMemo(
    () =>
      summaryCases.reduce((sum, record) => {
        const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;

        return sum + getCaseCommissionAmountForProfiles(record, project, profiles, memberProfileIds);
      }, 0),
    [memberProfileIds, profiles, projectMap, summaryCases]
  );

  const totalMonthlyConverted = useMemo(
    () =>
      summaryCases.reduce(
        (sum, record) => sum + getCompletedCommissionAmountForProfiles(payoutMap.get(record.id) ?? [], memberProfileIds),
        0
      ),
    [memberProfileIds, payoutMap, summaryCases]
  );

  const totalMonthlyCaseCount = useMemo(() => summaryCases.length, [summaryCases]);

  const totalMonthlyPaidOut = useMemo(
    () =>
      payouts.reduce((sum, payout) => {
        if (
          payout.payout_status !== "Paid" ||
          payout.payout_type === "tier_upgrade_top_up" ||
          !summaryCases.some((record) => record.id === payout.sales_case_id)
        ) {
          return sum;
        }

        return sum + (payout.total_amount ?? 0);
      }, 0),
    [payouts, summaryCases]
  );

  const selectedCasePaidReceiptRows = useMemo(() => {
    if (!editingCase) {
      return [] as Array<{
        id: string;
        memberLabel: string;
        receiptUrl: string;
        paidAt: string | null;
      }>;
    }

    const relatedPayouts = payoutMap.get(editingCase.id) ?? [];

    return relatedPayouts
      .filter((payout) => payout.payout_status === "Paid" && Boolean(payout.payment_receipt_url))
      .map((payout) => ({
        id: payout.id,
        memberLabel: profileMap.get(payout.profile_id)?.name || profileMap.get(payout.profile_id)?.email || "Member",
        receiptUrl: payout.payment_receipt_url as string,
        paidAt: payout.paid_at,
      }));
  }, [editingCase, payoutMap, profileMap]);

  const fetchCases = async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("sales_cases")
      .select("*")
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

  const fetchProfiles = async () => {
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, name, email, role, rank, recruit_by")
      .is("deleted_at", null);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setProfiles((data as ProfileOption[]) ?? []);
  };

  useEffect(() => {
    const loadData = async () => {
      await fetchCases();
      await fetchPayouts();
    };

    loadData();
  }, []);

  useEffect(() => {
    const loadProjects = async () => {
      const { data, error: fetchError } = await supabase
        .from("projects")
        .select(
          "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
        )
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setProjects((data as ProjectOption[]) ?? []);
    };

    loadProjects();
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [cases, payouts]);

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

  const deleteCaseFileFromStorage = async (url: string | null) => {
    if (!url) return;
    const path = getStoragePathFromUrl(url, "cases");
    if (!path) return;

    const { error: deleteError } = await supabase.storage.from("cases").remove([path]);

    if (deleteError) {
      throw deleteError;
    }
  };

  const handleDelete = async (record: SalesCaseRecord) => {
    setError(null);
    setSuccess(null);
    setIsDeleting(true);

    const { data, error: deleteError } = await supabase
      .from("sales_cases")
      .delete()
      .eq("id", record.id)
      .select("id");

    if (deleteError) {
      setError(deleteError.message);
      setIsDeleting(false);
      return;
    }

    if (!data || data.length === 0) {
      setError("Delete failed. Please check your permissions and try again.");
      setIsDeleting(false);
      return;
    }

    try {
      const attachmentUrls = Array.from(
        new Set([record.booking_form_url, record.lo_draft_url].filter(Boolean))
      ) as string[];

      await Promise.all(attachmentUrls.map((url) => deleteCaseFileFromStorage(url)));

      setCases((prevCases) => prevCases.filter((item) => item.id !== record.id));
      if (editingCase?.id === record.id) {
        setEditingCase(null);
      }

      try {
        const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
          (payout) => payout.payout_type !== "tier_upgrade_top_up"
        );
        const actorLabel = profileMap.get(userId)?.name || profileMap.get(userId)?.email || "An admin";

        await notifyCaseAudience({
          actorUserId: userId,
          salesCaseId: null,
          caseOwnerId: record.created_by ?? userId,
          involvedProfileId: record.involved_profile_id,
          title: "Sales case deleted",
          message: `${actorLabel} deleted the sales case for ${record.project_id ? projectMap.get(record.project_id)?.project_name || "Unnamed project" : "Unnamed project"}, ${record.unit_number ? `Unit ${record.unit_number}` : "Unit -"}.`,
          profiles,
          commissionRows: relatedPayouts.map((payout) => ({ profileId: payout.profile_id })),
        });
      } catch (notificationError) {
        console.error("Failed to create delete notifications for sales case", notificationError);
      }

      setSuccess("Sales case deleted successfully, including the booking form and LO draft attachments.");
      await fetchCases();
      setIsDeleting(false);
      setPendingDelete(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Sales case deleted, but attachment cleanup failed: ${err.message}`
          : "Sales case deleted, but attachment cleanup failed."
      );
      await fetchCases();
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const handleNoted = async (record: SalesCaseRecord) => {
    setError(null);
    setSuccess(null);
    setIsNotingId(record.id);

    const { data, error: updateError } = await supabase
      .from("sales_cases")
      .update({
        edit_reviewed_at: new Date().toISOString(),
        edit_reviewed_by: userId,
      })
      .eq("id", record.id)
      .select("id, edit_reviewed_at, edit_reviewed_by");

    if (updateError) {
      setError(updateError.message);
      setIsNotingId(null);
      return;
    }

    if (!data || data.length === 0) {
      setError("Unable to mark as noted. Please check your permissions.");
      setIsNotingId(null);
      return;
    }

    setSuccess("Edit marked as noted.");
    await fetchCases();
    setIsNotingId(null);
  };

  const handleSendApproval = (record: SalesCaseRecord) => {
    if (normalizeCaseStatus(record.status) !== "Claimable") {
      setError("Only Claimable cases can be sent to Cases Approval.");
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);

    void (async () => {
      const { data, error: updateError } = await supabase
        .from("sales_cases")
        .update({
          commission_review_sent_at: new Date().toISOString(),
          commission_review_sent_by: userId,
        })
        .eq("id", record.id)
        .eq("status", "Claimable")
        .select("id");

      if (updateError) {
        setError(updateError.message);
        return;
      }

      if (!data || data.length === 0) {
        setError("Only Claimable cases can be sent to Cases Approval.");
        return;
      }

      setSuccess("Case sent to Cases Approval.");
      await fetchCases();
    })();
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Manage Cases</h2>
          <p className="text-gray-500 text-sm mt-1">
            View sales cases submitted by all users.
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

      <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2 xl:grid-cols-6">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyGDV)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Nett Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyNettSales)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySales)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyConverted)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Number of Cases</p>
          <p className="text-2xl font-bold text-gray-900">{totalMonthlyCaseCount}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out To Agent</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyPaidOut)}</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px_220px]">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Search Cases</label>
            <input
              type="text"
              value={caseSearchTerm}
              onChange={(event) => setCaseSearchTerm(event.target.value)}
              placeholder="Search by created by, project name, or unit name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
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
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Agent</label>
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All agents</option>
              {availableAgentOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
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
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              <option value="all">All status</option>
              {[...MANAGE_CASE_STATUS_OPTIONS, "Completed"].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Created Date</th>
                <th className="py-2">Booking Date</th>
                <th className="py-2">Project</th>
                <th className="py-2">Unit</th>
                <th className="py-2">SPA Price (RM)</th>
                <th className="py-2">Nett Price (RM)</th>
                <th className="py-2">Created By</th>
                <th className="py-2">Booking Form</th>
                <th className="py-2">Case Status</th>
                <th className="py-2">Delete Request</th>
                <th className="py-2">Edited</th>
                <th className="py-2">Reviewed</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((record) => {
                const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
                const projectName = record.project_id
                  ? project?.project_name || "-"
                  : "-";
                const creator = record.created_by
                  ? profileMap.get(record.created_by)?.name ||
                    profileMap.get(record.created_by)?.email ||
                    "-"
                  : "-";
                const deleteRequester = record.delete_requested_by
                  ? profileMap.get(record.delete_requested_by)?.name ||
                    profileMap.get(record.delete_requested_by)?.email ||
                    "-"
                  : "-";
                const editorLabel = record.edited_by
                  ? profileMap.get(record.edited_by)?.name ||
                    profileMap.get(record.edited_by)?.email ||
                    "-"
                  : "-";
                const reviewerLabel = record.edit_reviewed_by
                  ? profileMap.get(record.edit_reviewed_by)?.name ||
                    profileMap.get(record.edit_reviewed_by)?.email ||
                    "-"
                  : "-";
                const editedAt = record.edited_at ? new Date(record.edited_at) : null;
                const reviewedAt = record.edit_reviewed_at
                  ? new Date(record.edit_reviewed_at)
                  : null;
                const createdAt = record.created_at ? new Date(record.created_at) : null;
                const bookingDate = record.booking_date ? new Date(record.booking_date) : null;
                const needsReview = editedAt && (!reviewedAt || reviewedAt < editedAt);
                const status = normalizeCaseStatus(record.status);
                const isLocked = isCaseLockedForEditing(record.status);
                const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
                  (payout) => payout.payout_type !== "tier_upgrade_top_up"
                );
                const allRelatedPaid = relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid");
                const displayStatus = allRelatedPaid ? "Completed" : status;

                return (
                  <tr key={record.id} className="border-b border-gray-50">
                    <td className="py-3 text-gray-600">
                      {createdAt ? createdAt.toLocaleDateString() : "-"}
                    </td>
                    <td className="py-3 text-gray-600">
                      {bookingDate ? bookingDate.toLocaleDateString() : "-"}
                    </td>
                    <td className="py-3 text-gray-600">{projectName}</td>
                    <td className="py-3 text-gray-600">{record.unit_number || "-"}</td>
                    <td className="py-3 text-gray-600">{formatAmount(record.spa_price)}</td>
                    <td className="py-3 text-gray-600">{formatAmount(record.nett_price)}</td>
                    <td className="py-3 text-gray-600">{creator}</td>
                    <td className="py-3 text-gray-600">
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
                    <td className="py-3 text-gray-600">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getCaseStatusClasses(displayStatus)}`}
                      >
                        {displayStatus}
                      </span>
                    </td>
                    <td className="py-3 text-gray-600">
                      {record.delete_requested ? (
                        <div>
                          <div className="text-xs font-medium text-red-600">Requested</div>
                          <div className="text-xs text-gray-500">{deleteRequester}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 text-gray-600">
                      {editedAt ? (
                        <div>
                          <div className="text-xs font-medium text-gray-700">
                            {editedAt.toLocaleDateString()}
                          </div>
                          <div className="text-xs text-gray-500">{editorLabel}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 text-gray-600">
                      {reviewedAt ? (
                        <div>
                          <div className="text-xs font-medium text-gray-700">
                            {reviewedAt.toLocaleDateString()}
                          </div>
                          <div className="text-xs text-gray-500">{reviewerLabel}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        {status === "Claimable" && !record.commission_review_sent_at && (
                          <button
                            type="button"
                            onClick={() => handleSendApproval(record)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-600 hover:text-blue-700"
                          >
                            <Send className="h-3 w-3" />
                            Send Approval
                          </button>
                        )}
                        {status === "Claimable" && record.commission_review_sent_at && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-blue-100 bg-blue-50 text-blue-700">
                            Sent to Cases Approval
                          </span>
                        )}
                        {needsReview && (
                          <button
                            type="button"
                            onClick={() => handleNoted(record)}
                            disabled={isNotingId === record.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-amber-200 text-amber-700 hover:text-amber-800 disabled:opacity-60"
                          >
                            {isNotingId === record.id ? "Noting..." : "Noted"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCase(record);
                            setIsReadOnlyModal(isLocked);
                            setIsModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:text-gray-900"
                        >
                          <Pencil className="h-3 w-3" />
                          {isLocked ? "View" : "Edit"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredCases.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-6 text-center text-gray-500">
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
          allowCaseOwnerSelection={!editingCase}
          enableWorkflowFields={caseWorkflowEnabled}
          allowStatusEdit={caseWorkflowEnabled && !isReadOnlyModal}
          allowLoDraftUpload={caseWorkflowEnabled && !isReadOnlyModal}
          statusOptions={MANAGE_CASE_STATUS_OPTIONS}
          paidReceiptRows={selectedCasePaidReceiptRows}
          onDelete={editingCase ? () => setPendingDelete(editingCase) : undefined}
          onClose={() => {
            setIsModalOpen(false);
            setIsReadOnlyModal(false);
            setEditingCase(null);
          }}
          onSaved={() => fetchCases()}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Confirm deletion</h3>
              <p className="text-sm text-gray-500 mt-1">
                Delete case for
                <span className="font-medium text-gray-800">
                  {" "}
                  {pendingDelete.project_id
                    ? projectMap.get(pendingDelete.project_id)?.project_name || "-"
                    : "-"}
                </span>
                {pendingDelete.unit_number ? ` (Unit ${pendingDelete.unit_number})` : ""}?
              </p>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(pendingDelete)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
