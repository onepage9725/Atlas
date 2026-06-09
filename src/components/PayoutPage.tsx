import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { fetchNotificationProfiles, getNotificationProfileLabel, notifyCaseAudience, notifyPayoutPaid } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";
import {
  getCaseCommissionStructure,
  getProjectCommissionStructures,
  getShortCommissionStructureLabel,
} from "../lib/commissionStructures";
import { buildTierUpgradeTopUpStructure } from "../lib/salesCasePayouts";
import {
  hasCaseWorkflowColumns,
  MANAGE_CASE_STATUS_OPTIONS,
  SalesCaseModal,
  type ProjectOption,
  type SalesCasePayoutRecord,
  type SalesCaseRecord,
} from "./SalesCaseModal";

type ProfileOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type FinanceEntryRecord = {
  id: string;
  entry_type: "cash_in" | "cash_out";
  amount: number;
  description: string | null;
  reference_label: string | null;
  reference_detail: string | null;
  attachment_url: string | null;
  transacted_at: string;
  created_by: string | null;
  created_at: string;
  sales_case_id: string | null;
  entry_scope: string | null;
  payout_type?: string | null;
  source_commission_structure_id?: string | null;
  target_commission_structure_id?: string | null;
};

type CaseActionTarget = {
  id: string;
  salesCaseId: string;
};

type PayoutDisplayRow =
  | {
      id: string;
      rowType: "member";
      payout: SalesCasePayoutRecord;
      record: SalesCaseRecord | null;
      project: ProjectOption | null;
      memberLabel: string;
      spaPrice: number | null;
      nettPrice: number | null;
      commissionPercentage: number;
      preLeaderOverridePercentage: number;
      leaderOverridePercentage: number;
      amount: number;
      payoutLabel: string | null;
      paidAt: string | null;
      paymentReceiptUrl: string | null;
    }
  | {
      id: string;
      rowType: "company";
      salesCaseId: string;
      record: SalesCaseRecord | null;
      project: ProjectOption | null;
      memberLabel: "Company";
      spaPrice: number | null;
      nettPrice: number | null;
      commissionPercentage: number;
      preLeaderOverridePercentage: 0;
      leaderOverridePercentage: 0;
      totalAmount: number;
      amount: number;
      payoutLabel: string | null;
      payoutType: "standard" | "tier_upgrade_top_up";
      sourceCommissionStructureId: string | null;
      targetCommissionStructureId: string | null;
      paidAt: string | null;
      paymentReceiptUrl: string | null;
    };

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Number(value.toFixed(2));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const formatPercentage = (value: number) => {
  if (value === 0) return "-";
  const roundedValue = Number(value.toFixed(3));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;
  return `${roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 1 : 0,
    maximumFractionDigits: 3,
  })}%`;
};

