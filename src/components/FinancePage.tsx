import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { getShortCommissionStructureLabel } from "../lib/commissionStructures";
import {
  getCaseCommissionAmountForProfiles,
  getCompletedCommissionAmountForProfiles,
} from "../lib/salesCaseMetrics";
import {
  hasCaseWorkflowColumns,
  MANAGE_CASE_STATUS_OPTIONS,
  normalizeCaseStatus,
  SalesCaseModal,
  type ProjectOption,
  type SalesCasePayoutRecord,
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

type FinanceEntryType = "cash_in" | "cash_out";

type FinanceEntryRecord = {
  id: string;
  entry_type: FinanceEntryType;
  amount: number;
  description: string | null;
  reference_label: string | null;
  reference_detail: string | null;
  attachment_url: string | null;
  transacted_at: string;
  created_by: string | null;
  created_at: string;
  sales_case_id?: string | null;
  entry_scope?: string | null;
  payout_type?: string | null;
  source_commission_structure_id?: string | null;
  target_commission_structure_id?: string | null;
};

type FinanceTableRow =
  | {
      id: string;
      rowType: "payout";
  rowCategory: "sales_case" | "top_up";
      date: string | null;
      amount: number;
      directionLabel: "Cash Out";
      agentLabel: string;
      detailsPrimary: string;
      detailsSecondary: string;
      referenceLabel: string;
      referenceSubLabel: string | null;
      referenceDetail: string | null;
      attachmentUrl: string | null;
      createdByLabel: string;
      projectId: string | null;
      statusLabel: string;
      searchText: string;
      canManage: false;
    }
  | {
      id: string;
      rowType: "entry";
      rowCategory: "other";
      date: string;
      amount: number;
      directionLabel: "Cash In" | "Cash Out";
      agentLabel: string;
      detailsPrimary: string;
      detailsSecondary: string;
      referenceLabel: string;
      referenceSubLabel: string | null;
      referenceDetail: string | null;
      attachmentUrl: string | null;
      createdByLabel: string;
      projectId: string | null;
      statusLabel: string;
      searchText: string;
      canManage: true;
    };

type FinancePageProps = {
  userId: string;
  role: string | null;
};

type ReferenceTooltipState = {
  text: string;
  top: number;
  left: number;
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

const getStoragePathFromPublicUrl = (publicUrl: string | null) => {
  if (!publicUrl) {
    return null;
  }

  const markers = [
    "/storage/v1/object/public/cases/",
    "/storage/v1/object/sign/cases/",
    "/storage/v1/object/cases/",
  ];

  for (const marker of markers) {
    const pathIndex = publicUrl.indexOf(marker);

    if (pathIndex !== -1) {
      return decodeURIComponent(publicUrl.slice(pathIndex + marker.length).split("?")[0]);
    }
  }

  if (!publicUrl.startsWith("http://") && !publicUrl.startsWith("https://")) {
    return decodeURIComponent(publicUrl.split("?")[0]);
  }

  return null;
};

const getTopUpReferenceSubLabel = (
  payoutType: string | null | undefined,
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

const getAttachmentLabelFromPublicUrl = (publicUrl: string | null) => {
  const storagePath = getStoragePathFromPublicUrl(publicUrl);

  if (!storagePath) {
    return null;
  }

  const pathParts = storagePath.split("/");
  return pathParts[pathParts.length - 1] || storagePath;
};

const getLocalDateInputValue = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};
const getLocalDateValueFromTimestamp = (value: string | null) => {
  if (!value) {
    return "";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value.slice(0, 10);
  }

  return getLocalDateInputValue(parsedDate);
};

const formatLocalDate = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString();
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

export function FinancePage({ userId, role }: FinancePageProps) {
  const today = new Date();
  const defaultFromDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
  const defaultToDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [entries, setEntries] = useState<FinanceEntryRecord[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntryRecord | null>(null);
  const [entryType, setEntryType] = useState<FinanceEntryType>("cash_in");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [entryReference, setEntryReference] = useState("");
  const [entryReferenceDetail, setEntryReferenceDetail] = useState("");
  const [entryDate, setEntryDate] = useState(() => getLocalDateInputValue(new Date()));
  const [entryAttachmentFile, setEntryAttachmentFile] = useState<File | null>(null);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [selectedAgentLabel, setSelectedAgentLabel] = useState("all");
  const [selectedFlowType, setSelectedFlowType] = useState("all");
  const [selectedRowCategory, setSelectedRowCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [referenceTooltip, setReferenceTooltip] = useState<ReferenceTooltipState | null>(null);
  const [selectedPayoutCase, setSelectedPayoutCase] = useState<SalesCaseRecord | null>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<FinanceEntryRecord | null>(null);
  const [deleteEntryConfirmationText, setDeleteEntryConfirmationText] = useState("");
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [pendingPayoutRevert, setPendingPayoutRevert] = useState<SalesCasePayoutRecord | null>(null);
  const [revertConfirmationText, setRevertConfirmationText] = useState("");
  const [isRevertingPayout, setIsRevertingPayout] = useState(false);
  const [pendingReceiptChange, setPendingReceiptChange] = useState<SalesCasePayoutRecord | null>(null);
  const [replacementReceiptFile, setReplacementReceiptFile] = useState<File | null>(null);
  const [isChangingReceipt, setIsChangingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replacementReceiptInputRef = useRef<HTMLInputElement | null>(null);

  const canManageEntries = role === "admin" || role === "super_admin";
  const caseWorkflowEnabled = useMemo(
    () => cases.some((record) => hasCaseWorkflowColumns(record)),
    [cases]
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

  const memberProfileIds = useMemo(
    () =>
      new Set(
        profiles
          .filter((profile) => profile.role !== "admin" && profile.role !== "super_admin")
          .map((profile) => profile.id)
      ),
    [profiles]
  );

  const payoutMap = useMemo(() => {
    const map = new Map<string, SalesCasePayoutRecord[]>();

    payouts.forEach((payout) => {
      const relatedPayouts = map.get(payout.sales_case_id) ?? [];
      relatedPayouts.push(payout);
      map.set(payout.sales_case_id, relatedPayouts);
    });

    return map;
  }, [payouts]);

  const fetchData = async () => {
    setError(null);

    const [{ data: payoutData, error: payoutError }, { data: entryData, error: entryError }] =
      await Promise.all([
        supabase
          .from("sales_case_payouts")
          .select("*")
          .in("payout_status", ["Pending", "Approve", "Paid"])
          .order("paid_at", { ascending: false })
          .order("approved_at", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("finance_entries")
          .select("*")
          .order("transacted_at", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

    if (payoutError) {
      setError(payoutError.message);
      return;
    }

    if (entryError) {
      setError(entryError.message);
      return;
    }

    const nextPayouts = (payoutData as SalesCasePayoutRecord[]) ?? [];
    const nextEntries = ((entryData as FinanceEntryRecord[]) ?? []).filter(
      (entry) => entry.entry_scope !== "company_commission_hidden"
    );

    setPayouts(nextPayouts);
    setEntries(nextEntries);

    const casePromise = supabase.from("sales_cases").select("*").order("created_at", { ascending: false });
    const profilePromise = supabase
      .from("profiles")
      .select("id, name, email, role, rank, recruit_by")
      .is("deleted_at", null);

    const [{ data: caseData, error: caseError }, { data: profileData, error: profileError }] =
      await Promise.all([casePromise, profilePromise]);

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

  const resetEntryForm = () => {
    setEditingEntry(null);
    setEntryType("cash_in");
    setEntryAmount("");
    setEntryDescription("");
    setEntryReference("");
    setEntryReferenceDetail("");
    setEntryDate(getLocalDateInputValue(new Date()));
    setEntryAttachmentFile(null);
  };

  const openNewEntryModal = () => {
    setError(null);
    setSuccess(null);
    resetEntryForm();
    setShowEntryForm(true);
  };

  const openEditEntryModal = (entry: FinanceEntryRecord) => {
    setError(null);
    setSuccess(null);
    setEditingEntry(entry);
    setEntryType(entry.entry_type);
    setEntryAmount(entry.amount.toString());
    setEntryDescription(entry.description ?? "");
    setEntryReference(entry.reference_label ?? "");
    setEntryReferenceDetail(entry.reference_detail ?? "");
    setEntryDate(getLocalDateValueFromTimestamp(entry.transacted_at));
    setEntryAttachmentFile(null);
    setShowEntryForm(true);
  };

  const closeEntryModal = () => {
    setShowEntryForm(false);
    resetEntryForm();
  };

  const uploadAttachment = async () => {
    if (!entryAttachmentFile) {
      return editingEntry?.attachment_url ?? null;
    }

    const filePath = `finance-attachments/${userId}/${Date.now()}-${entryAttachmentFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, entryAttachmentFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const deleteAttachmentByUrl = async (publicUrl: string | null) => {
    const storagePath = getStoragePathFromPublicUrl(publicUrl);

    if (!storagePath) {
      return;
    }

    const { error: deleteError } = await supabase.storage.from("cases").remove([storagePath]);

    if (deleteError) {
      throw deleteError;
    }
  };

  const financeRows = useMemo<FinanceTableRow[]>(() => {
    const payoutRows: FinanceTableRow[] = payouts
      .filter((payout) => payout.payout_status === "Paid")
      .map((payout) => {
      const record = caseMap.get(payout.sales_case_id) ?? null;
      const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
      const member = profileMap.get(payout.profile_id) ?? null;
      const payer = payout.paid_by ? profileMap.get(payout.paid_by) ?? null : null;
      const statusLabel = record ? (normalizeCaseStatus(record.status) === "Paid" ? "Completed" : normalizeCaseStatus(record.status)) : "Completed";
      const detailsPrimary = project?.project_name || "Payout";
      const detailsSecondary = record?.unit_number ? `Unit ${record.unit_number}` : "Commission payout";
      const agentLabel = member?.name || member?.email || "-";

      return {
        id: payout.id,
        rowType: "payout",
        rowCategory: payout.payout_type === "tier_upgrade_top_up" ? "top_up" : "sales_case",
        date: payout.paid_at,
        amount: payout.total_amount,
        directionLabel: "Cash Out",
        agentLabel,
        detailsPrimary,
        detailsSecondary,
        referenceLabel: "Agent Comm",
        referenceSubLabel: getTopUpReferenceSubLabel(
          payout.payout_type,
          payout.source_commission_structure_label,
          payout.target_commission_structure_label,
        ),
        referenceDetail: null,
        attachmentUrl: payout.payment_receipt_url,
        createdByLabel: payer?.name || payer?.email || "-",
        projectId: record?.project_id ?? null,
        statusLabel,
        searchText: [agentLabel, detailsPrimary, detailsSecondary, record?.customer_name || "", "Agent Comm"]
          .join(" ")
          .toLowerCase(),
        canManage: false,
      };
      });

    const entryRows: FinanceTableRow[] = entries.map((entry) => {
      const createdBy = entry.created_by ? profileMap.get(entry.created_by) ?? null : null;
      const linkedCase = entry.sales_case_id ? caseMap.get(entry.sales_case_id) ?? null : null;
      const project = linkedCase?.project_id ? projectMap.get(linkedCase.project_id) ?? null : null;
      const detailsPrimary = entry.description || "Manual finance entry";
      const detailsSecondary = project?.project_name || "";
      const referenceLabel = entry.reference_label || "Manual entry";
      const agentLabel = "-";

      return {
        id: entry.id,
        rowType: "entry",
        rowCategory: "other",
        date: entry.transacted_at,
        amount: entry.amount,
        directionLabel: entry.entry_type === "cash_in" ? "Cash In" : "Cash Out",
        agentLabel,
        detailsPrimary,
        detailsSecondary,
        referenceLabel,
        referenceSubLabel: null,
        referenceDetail: entry.reference_detail || null,
        attachmentUrl: entry.attachment_url,
        createdByLabel: createdBy?.name || createdBy?.email || "-",
        projectId: linkedCase?.project_id ?? null,
        statusLabel: linkedCase ? normalizeCaseStatus(linkedCase.status) : entry.entry_type === "cash_in" ? "Cash In" : "Cash Out",
        searchText: [agentLabel, detailsPrimary, detailsSecondary, linkedCase?.customer_name || "", referenceLabel]
          .join(" ")
          .toLowerCase(),
        canManage: true,
      };
    });

    return [...payoutRows, ...entryRows].sort((left, right) => {
      const leftTime = left.date ? new Date(left.date).getTime() : 0;
      const rightTime = right.date ? new Date(right.date).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [caseMap, entries, payouts, profileMap, projectMap]);

  const filteredFinanceRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return financeRows.filter((row) => {
      if (!row.date) {
        return false;
      }

      const rowDate = getLocalDateValueFromTimestamp(row.date);
      if (fromDate && rowDate < fromDate) {
        return false;
      }

      if (toDate && rowDate > toDate) {
        return false;
      }

      if (selectedProjectId !== "all" && row.projectId !== selectedProjectId) {
        return false;
      }

      if (selectedAgentLabel !== "all" && row.agentLabel !== selectedAgentLabel) {
        return false;
      }

      if (selectedFlowType !== "all" && row.directionLabel !== selectedFlowType) {
        return false;
      }

      if (selectedRowCategory !== "all" && row.rowCategory !== selectedRowCategory) {
        return false;
      }

      if (normalizedSearch && !row.searchText.includes(normalizedSearch)) {
        return false;
      }

      return true;
    });
  }, [financeRows, fromDate, searchTerm, selectedAgentLabel, selectedFlowType, selectedProjectId, selectedRowCategory, toDate]);

  const availableAgentOptions = useMemo(
    () => Array.from(new Set(financeRows.map((row) => row.agentLabel).filter((label) => label && label !== "-"))).sort(),
    [financeRows]
  );

  const filteredCaseRows = useMemo(() => {
    return cases.filter((record) => {
      const createdAt = getLocalDateValueFromTimestamp(record.created_at);

      if (fromDate && createdAt < fromDate) {
        return false;
      }

      if (toDate && createdAt > toDate) {
        return false;
      }

      if (selectedProjectId !== "all" && record.project_id !== selectedProjectId) {
        return false;
      }

      return true;
    });
  }, [cases, fromDate, selectedProjectId, toDate]);

  const totalMonthlyGdv = useMemo(
    () => filteredCaseRows.reduce((sum, record) => sum + (record.spa_price ?? 0), 0),
    [filteredCaseRows]
  );

  const totalMonthlySalesNett = useMemo(
    () => filteredCaseRows.reduce((sum, record) => sum + (record.nett_price ?? 0), 0),
    [filteredCaseRows]
  );

  const totalMonthlySalesCommission = useMemo(
    () =>
      filteredCaseRows.reduce((sum, record) => {
        const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;

        return sum + getCaseCommissionAmountForProfiles(record, project, profiles, memberProfileIds);
      }, 0),
    [filteredCaseRows, memberProfileIds, profiles, projectMap]
  );

  const totalMonthlyConvertedCommission = useMemo(
    () =>
      filteredCaseRows.reduce(
        (sum, record) => sum + getCompletedCommissionAmountForProfiles(payoutMap.get(record.id) ?? [], memberProfileIds),
        0
      ),
    [filteredCaseRows, memberProfileIds, payoutMap]
  );

  const totalMonthlyCaseCount = useMemo(() => filteredCaseRows.length, [filteredCaseRows]);

  const totalPaidOutToAgent = useMemo(
    () =>
      filteredFinanceRows.reduce(
        (sum, row) => sum + (row.rowType === "payout" ? row.amount ?? 0 : 0),
        0
      ),
    [filteredFinanceRows]
  );

  const totalPaidOutNonAgent = useMemo(
    () =>
      filteredFinanceRows.reduce(
        (sum, row) =>
          sum + (row.rowType === "entry" && row.directionLabel === "Cash Out" ? row.amount ?? 0 : 0),
        0
      ),
    [filteredFinanceRows]
  );

  const totalCashIn = useMemo(
    () =>
      filteredFinanceRows.reduce(
        (sum, row) => sum + (row.directionLabel === "Cash In" ? row.amount ?? 0 : 0),
        0
      ),
    [filteredFinanceRows]
  );

  const totalCashOut = useMemo(
    () =>
      filteredFinanceRows.reduce(
        (sum, row) => sum + (row.directionLabel === "Cash Out" ? row.amount ?? 0 : 0),
        0
      ),
    [filteredFinanceRows]
  );

  const handleAddEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedAmount = Number(entryAmount);
    if (!entryDate) {
      setError("Please select a transaction date.");
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount greater than zero.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    let uploadedAttachmentUrl: string | null = null;

    try {
      const previousAttachmentUrl = editingEntry?.attachment_url ?? null;
      const attachmentUrl = await uploadAttachment();
      uploadedAttachmentUrl = entryAttachmentFile ? attachmentUrl : null;
      const payload = {
        entry_type: entryType,
        amount: parsedAmount,
        description: entryDescription.trim() || null,
        reference_label: entryReference.trim() || null,
        reference_detail: entryReferenceDetail.trim() || null,
        attachment_url: attachmentUrl,
        transacted_at: new Date(`${entryDate}T00:00:00`).toISOString(),
        created_by: editingEntry?.created_by ?? userId,
      };

      if (editingEntry) {
        const { error: updateError } = await supabase
          .from("finance_entries")
          .update(payload)
          .eq("id", editingEntry.id);

        if (updateError) {
          setError(updateError.message);
          setIsSubmitting(false);
          return;
        }

        if (entryAttachmentFile && previousAttachmentUrl && previousAttachmentUrl !== attachmentUrl) {
          await deleteAttachmentByUrl(previousAttachmentUrl);
        }

        setSuccess("Finance entry updated.");
      } else {
        const { error: insertError } = await supabase.from("finance_entries").insert(payload);

        if (insertError) {
          if (entryAttachmentFile && attachmentUrl) {
            await deleteAttachmentByUrl(attachmentUrl);
          }
          setError(insertError.message);
          setIsSubmitting(false);
          return;
        }

        setSuccess("Finance entry added.");
      }

      closeEntryModal();
      setIsSubmitting(false);
      await fetchData();
    } catch (err) {
      if (uploadedAttachmentUrl && uploadedAttachmentUrl !== editingEntry?.attachment_url) {
        await deleteAttachmentByUrl(uploadedAttachmentUrl).catch(() => undefined);
      }
      setError(err instanceof Error ? err.message : "Unable to upload the attachment.");
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!pendingDeleteEntry) {
      return;
    }

    if (deleteEntryConfirmationText !== "CONFIRM") {
      setError('Please type "CONFIRM" before deleting this finance entry.');
      return;
    }

    const isPayoutLinkedEntry = pendingDeleteEntry.entry_scope === "company_commission" && Boolean(pendingDeleteEntry.sales_case_id);
    const hasAttachment = Boolean(pendingDeleteEntry.attachment_url);

    setError(null);
    setSuccess(null);
    setIsDeletingEntry(true);

    const { error: deleteError } = await supabase.from("finance_entries").delete().eq("id", pendingDeleteEntry.id);

    if (deleteError) {
      setError(deleteError.message);
      setIsDeletingEntry(false);
      return;
    }

    try {
      await deleteAttachmentByUrl(pendingDeleteEntry.attachment_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finance entry deleted, but attachment cleanup failed.");
      await fetchData();
      setPendingDeleteEntry(null);
      setDeleteEntryConfirmationText("");
      setIsDeletingEntry(false);
      return;
    }

    setPendingDeleteEntry(null);
    setDeleteEntryConfirmationText("");
    setIsDeletingEntry(false);

    setSuccess(
      isPayoutLinkedEntry
        ? hasAttachment
          ? "Finance entry deleted. The amount is now returned to the Payout page and the receipt attachment was removed."
          : "Finance entry deleted. The amount is now returned to the Payout page."
        : hasAttachment
          ? "Finance entry deleted and the receipt attachment was removed."
          : "Finance entry deleted."
    );
    await fetchData();
  };

  const showReferenceTooltip = (event: React.MouseEvent<HTMLSpanElement>, text: string | null) => {
    if (!text) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 288;
    const margin = 16;
    const centeredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    const maxLeft = window.innerWidth - tooltipWidth - margin;
    const left = Math.min(Math.max(centeredLeft, margin), Math.max(maxLeft, margin));

    setReferenceTooltip({
      text,
      top: rect.top - 12,
      left,
    });
  };

  const hideReferenceTooltip = () => {
    setReferenceTooltip(null);
  };

  const handleRevertPaidPayout = async () => {
    if (!pendingPayoutRevert) {
      return;
    }

    if (revertConfirmationText !== "CONFIRM") {
      setError('Please type "CONFIRM" before reverting this payout.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRevertingPayout(true);

    const receiptUrl = pendingPayoutRevert.payment_receipt_url;
    const receiptPath = getStoragePathFromPublicUrl(receiptUrl);

    const { error: updateError } = await supabase
      .from("sales_case_payouts")
      .update({
        payout_status: "Pending",
        paid_at: null,
        paid_by: null,
        payment_receipt_url: null,
      })
      .eq("id", pendingPayoutRevert.id);

    if (updateError) {
      setError(updateError.message);
      setIsRevertingPayout(false);
      return;
    }

    if (receiptPath) {
      const { error: storageDeleteError } = await supabase.storage.from("cases").remove([receiptPath]);

      if (storageDeleteError) {
        setError(`Payout reverted, but receipt cleanup failed: ${storageDeleteError.message}`);
        await fetchData();
        setPendingPayoutRevert(null);
        setRevertConfirmationText("");
        setIsRevertingPayout(false);
        return;
      }
    }

    await fetchData();
    setPendingPayoutRevert(null);
    setRevertConfirmationText("");
    setIsRevertingPayout(false);
    setSuccess("Payout reverted to the Payout page and the receipt was removed.");
  };

  const uploadReplacementReceipt = async () => {
    if (!replacementReceiptFile) {
      throw new Error("Please attach a new receipt before saving.");
    }

    const filePath = `payout-receipts/${userId}/${Date.now()}-${sanitizeFileName(replacementReceiptFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, replacementReceiptFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleChangePayoutReceipt = async () => {
    if (!pendingReceiptChange) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsChangingReceipt(true);

    const previousReceiptUrl = pendingReceiptChange.payment_receipt_url;
    let nextReceiptUrl: string | null = null;

    try {
      nextReceiptUrl = await uploadReplacementReceipt();

      const { error: updateError } = await supabase
        .from("sales_case_payouts")
        .update({ payment_receipt_url: nextReceiptUrl })
        .eq("id", pendingReceiptChange.id);

      if (updateError) {
        if (nextReceiptUrl) {
          await deleteAttachmentByUrl(nextReceiptUrl).catch(() => undefined);
        }
        setError(updateError.message);
        setIsChangingReceipt(false);
        return;
      }

      if (previousReceiptUrl && previousReceiptUrl !== nextReceiptUrl) {
        await deleteAttachmentByUrl(previousReceiptUrl).catch(() => undefined);
      }

      await fetchData();
      setPendingReceiptChange(null);
      setReplacementReceiptFile(null);
      setIsChangingReceipt(false);
      setSuccess("Payout receipt updated successfully.");
    } catch (err) {
      if (nextReceiptUrl) {
        await deleteAttachmentByUrl(nextReceiptUrl).catch(() => undefined);
      }
      setError(err instanceof Error ? err.message : "Unable to update the payout receipt.");
      setIsChangingReceipt(false);
    }
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Finance</h2>
          <p className="text-gray-500 text-sm mt-1">
            Track completed payouts together with broader finance activity such as developer commissions, salaries, and other admin-managed cash flow.
          </p>
        </div>
        {canManageEntries && (
          <button
            type="button"
            onClick={openNewEntryModal}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            Add Cash In / Out
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2 xl:grid-cols-5">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyGdv)}</p>
          <p className="text-xs text-gray-500 mt-2">Total SPA price from all cases within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Nett Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesNett)}</p>
          <p className="text-xs text-gray-500 mt-2">Total nett price from all cases within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesCommission)}</p>
          <p className="text-xs text-gray-500 mt-2">Total commission from sales cases within the selected date range, whether completed or not.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyConvertedCommission)}</p>
          <p className="text-xs text-gray-500 mt-2">Total completed commission from sales cases within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Number of Cases</p>
          <p className="text-2xl font-bold text-gray-900">{totalMonthlyCaseCount}</p>
          <p className="text-xs text-gray-500 mt-2">Total cases within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out To Agent</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPaidOutToAgent)}</p>
          <p className="text-xs text-gray-500 mt-2">Paid commission to agents within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out Non-Agent</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPaidOutNonAgent)}</p>
          <p className="text-xs text-gray-500 mt-2">Outgoing finance entries within the selected date range that are not related to agent payout cases.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Cash In</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalCashIn)}</p>
          <p className="text-xs text-gray-500 mt-2">All incoming finance entries within the selected date range.</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2">Total Cash Out</p>
          <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalCashOut)}</p>
          <p className="text-xs text-gray-500 mt-2">All outgoing payments within the selected date range.</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Filter by Date</h3>
            <p className="mt-1 text-xs text-gray-500">
              The summary cards and table below follow the selected date range. The default range is the current month.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setFromDate(defaultFromDate);
                  setToDate(defaultToDate);
                }}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Reset to This Month
              </button>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Project</label>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_name || "Unnamed project"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Agent</label>
            <select
              value={selectedAgentLabel}
              onChange={(event) => setSelectedAgentLabel(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="all">All agents</option>
              {availableAgentOptions.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Status</label>
            <select
              value={selectedFlowType}
              onChange={(event) => setSelectedFlowType(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="all">All status</option>
              <option value="Cash In">Cash In</option>
              <option value="Cash Out">Cash Out</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Filter by Row</label>
            <select
              value={selectedRowCategory}
              onChange={(event) => setSelectedRowCategory(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="all">All rows</option>
              <option value="sales_case">Sales cases row</option>
              <option value="top_up">Top up cases row</option>
              <option value="other">Others</option>
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-700">Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search agent name, category/details, or case name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
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

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Date</th>
                <th className="py-2">Type</th>
                <th className="py-2">Agent</th>
                <th className="py-2">Case Name</th>
                <th className="py-2">Category / Details</th>
                <th className="py-2">Amount (RM)</th>
                <th className="py-2">Added / Paid By</th>
                <th className="py-2">Attachment</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredFinanceRows.map((row) => {
                const entry = row.rowType === "entry" ? entries.find((item) => item.id === row.id) ?? null : null;
                const payout = row.rowType === "payout" ? payouts.find((item) => item.id === row.id) ?? null : null;

                return (
                  <tr
                    key={`${row.rowType}-${row.id}`}
                    className="border-b border-gray-50"
                  >
                    <td className="py-3 text-gray-600">
                      {formatLocalDate(row.date)}
                    </td>
                    <td className="py-3 text-gray-600">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          row.directionLabel === "Cash In"
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {row.directionLabel}
                      </span>
                    </td>
                    <td className="py-3 text-gray-600">{row.agentLabel}</td>
                    <td className="py-3 text-gray-600">
                      <div className="inline-block">
                        <span
                          onMouseEnter={(event) => showReferenceTooltip(event, row.referenceDetail)}
                          onMouseLeave={hideReferenceTooltip}
                          className={row.referenceDetail ? "cursor-default border-b border-dotted border-gray-400" : ""}
                        >
                          {row.referenceLabel}
                        </span>
                        {row.referenceSubLabel && (
                          <div className="mt-1 text-xs text-amber-700">{row.referenceSubLabel}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-gray-600">
                      <div className="font-medium text-gray-800">{row.detailsPrimary}</div>
                      {row.detailsSecondary && (
                        <div className="text-xs text-gray-500">{row.detailsSecondary}</div>
                      )}
                    </td>
                    <td className="py-3 text-gray-600">{formatAmount(row.amount)}</td>
                    <td className="py-3 text-gray-600">{row.createdByLabel}</td>
                    <td className="py-3 text-gray-600">
                      {row.attachmentUrl ? (
                        <a
                          href={row.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          View Attachment
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3">
                      {row.rowType === "payout" && payout ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPayoutCase(caseMap.get(payout.sales_case_id) ?? null)}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:text-blue-800"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingReceiptChange(payout);
                              setReplacementReceiptFile(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-2 py-1 text-xs text-amber-700 hover:text-amber-800"
                          >
                            Change Receipt
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingPayoutRevert(payout);
                              setRevertConfirmationText("");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:text-red-700"
                          >
                            Revert
                          </button>
                        </div>
                      ) : row.canManage && entry ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditEntryModal(entry)}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:text-blue-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteEntry(entry);
                              setDeleteEntryConfirmationText("");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-gray-400">-</div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredFinanceRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-gray-500">
                    No finance records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManageEntries && showEntryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingEntry ? "Edit Finance Entry" : "Add Finance Entry"}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Record finance activity such as developer commission received, admin salary paid, petty cash, reimbursements, or any other manual cash movement.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEntryModal}
                className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                Close
              </button>
            </div>

            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleAddEntry}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
                <select
                  value={entryType}
                  onChange={(event) => setEntryType(event.target.value as FinanceEntryType)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="cash_in">Cash In</option>
                  <option value="cash_out">Cash Out</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Amount (RM)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={entryAmount}
                  onChange={(event) => setEntryAmount(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="0.00"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Transaction Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Case Name</label>
                <input
                  type="text"
                  value={entryReference}
                  onChange={(event) => setEntryReference(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Project or case name"
                />
              </div>

              <div className="md:col-span-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) => setEntryAttachmentFile(event.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <label className="mb-1 block text-sm font-medium text-gray-700">Attachment</label>
                <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Upload className="h-4 w-4" />
                      Upload Attachment
                    </button>
                    <span>
                      {entryAttachmentFile?.name || getAttachmentLabelFromPublicUrl(editingEntry?.attachment_url ?? null) || "No file selected"}
                    </span>
                  </div>
                  {editingEntry?.attachment_url && !entryAttachmentFile && (
                    <a
                      href={editingEntry.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit text-primary hover:underline"
                    >
                      View Current Attachment
                    </a>
                  )}
                  <p className="text-xs text-gray-500">Allowed file types: PDF, JPG, PNG, and other images.</p>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={entryDescription}
                  onChange={(event) => setEntryDescription(event.target.value)}
                  className="min-h-28 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Describe what this money movement is for"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Reference</label>
                <input
                  type="text"
                  value={entryReferenceDetail}
                  onChange={(event) => setEntryReferenceDetail(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Invoice number, bank ref, transfer ID, or other internal reference"
                />
              </div>

              <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEntryModal}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Saving..." : editingEntry ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedPayoutCase && (
        <SalesCaseModal
          userId={userId}
          projects={projects}
          initialCase={selectedPayoutCase}
          readOnly={true}
          enableWorkflowFields={caseWorkflowEnabled}
          allowStatusEdit={false}
          allowLoDraftUpload={false}
          statusOptions={MANAGE_CASE_STATUS_OPTIONS}
          onClose={() => setSelectedPayoutCase(null)}
          onSaved={() => undefined}
        />
      )}

      {pendingDeleteEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Delete finance entry</h3>
              <p className="text-sm text-gray-500 mt-1">
                This action will remove the row from Finance.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4 text-sm text-gray-600">
              <div>
                Type: <span className="font-medium text-gray-800">{pendingDeleteEntry.entry_type === "cash_in" ? "Cash In" : "Cash Out"}</span>
              </div>
              <div>
                Case Name: <span className="font-medium text-gray-800">{pendingDeleteEntry.reference_label || "-"}</span>
              </div>
              <div>
                Category / Details: <span className="font-medium text-gray-800">{pendingDeleteEntry.description || "-"}</span>
              </div>
              <div>
                Amount: <span className="font-medium text-gray-800">RM {formatAmount(pendingDeleteEntry.amount)}</span>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                {pendingDeleteEntry.entry_scope === "company_commission" && pendingDeleteEntry.sales_case_id
                  ? "Deleting this company commission receipt entry will return the amount to the Payout page and delete the uploaded receipt."
                  : pendingDeleteEntry.attachment_url
                    ? "Deleting this finance entry will also delete the uploaded receipt."
                    : "Deleting this finance entry cannot be undone."}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="font-semibold">CONFIRM</span> to delete this finance entry
                </label>
                <input
                  type="text"
                  value={deleteEntryConfirmationText}
                  onChange={(event) => setDeleteEntryConfirmationText(event.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteEntry(null);
                  setDeleteEntryConfirmationText("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                disabled={isDeletingEntry}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteEntry()}
                disabled={isDeletingEntry || deleteEntryConfirmationText !== "CONFIRM"}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isDeletingEntry ? "Deleting..." : "Delete Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPayoutRevert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Revert paid payout</h3>
              <p className="text-sm text-gray-500 mt-1">
                This will remove the row from Finance and send it back to the Payout page.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4 text-sm text-gray-600">
              <div>
                Agent: <span className="font-medium text-gray-800">{profileMap.get(pendingPayoutRevert.profile_id)?.name || profileMap.get(pendingPayoutRevert.profile_id)?.email || "-"}</span>
              </div>
              <div>
                Project: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingPayoutRevert.sales_case_id) ?? null;
                  const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
                  return project?.project_name || "-";
                })()}</span>
              </div>
              <div>
                Unit: <span className="font-medium text-gray-800">{caseMap.get(pendingPayoutRevert.sales_case_id)?.unit_number || "-"}</span>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Reverting this payout will delete the uploaded receipt.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="font-semibold">CONFIRM</span> to revert this payout
                </label>
                <input
                  type="text"
                  value={revertConfirmationText}
                  onChange={(event) => setRevertConfirmationText(event.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingPayoutRevert(null);
                  setRevertConfirmationText("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                disabled={isRevertingPayout}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRevertPaidPayout()}
                disabled={isRevertingPayout || revertConfirmationText !== "CONFIRM"}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isRevertingPayout ? "Reverting..." : "Revert Payout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReceiptChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Change payout receipt</h3>
              <p className="text-sm text-gray-500 mt-1">
                Upload a new receipt for this paid payout row.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="text-sm text-gray-600">
                Agent: <span className="font-medium text-gray-800">{profileMap.get(pendingReceiptChange.profile_id)?.name || profileMap.get(pendingReceiptChange.profile_id)?.email || "-"}</span>
              </div>
              <div className="text-sm text-gray-600">
                Project: <span className="font-medium text-gray-800">{(() => {
                  const record = caseMap.get(pendingReceiptChange.sales_case_id) ?? null;
                  const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
                  return project?.project_name || "-";
                })()}</span>
              </div>
              <input
                ref={replacementReceiptInputRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setReplacementReceiptFile(event.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => replacementReceiptInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                Upload New Receipt
              </button>
              <div className="text-sm text-gray-500">{replacementReceiptFile?.name || "No file selected"}</div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setPendingReceiptChange(null);
                  setReplacementReceiptFile(null);
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                disabled={isChangingReceipt}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleChangePayoutReceipt()}
                disabled={isChangingReceipt}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {isChangingReceipt ? "Saving..." : "Save Receipt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {referenceTooltip && typeof document !== "undefined" && createPortal(
        <div
          className="pointer-events-none fixed z-[70] w-72 -translate-y-full rounded-2xl border border-white/50 bg-white/65 px-3 py-2 text-xs leading-5 text-black shadow-2xl backdrop-blur-xl"
          style={{ top: referenceTooltip.top, left: referenceTooltip.left }}
        >
          <div className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-white/50 bg-white/65 backdrop-blur-xl" />
          <p className="font-semibold text-black/80">Reference</p>
          <p className="mt-1 break-words text-black">{referenceTooltip.text}</p>
        </div>,
        document.body,
      )}
    </div>
  );
}