const sanitizeFileName = (fileName: string) => {
  const extensionIndex = fileName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const baseName = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
  const extension = hasExtension ? fileName.slice(extensionIndex).toLowerCase() : "";
  const normalizedBaseName = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${normalizedBaseName || "file"}${extension}`;
};

const getStoragePathFromPublicUrl = (publicUrl: string | null) => {
  if (!publicUrl) {
    return null;
  }

  try {
    const { pathname } = new URL(publicUrl);
    const publicPrefix = "/storage/v1/object/public/cases/";
    const pathIndex = pathname.indexOf(publicPrefix);

    if (pathIndex === -1) {
      return null;
    }

    return decodeURIComponent(pathname.slice(pathIndex + publicPrefix.length));
  } catch {
    return null;
  }
};

const getLocalDateInputValue = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

const getMemberPayoutLabel = (payout: SalesCasePayoutRecord) => {
  if (payout.payout_type !== "tier_upgrade_top_up") {
    return null;
  }

  const sourceLabel =
    getShortCommissionStructureLabel(payout.source_commission_structure_label) ||
    payout.source_commission_structure_id ||
    "Previous Tier";
  const targetLabel =
    getShortCommissionStructureLabel(payout.target_commission_structure_label) ||
    payout.target_commission_structure_id ||
    "New Tier";
  return `${sourceLabel} -> ${targetLabel}`;
};

const getCompanyReceiptKey = (
  salesCaseId: string,
  payoutType: string | null | undefined,
  sourceCommissionStructureId: string | null | undefined,
  targetCommissionStructureId: string | null | undefined,
) =>
  [
    salesCaseId,
    payoutType || "standard",
    sourceCommissionStructureId || "base",
    targetCommissionStructureId || "base",
  ].join(":");

const getCompanyPayoutLabel = (
  payoutType: "standard" | "tier_upgrade_top_up",
  sourceCommissionStructureLabel: string | null | undefined,
  targetCommissionStructureLabel: string | null | undefined,
) => {
  if (payoutType !== "tier_upgrade_top_up") {
    return null;
  }

  const sourceLabel = getShortCommissionStructureLabel(sourceCommissionStructureLabel) || "Previous Tier";
  const targetLabel = getShortCommissionStructureLabel(targetCommissionStructureLabel) || "New Tier";
  return `${sourceLabel} -> ${targetLabel}`;
};

const getCompanyRowKey = (
  salesCaseId: string,
  payoutType: string | null | undefined,
  sourceCommissionStructureId: string | null | undefined,
  targetCommissionStructureId: string | null | undefined,
) =>
  getCompanyReceiptKey(
    salesCaseId,
    payoutType,
    sourceCommissionStructureId,
    targetCommissionStructureId,
  );

export function PayoutPage({ userId }: { userId: string }) {
  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [companyReceipts, setCompanyReceipts] = useState<FinanceEntryRecord[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUpdatingId, setIsUpdatingId] = useState<string | null>(null);
  const [pendingPaid, setPendingPaid] = useState<SalesCasePayoutRecord | null>(null);
  const [pendingReject, setPendingReject] = useState<CaseActionTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CaseActionTarget | null>(null);
  const [pendingCompanyReceive, setPendingCompanyReceive] = useState<Extract<PayoutDisplayRow, { rowType: "company" }> | null>(null);
  const [selectedCase, setSelectedCase] = useState<SalesCaseRecord | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [payoutDate, setPayoutDate] = useState(() => getLocalDateInputValue(new Date()));
  const [companyReceiptFile, setCompanyReceiptFile] = useState<File | null>(null);
  const [companyReceiveAmount, setCompanyReceiveAmount] = useState("");
  const [companyReceiveDate, setCompanyReceiveDate] = useState(() => getLocalDateInputValue(new Date()));
  const [companyReceiveReference, setCompanyReceiveReference] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const companyReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const caseWorkflowEnabled = useMemo(
    () => cases.some((record) => hasCaseWorkflowColumns(record)),
    [cases]
  );
  const pendingDeletePayout = useMemo(
    () => (pendingDelete ? payouts.find((row) => row.id === pendingDelete.id) ?? null : null),
    [pendingDelete, payouts]
  );

  const caseMap = useMemo(() => {
    const map = new Map<string, SalesCaseRecord>();
    cases.forEach((record) => map.set(record.id, record));
    return map;
  }, [cases]);

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

  const companyReceiptSummary = useMemo(() => {
    const summaryMap = new Map<string, { totalReceived: number; latestReceivedAt: string | null; latestReceiptUrl: string | null }>();
    const hiddenKeys = new Set<string>();

    companyReceipts.forEach((entry) => {
      if (!entry.sales_case_id) {
        return;
      }

      const summaryKey = getCompanyReceiptKey(
        entry.sales_case_id,
        entry.payout_type,
        entry.source_commission_structure_id,
        entry.target_commission_structure_id,
      );

      if (entry.entry_scope === "company_commission_hidden") {
        hiddenKeys.add(summaryKey);
        return;
      }

      const existingSummary = summaryMap.get(summaryKey) ?? {
        totalReceived: 0,
        latestReceivedAt: null,
        latestReceiptUrl: null,
      };

      existingSummary.totalReceived += entry.amount ?? 0;

      if (!existingSummary.latestReceivedAt || new Date(entry.transacted_at).getTime() > new Date(existingSummary.latestReceivedAt).getTime()) {
        existingSummary.latestReceivedAt = entry.transacted_at;
        existingSummary.latestReceiptUrl = entry.attachment_url;
      }

      summaryMap.set(summaryKey, existingSummary);
    });

    return { summaryMap, hiddenKeys };
  }, [companyReceipts]);

  const payoutDisplayRows = useMemo<PayoutDisplayRow[]>(() => {
    const memberRows: PayoutDisplayRow[] = payouts
      .filter((payout) => payout.payout_status !== "Paid")
      .map((payout) => {
      const record = caseMap.get(payout.sales_case_id) ?? null;
      const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
      const member = profileMap.get(payout.profile_id) ?? null;

      return {
        id: payout.id,
        rowType: "member",
        payout,
        record,
        project,
        memberLabel: member?.name || member?.email || "-",
        spaPrice: record?.spa_price ?? null,
        nettPrice: record?.nett_price ?? null,
        commissionPercentage: payout.agent_commission_percentage,
        preLeaderOverridePercentage: payout.pre_leader_override_percentage,
        leaderOverridePercentage: payout.leader_override_percentage,
        amount: payout.total_amount,
        payoutLabel: getMemberPayoutLabel(payout),
        paidAt: payout.paid_at,
        paymentReceiptUrl: payout.payment_receipt_url,
      };
    });

    const standardCompanyRows: PayoutDisplayRow[] = Array.from(
      new Set(
        payouts.filter((payout) => payout.payout_type === "standard").map((payout) => payout.sales_case_id)
      )
    ).flatMap((salesCaseId) => {
      const record = caseMap.get(salesCaseId) ?? null;
      const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
      const commissionStructure = getCaseCommissionStructure(record, project);
      const receiptKey = getCompanyRowKey(salesCaseId, "standard", null, null);
      const receiptSummary = companyReceiptSummary.summaryMap.get(receiptKey);

      if (
        !record ||
        !project ||
        !commissionStructure ||
        record.nett_price === null ||
        (commissionStructure.company_commission ?? 0) === 0 ||
        companyReceiptSummary.hiddenKeys.has(receiptKey)
      ) {
        return [];
      }

      const grossCompanyAmount = Number(((record.nett_price * (commissionStructure.company_commission ?? 0)) / 100).toFixed(2));
      const totalReceived = Number((receiptSummary?.totalReceived ?? 0).toFixed(2));
      const remainingAmount = Number(Math.max(grossCompanyAmount - totalReceived, 0).toFixed(2));

      if (remainingAmount <= 0) {
        return [];
      }

      return [{
        id: `company-${salesCaseId}`,
        rowType: "company" as const,
        salesCaseId,
        record,
        project,
        memberLabel: "Company" as const,
        spaPrice: record.spa_price,
        nettPrice: record.nett_price,
        commissionPercentage: commissionStructure.company_commission ?? 0,
        preLeaderOverridePercentage: 0,
        leaderOverridePercentage: 0,
        totalAmount: grossCompanyAmount,
        amount: remainingAmount,
        payoutLabel: null,
        payoutType: "standard" as const,
        sourceCommissionStructureId: null,
        targetCommissionStructureId: null,
        paidAt: receiptSummary?.latestReceivedAt ?? null,
        paymentReceiptUrl: receiptSummary?.latestReceiptUrl ?? null,
      }];
    });

    const topUpCompanyRows: PayoutDisplayRow[] = Array.from(
      new Map(
        payouts
          .filter((payout) => payout.payout_type === "tier_upgrade_top_up")
          .map((payout) => [
            getCompanyReceiptKey(
              payout.sales_case_id,
              payout.payout_type,
              payout.source_commission_structure_id,
              payout.target_commission_structure_id,
            ),
            payout,
          ])
      ).values()
    ).flatMap((payout) => {
      const record = caseMap.get(payout.sales_case_id) ?? null;
      const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
      const projectStructures = getProjectCommissionStructures(project);
      const sourceStructure = projectStructures.find((structure) => structure.id === payout.source_commission_structure_id);
      const targetStructure = projectStructures.find((structure) => structure.id === payout.target_commission_structure_id);
      const topUpStructure =
        sourceStructure && targetStructure
          ? buildTierUpgradeTopUpStructure(sourceStructure, targetStructure)
          : null;
      const receiptKey = getCompanyRowKey(
        payout.sales_case_id,
        payout.payout_type,
        payout.source_commission_structure_id,
        payout.target_commission_structure_id,
      );
      const receiptSummary = companyReceiptSummary.summaryMap.get(receiptKey);

      if (
        !record ||
        !project ||
        !topUpStructure ||
        record.nett_price === null ||
        (topUpStructure.company_commission ?? 0) === 0 ||
        companyReceiptSummary.hiddenKeys.has(receiptKey)
      ) {
        return [];
      }

      const grossCompanyAmount = Number(((record.nett_price * (topUpStructure.company_commission ?? 0)) / 100).toFixed(2));
      const totalReceived = Number((receiptSummary?.totalReceived ?? 0).toFixed(2));
      const remainingAmount = Number(Math.max(grossCompanyAmount - totalReceived, 0).toFixed(2));

      if (remainingAmount <= 0) {
        return [];
      }

      return [{
        id: `company-${receiptKey}`,
        rowType: "company" as const,
        salesCaseId: payout.sales_case_id,
        record,
        project,
        memberLabel: "Company" as const,
        spaPrice: record.spa_price,
        nettPrice: record.nett_price,
        commissionPercentage: topUpStructure.company_commission ?? 0,
        preLeaderOverridePercentage: 0,
        leaderOverridePercentage: 0,
        totalAmount: grossCompanyAmount,
        amount: remainingAmount,
        payoutLabel: getCompanyPayoutLabel(
          "tier_upgrade_top_up",
          payout.source_commission_structure_label,
          payout.target_commission_structure_label,
        ),
        payoutType: "tier_upgrade_top_up" as const,
        sourceCommissionStructureId: payout.source_commission_structure_id,
        targetCommissionStructureId: payout.target_commission_structure_id,
        paidAt: receiptSummary?.latestReceivedAt ?? null,
        paymentReceiptUrl: receiptSummary?.latestReceiptUrl ?? null,
      }];
    });

    return [...memberRows, ...standardCompanyRows, ...topUpCompanyRows].sort((left, right) => {
      const leftCreatedAt = left.record?.created_at ? new Date(left.record.created_at).getTime() : 0;
      const rightCreatedAt = right.record?.created_at ? new Date(right.record.created_at).getTime() : 0;
      if (rightCreatedAt !== leftCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
      }

      if (left.rowType === right.rowType) {
        return 0;
      }

      return left.rowType === "company" ? 1 : -1;
    });
  }, [caseMap, companyReceiptSummary, payouts, profileMap, projectMap]);

  const pendingDeleteCompanyRow = useMemo(
    () =>
      pendingDelete
        ? payoutDisplayRows.find(
            (row): row is Extract<PayoutDisplayRow, { rowType: "company" }> =>
              row.id === pendingDelete.id && row.rowType === "company"
          ) ?? null
        : null,
    [pendingDelete, payoutDisplayRows]
  );

  const companyPendingCaseCount = useMemo(
    () => payoutDisplayRows.filter((row) => row.rowType === "company").length,
    [payoutDisplayRows]
  );

  const companyPendingComm = useMemo(
    () =>
      payoutDisplayRows.reduce(
        (sum, row) => sum + (row.rowType === "company" ? row.amount : 0),
        0
      ),
    [payoutDisplayRows]
  );

  const pendingCompanyReceiveHistory = useMemo(() => {
    if (!pendingCompanyReceive) {
      return [] as FinanceEntryRecord[];
    }

    return companyReceipts
      .filter(
        (entry) =>
          entry.sales_case_id === pendingCompanyReceive.salesCaseId &&
          getCompanyReceiptKey(
            entry.sales_case_id,
            entry.payout_type,
            entry.source_commission_structure_id,
            entry.target_commission_structure_id,
          ) ===
            getCompanyReceiptKey(
              pendingCompanyReceive.salesCaseId,
              pendingCompanyReceive.payoutType,
              pendingCompanyReceive.sourceCommissionStructureId,
              pendingCompanyReceive.targetCommissionStructureId,
            ) &&
          entry.entry_scope === "company_commission"
      )
      .sort((left, right) => {
        const rightTime = new Date(right.transacted_at || right.created_at).getTime();
        const leftTime = new Date(left.transacted_at || left.created_at).getTime();
        return rightTime - leftTime;
      });
  }, [companyReceipts, pendingCompanyReceive]);

  const agentPendingCaseCount = useMemo(
    () =>
      payoutDisplayRows.filter(
        (row) => row.rowType === "member" && row.payout.payout_status !== "Paid"
      ).length,
    [payoutDisplayRows]
  );

  const agentPendingComm = useMemo(
    () =>
      payoutDisplayRows.reduce(
        (sum, row) =>
          sum + (row.rowType === "member" && row.payout.payout_status !== "Paid" ? row.amount : 0),
        0
      ),
    [payoutDisplayRows]
  );

  const fetchData = async () => {
    setError(null);

    const [{ data: payoutData, error: payoutError }, { data: companyReceiptData, error: companyReceiptError }] =
      await Promise.all([
        supabase
          .from("sales_case_payouts")
          .select("*")
          .neq("payout_status", "Reject")
          .order("created_at", { ascending: false }),
        supabase
          .from("finance_entries")
          .select("*")
          .in("entry_scope", ["company_commission", "company_commission_hidden"])
          .order("transacted_at", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

    if (payoutError) {
      setError(payoutError.message);
      return;
    }

    if (companyReceiptError) {
      setError(companyReceiptError.message);
      return;
    }

    const nextPayouts = (payoutData as SalesCasePayoutRecord[]) ?? [];
    const nextCompanyReceipts = (companyReceiptData as FinanceEntryRecord[]) ?? [];
    setPayouts(nextPayouts);
    setCompanyReceipts(nextCompanyReceipts);

    const salesCaseIds = Array.from(new Set(nextPayouts.map((row) => row.sales_case_id)));
    const profileIds = Array.from(new Set(nextPayouts.map((row) => row.profile_id)));

    if (salesCaseIds.length === 0) {
      setCases([]);
      setProjects([]);
      setProfiles([]);
      return;
    }

    const [{ data: caseData, error: caseError }, { data: profileData, error: profileError }] =
      await Promise.all([
        supabase.from("sales_cases").select("*").in("id", salesCaseIds),
        supabase.from("profiles").select("id, name, email").in("id", profileIds),
      ]);

    if (caseError) {
      setError(caseError.message);
      return;
    }

    if (profileError) {
      setError(profileError.message);
      return;
    }

    const nextCases = (caseData as SalesCaseRecord[]) ?? [];
    setCases(nextCases);
    setProfiles((profileData as ProfileOption[]) ?? []);

    const projectIds = Array.from(
      new Set(nextCases.map((record) => record.project_id).filter(Boolean))
    ) as string[];

    if (projectIds.length === 0) {
      setProjects([]);
      return;
    }

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(
        "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
      )
      .in("id", projectIds);

    if (projectError) {
      setError(projectError.message);
      return;
    }

    setProjects((projectData as ProjectOption[]) ?? []);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updatePayoutStatus = async (
    payout: SalesCasePayoutRecord,
    nextStatus: SalesCasePayoutRecord["payout_status"],
    extraFields: Partial<SalesCasePayoutRecord> = {}
  ) => {
    setError(null);
    setSuccess(null);
    setIsUpdatingId(payout.id);

    const { data, error: updateError } = await supabase
      .from("sales_case_payouts")
      .update({ payout_status: nextStatus, ...extraFields })
      .eq("id", payout.id)
      .select("id, payout_status");

    if (updateError) {
      setError(updateError.message);
      setIsUpdatingId(null);
      return false;
    }

    if (!data || data.length === 0) {
      setError("Unable to update payout row. Please refresh and try again.");
      setIsUpdatingId(null);
      return false;
    }

    await fetchData();
    setIsUpdatingId(null);
    return true;
  };

  const handleReject = async () => {
    if (!pendingReject) {
      return;
    }

    const targetPayout = payouts.find((row) => row.id === pendingReject.id) ?? null;

    if (targetPayout?.payout_type === "tier_upgrade_top_up") {
      setError(null);
      setSuccess(null);
      setIsUpdatingId(targetPayout.id);

      const { error: deleteTopUpError } = await supabase
        .from("sales_case_payouts")
        .delete()
        .eq("id", targetPayout.id);

      if (deleteTopUpError) {
        setError(deleteTopUpError.message);
        setIsUpdatingId(null);
        return;
      }

      await fetchData();
      setPendingReject(null);
      setIsUpdatingId(null);
      setSuccess("Top-up payout row removed.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsUpdatingId(pendingReject.id);

    const { error: deleteError } = await supabase
      .from("sales_case_payouts")
      .delete()
      .eq("sales_case_id", pendingReject.salesCaseId);

    if (deleteError) {
      setError(deleteError.message);
      setIsUpdatingId(null);
      return;
    }

    const { data, error: updateError } = await supabase
      .from("sales_cases")
      .update({
        status: "Reject",
        edited_at: new Date().toISOString(),
        edited_by: userId,
        edit_reviewed_at: null,
        edit_reviewed_by: null,
      })
      .eq("id", pendingReject.salesCaseId)
      .eq("status", "Approve")
      .select("id, status");

    if (updateError) {
      setError(updateError.message);
      setIsUpdatingId(null);
      return;
    }

    if (!data || data.length === 0) {
      setError("Unable to reject this payout case. Please refresh and try again.");
      setIsUpdatingId(null);
      return;
    }

    await fetchData();
    setPendingReject(null);
    setIsUpdatingId(null);
    setSuccess("Payout case rejected. All involved payout rows were removed and the case status is now Reject.");
  };

  const handleDeleteCase = async () => {
    if (!pendingDelete) {
      return;
    }

    if (deleteConfirmationText !== "CONFIRM") {
      setError('Please type "CONFIRM" before deleting this case.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsUpdatingId(pendingDelete.id);

    if (pendingDeleteCompanyRow?.payoutType === "tier_upgrade_top_up") {
      const hiddenReferenceLabel = [
        pendingDeleteCompanyRow.project?.project_name,
        pendingDeleteCompanyRow.record?.unit_number ? `Unit ${pendingDeleteCompanyRow.record.unit_number}` : null,
      ]
        .filter(Boolean)
        .join(" - ");

      const { error: hideError } = await supabase.from("finance_entries").insert({
        entry_type: "cash_out",
        amount: 0,
        description: "Hidden top-up company commission row",
        reference_label: hiddenReferenceLabel || "Company commission",
        reference_detail: pendingDeleteCompanyRow.payoutLabel,
        attachment_url: null,
        transacted_at: new Date().toISOString(),
        created_by: userId,
        sales_case_id: pendingDeleteCompanyRow.salesCaseId,
        entry_scope: "company_commission_hidden",
        payout_type: pendingDeleteCompanyRow.payoutType,
        source_commission_structure_id: pendingDeleteCompanyRow.sourceCommissionStructureId,
        target_commission_structure_id: pendingDeleteCompanyRow.targetCommissionStructureId,
      });

      if (hideError) {
        setError(hideError.message);
        setIsUpdatingId(null);
        return;
      }

      await fetchData();
      setPendingDelete(null);
      setDeleteConfirmationText("");
      setIsUpdatingId(null);
      setSuccess("Company top-up row removed from the payout page.");
      return;
    }

    const targetPayout = payouts.find((row) => row.id === pendingDelete.id) ?? null;

    if (targetPayout?.payout_type === "tier_upgrade_top_up") {
      const receiptPath = getStoragePathFromPublicUrl(targetPayout.payment_receipt_url);
      const { error: deleteTopUpError } = await supabase
        .from("sales_case_payouts")
        .delete()
        .eq("id", targetPayout.id);

      if (deleteTopUpError) {
        setError(deleteTopUpError.message);
        setIsUpdatingId(null);
        return;
      }

      if (receiptPath) {
        await supabase.storage.from("cases").remove([receiptPath]).catch(() => undefined);
      }

      await fetchData();
      setPendingDelete(null);
      setDeleteConfirmationText("");
      setIsUpdatingId(null);
      setSuccess("Top-up payout row deleted successfully.");
      return;
    }

    const targetCase = caseMap.get(pendingDelete.salesCaseId) ?? null;

    const receiptPaths = payouts
      .filter((payout) => payout.sales_case_id === pendingDelete.salesCaseId)
      .map((payout) => getStoragePathFromPublicUrl(payout.payment_receipt_url))
      .filter((path): path is string => Boolean(path));

    const companyReceiptPaths = companyReceipts
      .filter((entry) => entry.sales_case_id === pendingDelete.salesCaseId)
      .map((entry) => getStoragePathFromPublicUrl(entry.attachment_url))
      .filter((path): path is string => Boolean(path));

    const { error: deleteError } = await supabase
      .from("sales_cases")
      .delete()
      .eq("id", pendingDelete.salesCaseId);

    if (deleteError) {
      setError(deleteError.message);
      setIsUpdatingId(null);
      return;
    }

    const allReceiptPaths = Array.from(new Set([...receiptPaths, ...companyReceiptPaths]));

    if (allReceiptPaths.length > 0) {
      const { error: storageDeleteError } = await supabase.storage.from("cases").remove(allReceiptPaths);

      if (storageDeleteError) {
        setError(`Case deleted, but receipt cleanup failed: ${storageDeleteError.message}`);
        await fetchData();
        setPendingDelete(null);
        setDeleteConfirmationText("");
        setIsUpdatingId(null);
        return;
      }
    }

    try {
      const notificationProfiles = await fetchNotificationProfiles();
      const actorLabel = getNotificationProfileLabel(userId, notificationProfiles);

      await notifyCaseAudience({
        actorUserId: userId,
        salesCaseId: null,
        caseOwnerId: targetCase?.created_by ?? userId,
        involvedProfileId: targetCase?.involved_profile_id ?? null,
        title: "Sales case deleted",
        message: `${actorLabel} deleted the sales case for ${targetCase?.project_id ? projectMap.get(targetCase.project_id)?.project_name || "Unnamed project" : "Unnamed project"}, ${targetCase?.unit_number ? `Unit ${targetCase.unit_number}` : "Unit -"}.`,
        profiles: notificationProfiles,
        commissionRows: payouts
          .filter((payout) => payout.sales_case_id === pendingDelete.salesCaseId)
          .map((payout) => ({ profileId: payout.profile_id })),
      });
    } catch (notificationError) {
      console.error("Failed to create delete notifications for payout case", notificationError);
    }

    await fetchData();
    setPendingDelete(null);
    setDeleteConfirmationText("");
    setIsUpdatingId(null);
    setSuccess("Case deleted successfully. The unit and all related payout rows were removed.");
  };

  const uploadReceipt = async () => {
    if (!paymentReceiptFile) {
      throw new Error("Please attach a payment receipt before marking this payout as paid.");
    }

    const filePath = `payout-receipts/${userId}/${Date.now()}-${sanitizeFileName(paymentReceiptFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, paymentReceiptFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handlePaid = async () => {
    if (!pendingPaid) {
      return;
    }

    if (!payoutDate) {
      setError("Please select the payout date.");
      return;
    }

    try {
      const receiptUrl = await uploadReceipt();
      const successState = await updatePayoutStatus(pendingPaid, "Paid", {
        payment_receipt_url: receiptUrl,
        paid_at: new Date(`${payoutDate}T00:00:00`).toISOString(),
        paid_by: userId,
      });

      if (successState) {
        try {
          const record = caseMap.get(pendingPaid.sales_case_id) ?? null;
          const projectName = record?.project_id ? projectMap.get(record.project_id)?.project_name ?? null : null;

          await notifyPayoutPaid({
            actorUserId: userId,
            recipientId: pendingPaid.profile_id,
            salesCaseId: pendingPaid.sales_case_id,
            projectName,
            unitNumber: record?.unit_number || null,
            amount: pendingPaid.total_amount,
          });
        } catch (notificationError) {
          console.error("Failed to create payout paid notification", notificationError);
        }

        setSuccess("Payout marked as paid.");
        setPendingPaid(null);
        setPaymentReceiptFile(null);
        setPayoutDate(getLocalDateInputValue(new Date()));
      } else {
        const receiptPath = getStoragePathFromPublicUrl(receiptUrl);
        if (receiptPath) {
          await supabase.storage.from("cases").remove([receiptPath]).catch(() => undefined);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload the payment receipt.");
    }
  };

  const uploadCompanyReceipt = async () => {
    if (!companyReceiptFile) {
      throw new Error("Please attach a developer receipt before recording the payment.");
    }

    const filePath = `company-commission-receipts/${userId}/${Date.now()}-${sanitizeFileName(companyReceiptFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, companyReceiptFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleCompanyReceive = async () => {
    if (!pendingCompanyReceive) {
      return;
    }

    const parsedAmount = Number(companyReceiveAmount);

    if (!companyReceiveDate) {
      setError("Please select the received date.");
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid received amount greater than zero.");
      return;
    }

    if (parsedAmount > pendingCompanyReceive.amount) {
      setError("Received amount cannot be more than the remaining company commission.");
      return;
    }

    if (!companyReceiveReference.trim()) {
      setError("Please enter the payment reference.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsUpdatingId(pendingCompanyReceive.id);

    let attachmentUrl: string | null = null;

    try {
      attachmentUrl = await uploadCompanyReceipt();

      const caseName = [pendingCompanyReceive.project?.project_name, pendingCompanyReceive.record?.unit_number ? `Unit ${pendingCompanyReceive.record.unit_number}` : null]
        .filter(Boolean)
        .join(" - ");

      const { error: insertError } = await supabase.from("finance_entries").insert({
        entry_type: "cash_in",
        amount: Number(parsedAmount.toFixed(2)),
        description: "Company commission received from developer",
        reference_label: caseName || "Company commission",
        reference_detail: companyReceiveReference.trim(),
        attachment_url: attachmentUrl,
        transacted_at: new Date(`${companyReceiveDate}T00:00:00`).toISOString(),
        created_by: userId,
        sales_case_id: pendingCompanyReceive.salesCaseId,
        entry_scope: "company_commission",
        payout_type: pendingCompanyReceive.payoutType,
        source_commission_structure_id: pendingCompanyReceive.sourceCommissionStructureId,
        target_commission_structure_id: pendingCompanyReceive.targetCommissionStructureId,
      });

      if (insertError) {
        if (attachmentUrl) {
          const attachmentPath = getStoragePathFromPublicUrl(attachmentUrl);
          if (attachmentPath) {
            await supabase.storage.from("cases").remove([attachmentPath]).catch(() => undefined);
          }
        }
        setError(insertError.message);
        setIsUpdatingId(null);
        return;
      }

      await fetchData();
      setPendingCompanyReceive(null);
      setCompanyReceiptFile(null);
      setCompanyReceiveAmount("");
      setCompanyReceiveDate(getLocalDateInputValue(new Date()));
      setCompanyReceiveReference("");
      setIsUpdatingId(null);
      setSuccess("Company commission receipt recorded and added to Finance.");
    } catch (err) {
      if (attachmentUrl) {
        const attachmentPath = getStoragePathFromPublicUrl(attachmentUrl);
        if (attachmentPath) {
          await supabase.storage.from("cases").remove([attachmentPath]).catch(() => undefined);
        }
      }
      setError(err instanceof Error ? err.message : "Unable to record the company receipt.");
      setIsUpdatingId(null);
    }
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Payout</h2>
          <p className="text-gray-500 text-sm mt-1">
            Review and settle commission payout rows for approved cases.
          </p>
        </div>
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

      <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Company Pending Case</p>
          <p className="text-2xl font-bold text-gray-900">{companyPendingCaseCount}</p>
          <p className="text-xs text-gray-500 mt-2">Cases waiting for developer payment.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Company Pending Comm</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(companyPendingComm)}</p>
          <p className="text-xs text-gray-500 mt-2">Company commission pending from developers.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Agent Pending Case</p>
          <p className="text-2xl font-bold text-gray-900">{agentPendingCaseCount}</p>
          <p className="text-xs text-gray-500 mt-2">Cases with unpaid member commission rows.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Agent Pending Comm</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(agentPendingComm)}</p>
          <p className="text-xs text-gray-500 mt-2">Total unpaid member commission amount.</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Member</th>
                <th className="py-2">Project &amp; Unit</th>
                <th className="py-2">SPA (RM)</th>
                <th className="py-2">Nett (RM)</th>
                <th className="py-2">Commission %</th>
                <th className="py-2">Pre Leader Override %</th>
                <th className="py-2">Leader Override %</th>
                <th className="py-2">Payout Comm (RM)</th>
                <th className="py-2">Payout Date</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {payoutDisplayRows.map((row) => {
                const isMemberRow = row.rowType === "member";
                const payout = isMemberRow ? row.payout : null;
                const companyRow = row.rowType === "company" ? row : null;
                const isBusy = payout ? isUpdatingId === payout.id : false;

                return (
                  <tr key={row.id} className="border-b border-gray-50">
                    <td className="py-3 text-gray-600">
                      <div className="font-medium text-gray-800">{row.memberLabel}</div>
                      {row.payoutLabel && (
                        <div className="text-xs text-amber-700">{row.payoutLabel}</div>
                      )}
                    </td>
                    <td className="py-3 text-gray-600">
                      <div className="font-medium text-gray-800">
                        {row.project?.project_name || "-"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {row.record?.unit_number ? `Unit ${row.record.unit_number}` : "-"}
                      </div>
                    </td>
                    <td className="py-3 text-gray-600">{formatAmount(row.spaPrice)}</td>
                    <td className="py-3 text-gray-600">{formatAmount(row.nettPrice)}</td>
                    <td className="py-3 text-gray-600">{formatPercentage(row.commissionPercentage)}</td>
                    <td className="py-3 text-gray-600">{formatPercentage(row.preLeaderOverridePercentage)}</td>
                    <td className="py-3 text-gray-600">{formatPercentage(row.leaderOverridePercentage)}</td>
                    <td className="py-3 text-gray-600">
                      {formatAmount(row.rowType === "company" ? row.totalAmount : row.amount)}
                    </td>
                    <td className="py-3 text-gray-600">
                      {row.paidAt ? new Date(row.paidAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="py-3">
                      {isMemberRow && payout ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => row.record && setSelectedCase(row.record)}
                            disabled={!row.record}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-700 hover:text-blue-800 disabled:opacity-60"
                          >
                            View
                          </button>
                          {payout.payout_type !== "tier_upgrade_top_up" && (
                            <button
                              type="button"
                              onClick={() => setPendingReject({ id: payout.id, salesCaseId: payout.sales_case_id })}
                              disabled={isBusy || payout.payout_status === "Paid"}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700 disabled:opacity-60"
                            >
                              Reject
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDelete({ id: payout.id, salesCaseId: payout.sales_case_id });
                              setDeleteConfirmationText("");
                            }}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-300 text-red-700 hover:text-red-800 disabled:opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingPaid(payout);
                              setPaymentReceiptFile(null);
                              setPayoutDate(getLocalDateInputValue(new Date()));
                            }}
                            disabled={isBusy || payout.payout_status === "Paid"}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-700 hover:text-blue-800 disabled:opacity-60"
                          >
                            {payout.payout_status === "Paid" ? "Complete" : "Paid"}
                          </button>
                          {row.paymentReceiptUrl && (
                            <a
                              href={row.paymentReceiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              Receipt
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => companyRow?.record && setSelectedCase(companyRow.record)}
                            disabled={!companyRow?.record}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-700 hover:text-blue-800 disabled:opacity-60"
                          >
                            View
                          </button>
                          {companyRow?.payoutType !== "tier_upgrade_top_up" && (
                            <>
                              <button
                                type="button"
                                onClick={() => companyRow && setPendingReject({ id: companyRow.id, salesCaseId: companyRow.salesCaseId })}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (!companyRow) {
                                return;
                              }

                              setPendingDelete({ id: companyRow.id, salesCaseId: companyRow.salesCaseId });
                              setDeleteConfirmationText("");
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-300 text-red-700 hover:text-red-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!companyRow) {
                                return;
                              }

                              setPendingCompanyReceive(companyRow);
                              setCompanyReceiptFile(null);
                              setCompanyReceiveAmount(companyRow.amount.toString());
                              setCompanyReceiveDate(getLocalDateInputValue(new Date()));
                              setCompanyReceiveReference("");
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          >
                            Receive
                          </button>
                          {row.paymentReceiptUrl && (
                            <a
                              href={row.paymentReceiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              Latest Receipt
                            </a>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {payoutDisplayRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-gray-500">
                    No payout rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingPaid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Attach payment receipt</h3>
              <p className="text-sm text-gray-500 mt-1">
                Upload a PDF or image before marking this payout row as paid.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payout Date</label>
                <input
                  type="date"
                  value={payoutDate}
                  onChange={(event) => setPayoutDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setPaymentReceiptFile(event.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                Upload Receipt
              </button>
              <div className="text-sm text-gray-500">
                {paymentReceiptFile?.name || "No file selected"}
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingPaid(null);
                  setPaymentReceiptFile(null);
                  setPayoutDate(getLocalDateInputValue(new Date()));
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePaid()}
                disabled={isUpdatingId === pendingPaid.id}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isUpdatingId === pendingPaid.id ? "Saving..." : "Mark Paid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Confirm rejection</h3>
              <p className="text-sm text-gray-500 mt-1">
                Rejecting this payout case will remove all people involved from the payout table and make the case editable again.
              </p>
            </div>
            <div className="px-5 py-4 text-sm text-gray-600 space-y-1">
              <div>
                Project: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingReject.salesCaseId) ?? null;
                  const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
                  return project?.project_name || "-";
                })()}</span>
              </div>
              <div>
                Unit: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingReject.salesCaseId) ?? null;
                  return record?.unit_number || "-";
                })()}</span>
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setPendingReject(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={isUpdatingId === pendingReject.id}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isUpdatingId === pendingReject.id ? "Rejecting..." : "Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {pendingDeleteCompanyRow?.payoutType === "tier_upgrade_top_up"
                  ? "Delete top-up company row"
                  : pendingDeletePayout?.payout_type === "tier_upgrade_top_up"
                    ? "Delete top-up payout row"
                    : "Delete payout case"}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {pendingDeleteCompanyRow?.payoutType === "tier_upgrade_top_up"
                  ? "This will remove only this company top-up row from the payout page. The sales case and member top-up rows will remain unchanged."
                  : pendingDeletePayout?.payout_type === "tier_upgrade_top_up"
                    ? "This will remove only this top-up row from the payout page. The original sales case will remain unchanged."
                    : "This will permanently delete the unit case and all related payout rows."}
              </p>
            </div>
            <div className="px-5 py-4 space-y-4 text-sm text-gray-600">
              <div>
                Project: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingDelete.salesCaseId) ?? null;
                  const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
                  return project?.project_name || "-";
                })()}</span>
              </div>
              <div>
                Unit: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingDelete.salesCaseId) ?? null;
                  return record?.unit_number || "-";
                })()}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="font-semibold">CONFIRM</span> to {pendingDeleteCompanyRow?.payoutType === "tier_upgrade_top_up"
                    ? "delete this company top-up row"
                    : pendingDeletePayout?.payout_type === "tier_upgrade_top_up"
                      ? "delete this top-up row"
                      : "delete this case"}
                </label>
                <input
                  type="text"
                  value={deleteConfirmationText}
                  onChange={(event) => setDeleteConfirmationText(event.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteConfirmationText("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteCase()}
                disabled={isUpdatingId === pendingDelete.id || deleteConfirmationText !== "CONFIRM"}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isUpdatingId === pendingDelete.id
                  ? "Deleting..."
                  : pendingDeleteCompanyRow?.payoutType === "tier_upgrade_top_up"
                    ? "Delete Row"
                    : pendingDeletePayout?.payout_type === "tier_upgrade_top_up"
                      ? "Delete Row"
                      : "Delete Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingCompanyReceive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Receive company commission</h3>
              <p className="text-sm text-gray-500 mt-1">
                Record one developer payment batch. Partial payments will keep the remaining balance on this page.
              </p>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                <div>
                  <p className="text-gray-400">Project</p>
                  <p className="mt-1 font-medium text-gray-800">{pendingCompanyReceive.project?.project_name || "-"}</p>
                </div>
                <div>
                  <p className="text-gray-400">Unit</p>
                  <p className="mt-1 font-medium text-gray-800">{pendingCompanyReceive.record?.unit_number || "-"}</p>
                </div>
                <div>
                  <p className="text-gray-400">Total Amount to Receive</p>
                  <p className="mt-1 font-medium text-gray-800">RM {formatAmount(pendingCompanyReceive.totalAmount)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Remaining Amount</p>
                  <p className="mt-1 font-medium text-gray-800">RM {formatAmount(pendingCompanyReceive.amount)}</p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">Payment History</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      Previous company commission batches recorded for this case.
                    </p>
                  </div>
                  <div className="text-xs text-gray-500">
                    Total received: <span className="font-medium text-gray-800">RM {formatAmount(
                      pendingCompanyReceiveHistory.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
                    )}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  {pendingCompanyReceiveHistory.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-gray-500 bg-gray-50">
                      No payment history recorded yet for this case.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {pendingCompanyReceiveHistory.map((entry) => (
                        <div key={entry.id} className="px-4 py-3 bg-white">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-gray-800">
                                RM {formatAmount(entry.amount)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Received Date: {entry.transacted_at ? new Date(entry.transacted_at).toLocaleDateString() : "-"}
                              </div>
                              <div className="text-xs text-gray-500">
                                Reference: {entry.reference_detail || "-"}
                              </div>
                              <div className="text-xs text-gray-500">
                                Recorded: {entry.created_at ? new Date(entry.created_at).toLocaleString() : "-"}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              {entry.attachment_url ? (
                                <a
                                  href={entry.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  View Receipt
                                </a>
                              ) : (
                                <span className="text-gray-400">No Receipt</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Received Date</label>
                <input
                  type="date"
                  value={companyReceiveDate}
                  onChange={(event) => setCompanyReceiveDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Received Payment Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={pendingCompanyReceive.amount}
                  value={companyReceiveAmount}
                  onChange={(event) => {
                    const nextValue = event.target.value;

                    if (!nextValue) {
                      setCompanyReceiveAmount("");
                      return;
                    }

                    const parsedValue = Number(nextValue);
                    if (!Number.isFinite(parsedValue)) {
                      setCompanyReceiveAmount(nextValue);
                      return;
                    }

                    setCompanyReceiveAmount(
                      Math.min(parsedValue, pendingCompanyReceive.amount).toString()
                    );
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="0.00"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Maximum allowed: RM {formatAmount(pendingCompanyReceive.amount)}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Reference</label>
                <input
                  type="text"
                  value={companyReceiveReference}
                  onChange={(event) => setCompanyReceiveReference(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Developer payment reference"
                />
              </div>

              <div>
                <input
                  ref={companyReceiptInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) => setCompanyReceiptFile(event.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <label className="mb-1 block text-sm font-medium text-gray-700">Receipt Attachment</label>
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <button
                    type="button"
                    onClick={() => companyReceiptInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    Upload Receipt
                  </button>
                  <div className="text-sm text-gray-500">{companyReceiptFile?.name || "No file selected"}</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingCompanyReceive(null);
                  setCompanyReceiptFile(null);
                  setCompanyReceiveAmount("");
                  setCompanyReceiveDate(getLocalDateInputValue(new Date()));
                  setCompanyReceiveReference("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCompanyReceive()}
                disabled={isUpdatingId === pendingCompanyReceive.id}
                className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
              >
                {isUpdatingId === pendingCompanyReceive.id ? "Saving..." : "Receive Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedCase && (
        <SalesCaseModal
          userId={userId}
          projects={projects}
          initialCase={selectedCase}
          readOnly={true}
          enableWorkflowFields={caseWorkflowEnabled}
          allowStatusEdit={false}
          allowLoDraftUpload={false}
          statusOptions={MANAGE_CASE_STATUS_OPTIONS}
          onClose={() => setSelectedCase(null)}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
}