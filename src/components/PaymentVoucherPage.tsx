import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { jsPDF } from "jspdf";
import { notifyPaymentVoucherGenerated } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";
import { SalesCaseModal, type ProjectOption, type SalesCasePayoutRecord, type SalesCaseRecord } from "./SalesCaseModal";

type ProfileOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type VoucherBreakdownRow = {
  id: string;
  salesCaseId: string;
  projectName: string;
  unitLabel: string;
  signedLoDate: string | null;
  nettPrice: number | null;
  profileId: string;
  memberLabel: string;
  agentCommissionPercentage: number;
  preLeaderOverridePercentage: number;
  leaderOverridePercentage: number;
  commissionPercentage: number;
  amount: number;
  isHoldingComm: boolean;
  componentCategory: "claim" | "override";
};

type VoucherComponentBreakdown = {
  key: string;
  typeLabel: string;
  percentage: number;
  amount: number;
  componentCategory: "claim" | "override";
};

type VoucherGroup = {
  salesCaseId: string;
  projectName: string;
  unitLabel: string;
  signedLoDate: string | null;
  bookingFormUrl: string | null;
  totalAmount: number;
  rows: VoucherBreakdownRow[];
};

type VoucherHistoryEntry = {
  id: string;
  amount: number;
  attachment_url: string | null;
  reference_label: string | null;
  reference_detail: string | null;
  transacted_at: string;
  created_at: string;
};

type VoucherHistoryMeta = {
  payoutIds?: string[];
  componentKeys?: string[];
  grossAmount?: number;
  salesCaseIds?: string[];
  storagePath?: string;
  profileIds: string[];
  memberLabels: string[];
  commissionLabels: string[];
  bookingFormUrls: string[];
  icNo?: string;
  refNo?: string;
  chequersNo?: string;
};

type VoucherHistoryDisplayRow = {
  id: string;
  amount: number;
  attachmentUrl: string | null;
  generatedAt: string;
  memberLabel: string;
  detailsLabel: string;
  bookingFormUrls: string[];
  salesCaseIds: string[];
};

type SelectedVoucherComponentRow = {
  componentKey: string;
  row: VoucherBreakdownRow;
  component: VoucherComponentBreakdown;
};

const HISTORY_META_SEPARATOR = "|||META|||";

const formatAmount = (value: number) => {
  const roundedValue = Number(value.toFixed(2));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;

  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const formatPercentage = (value: number) => {
  if (value === 0) {
    return "-";
  }

  const roundedValue = Number(value.toFixed(3));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;

  return `${roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 1 : 0,
    maximumFractionDigits: 3,
  })}%`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString("en-MY");
};

const getLocalDateInputValue = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

const calculateVoucherAmounts = (
  grossCommission: number,
  options: {
    deductSst: boolean;
    deductWithholdingTax: boolean;
  }
) => {
  const grossAmount = Number(grossCommission.toFixed(2));
  const extractedSubTotal = Number((grossAmount / 1.08).toFixed(2));
  const sstAmount = options.deductSst ? Number((grossAmount - extractedSubTotal).toFixed(2)) : 0;
  const subTotalAmount = options.deductSst ? extractedSubTotal : grossAmount;
  const withholdingTaxAmount = options.deductWithholdingTax
    ? Number((subTotalAmount * 0.02).toFixed(2))
    : 0;
  const finalPayoutAmount = Number((subTotalAmount - withholdingTaxAmount).toFixed(2));

  return {
    grossAmount,
    subTotalAmount,
    sstAmount,
    withholdingTaxAmount,
    finalPayoutAmount,
  };
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

  try {
    const { pathname } = new URL(publicUrl);

    for (const marker of markers) {
      const pathIndex = pathname.indexOf(marker);

      if (pathIndex !== -1) {
        return decodeURIComponent(pathname.slice(pathIndex + marker.length).split("?")[0]);
      }
    }

    return null;
  } catch {
    if (!publicUrl.startsWith("http://") && !publicUrl.startsWith("https://")) {
      return decodeURIComponent(publicUrl.split("?")[0]);
    }

    return null;
  }
};

const parseVoucherHistoryDetail = (referenceDetail: string | null | undefined) => {
  const rawDetail = (referenceDetail ?? "").trim();

  if (!rawDetail) {
    return {
      detailsLabel: "-",
      memberLabel: "-",
      commissionLabel: "-",
      bookingFormUrls: [] as string[],
      salesCaseIds: [] as string[],
    };
  }

  const [baseDetail, metaPayload] = rawDetail.split(HISTORY_META_SEPARATOR);
  const detailsLabel = baseDetail?.trim() || "-";

  if (!metaPayload) {
    const detailSegments = detailsLabel
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const members = detailSegments
      .map((segment) => {
        const memberSplit = segment.split(" - ");
        return memberSplit.length > 1 ? memberSplit[memberSplit.length - 1].trim() : "";
      })
      .filter(Boolean);

    const legacyDetails = detailSegments.length
      ? detailSegments
          .map((segment) => {
            const separatorIndex = segment.lastIndexOf(" - ");
            return separatorIndex >= 0 ? segment.slice(0, separatorIndex) : segment;
          })
          .join("; ")
      : detailsLabel;

    return {
      detailsLabel: legacyDetails || "-",
      memberLabel: members.length ? Array.from(new Set(members)).join(", ") : "-",
      commissionLabel: "-",
      bookingFormUrls: [] as string[],
      salesCaseIds: [] as string[],
    };
  }

  try {
    const [metaJson] = metaPayload.split(" | ");
    const parsedMeta = JSON.parse(metaJson) as VoucherHistoryMeta;
    const memberLabel = Array.from(new Set((parsedMeta.memberLabels ?? []).filter(Boolean))).join(", ");
    const commissionLabel = Array.from(new Set((parsedMeta.commissionLabels ?? []).filter(Boolean))).join(", ");
    const bookingFormUrls = Array.from(new Set((parsedMeta.bookingFormUrls ?? []).filter(Boolean)));
    const salesCaseIds = Array.from(new Set((parsedMeta.salesCaseIds ?? []).filter(Boolean)));

    return {
      detailsLabel,
      memberLabel: memberLabel || "-",
      commissionLabel: commissionLabel || "-",
      bookingFormUrls,
      salesCaseIds,
    };
  } catch {
    return {
      detailsLabel,
      memberLabel: "-",
      commissionLabel: "-",
      bookingFormUrls: [] as string[],
      salesCaseIds: [] as string[],
    };
  }
};

const parseVoucherHistoryMeta = (referenceDetail: string | null | undefined) => {
  const rawDetail = (referenceDetail ?? "").trim();
  const [, metaPayload] = rawDetail.split(HISTORY_META_SEPARATOR);

  if (!metaPayload) {
    return null;
  }

  try {
    const [metaJson] = metaPayload.split(" | ");
    return JSON.parse(metaJson) as VoucherHistoryMeta;
  } catch {
    return null;
  }
};

const getPayoutIdFromComponentKey = (componentKey: string) => {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(componentKey)) {
    return componentKey;
  }

  const uuidPrefixMatch = componentKey.match(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-/);

  if (uuidPrefixMatch?.[1]) {
    return uuidPrefixMatch[1];
  }

  const suffixes = ["-pre-leader-override", "-leader-override", "-comm"];
  const matchedSuffix = suffixes.find((suffix) => componentKey.endsWith(suffix));

  if (!matchedSuffix) {
    return null;
  }

  return componentKey.slice(0, -matchedSuffix.length);
};

const deriveGrossAmountFromHistory = (finalAmount: number, referenceDetail: string | null | undefined) => {
  const historyMeta = parseVoucherHistoryMeta(referenceDetail);

  if (historyMeta?.grossAmount !== undefined && historyMeta.grossAmount !== null) {
    return Number(Number(historyMeta.grossAmount).toFixed(2));
  }

  const normalizedDetail = (referenceDetail ?? "").toLowerCase();
  const hasSst = normalizedDetail.includes("deduct sst 8%");
  const hasWht =
    normalizedDetail.includes("deduct wht 2%") ||
    normalizedDetail.includes("deduct withholding tax 2%");

  if (hasSst && hasWht) {
    return Number(((finalAmount * 1.08) / 0.98).toFixed(2));
  }

  if (hasSst) {
    return Number((finalAmount * 1.08).toFixed(2));
  }

  if (hasWht) {
    return Number((finalAmount / 0.98).toFixed(2));
  }

  return Number(finalAmount.toFixed(2));
};

const sanitizeVoucherFileName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/%/g, " pct")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 160)
    .replace(/^[.-]+|[.-]+$/g, "");

const buildVoucherFileName = (rows: VoucherBreakdownRow[]) => {
  const memberLabel = rows[0]?.memberLabel || "Member";

  const directRows = rows.filter((row) => row.agentCommissionPercentage > 0);
  const leadRow = (directRows.length > 0 ? directRows[0] : rows[0]) ?? null;

  const leadSegment = leadRow
    ? `${leadRow.projectName} ${leadRow.unitLabel} ${formatPercentage(
        leadRow.agentCommissionPercentage > 0 ? leadRow.agentCommissionPercentage : leadRow.commissionPercentage
      )}`
    : "";

  const overridingUnits = Array.from(
    new Set(
      rows
        .filter((row) => row.preLeaderOverridePercentage > 0 || row.leaderOverridePercentage > 0)
        .map((row) => row.unitLabel)
        .filter(Boolean)
    )
  );

  const overridingSegment = overridingUnits.length > 0 ? ` Overriding ${overridingUnits.join(", ")}` : "";
  const rawName = `Payment Voucher ${memberLabel} ${leadSegment}${overridingSegment}`.trim();

  return `${sanitizeVoucherFileName(rawName)}.pdf`;
};

const getVoucherClaimHeading = (row: VoucherBreakdownRow) => {
  if (row.componentCategory === "override") {
    return "Overriding:";
  }

  return row.isHoldingComm ? "3rd Claim for Stage 2A:" : "LO Signed Claim:";
};

const buildUniqueVoucherPath = (userId: string, rows: VoucherBreakdownRow[]) => {
  const baseFileName = buildVoucherFileName(rows);
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return `payment-vouchers/${userId}/${timestamp}-${randomSuffix}/${baseFileName}`;
};


const getVoucherComponentBreakdown = (row: VoucherBreakdownRow): VoucherComponentBreakdown[] => {
  const holdingLabelSuffix = row.isHoldingComm ? " (Holding Comm)" : "";
  const components = [
    { typeLabel: `Comm${holdingLabelSuffix}`, percentage: row.agentCommissionPercentage, componentCategory: "claim" as const },
    { typeLabel: `Pre Leader Override${holdingLabelSuffix}`, percentage: row.preLeaderOverridePercentage, componentCategory: "override" as const },
    { typeLabel: `Leader Override${holdingLabelSuffix}`, percentage: row.leaderOverridePercentage, componentCategory: "override" as const },
  ].filter((item) => item.percentage > 0);

  if (components.length === 0) {
    return [
      {
        key: `${row.id}-comm`,
        typeLabel: `Comm${holdingLabelSuffix}`,
        percentage: row.commissionPercentage,
        amount: row.amount,
        componentCategory: row.componentCategory,
      },
    ];
  }

  if (components.length === 1) {
    return [
      {
        key: `${row.id}-${components[0].typeLabel.toLowerCase().replace(/\s+/g, "-")}`,
        typeLabel: components[0].typeLabel,
        percentage: components[0].percentage,
        amount: row.amount,
        componentCategory: components[0].componentCategory,
      },
    ];
  }

  const totalPercentage = components.reduce((sum, item) => sum + item.percentage, 0);
  let allocatedAmount = 0;

  return components.map((item, index) => {
    const isLast = index === components.length - 1;
    const amount = isLast
      ? Number((row.amount - allocatedAmount).toFixed(2))
      : Number(((row.amount * item.percentage) / totalPercentage).toFixed(2));

    if (!isLast) {
      allocatedAmount += amount;
    }

    return {
      key: `${row.id}-${item.typeLabel.toLowerCase().replace(/\s+/g, "-")}`,
      typeLabel: item.typeLabel,
      percentage: item.percentage,
      amount,
      componentCategory: item.componentCategory,
    };
  });
};

export function PaymentVoucherPage({
  userId,
  canGenerateVoucher = true,
}: {
  userId: string;
  canGenerateVoucher?: boolean;
}) {
  const today = new Date();
  const defaultFromDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
  const defaultToDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [expandedCaseIds, setExpandedCaseIds] = useState<string[]>([]);
  const [selectedComponentKeys, setSelectedComponentKeys] = useState<string[]>([]);
  const [voucherHistory, setVoucherHistory] = useState<VoucherHistoryEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeletingHistoryId, setIsDeletingHistoryId] = useState<string | null>(null);
  const [showGenerateOptions, setShowGenerateOptions] = useState(false);
  const [isRevertingCaseId, setIsRevertingCaseId] = useState<string | null>(null);
  const [deductSst, setDeductSst] = useState(false);
  const [deductWithholdingTax, setDeductWithholdingTax] = useState(false);
  const [voucherIcNo, setVoucherIcNo] = useState("");
  const [voucherRefNo, setVoucherRefNo] = useState("");
  const [voucherChequersNo, setVoucherChequersNo] = useState("");
  const [pendingDeleteHistory, setPendingDeleteHistory] = useState<VoucherHistoryEntry | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState(defaultFromDate);
  const [historyDateTo, setHistoryDateTo] = useState(defaultToDate);
  const [historyNameSearch, setHistoryNameSearch] = useState("");
  const [historyDetailsSearch, setHistoryDetailsSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<SalesCaseRecord | null>(null);

  const isReleasedHoldingPayout = (payout: SalesCasePayoutRecord) => {
    if (payout.payout_type !== "tier_upgrade_top_up") {
      return false;
    }

    const source = (payout.source_commission_structure_id ?? "").toLowerCase();
    const target = (payout.target_commission_structure_id ?? "").toLowerCase();
    const sourceLabel = (payout.source_commission_structure_label ?? "").toLowerCase();
    const targetLabel = (payout.target_commission_structure_label ?? "").toLowerCase();

    const sourceMatches = source === "holding_commission" || sourceLabel === "holding commission";
    const targetMatches = target === "released" || targetLabel === "released";

    return sourceMatches && targetMatches;
  };

  const fetchApprovedPayoutRows = async () => {
    const { data, error: payoutError } = await supabase
      .from("sales_case_payouts")
      .select("*")
      .in("payout_type", ["standard", "tier_upgrade_top_up"])
      .eq("payout_status", "Approve")
      .order("created_at", { ascending: false });

    if (payoutError) {
      return { rows: [] as SalesCasePayoutRecord[], error: payoutError.message };
    }

    const filteredRows = ((data as SalesCasePayoutRecord[]) ?? []).filter(
      (row) => row.payout_type === "standard" || isReleasedHoldingPayout(row)
    );

    return { rows: filteredRows, error: null as string | null };
  };

  const fetchData = async () => {
    setError(null);

    if (!canGenerateVoucher) {
      const { data: voucherData, error: voucherError } = await supabase
        .from("finance_entries")
        .select("id, amount, attachment_url, reference_label, reference_detail, transacted_at, created_at")
        .eq("description", "Payment voucher generated")
        .order("created_at", { ascending: false });

      if (voucherError) {
        setError(voucherError.message);
        return;
      }

      setVoucherHistory((voucherData as VoucherHistoryEntry[]) ?? []);
      setPayouts([]);
      setCases([]);
      setProjects([]);
      setProfiles([]);
      return;
    }

    const [{ data: voucherData, error: voucherError }, approvedPayoutResult] =
      await Promise.all([
        supabase
          .from("finance_entries")
          .select("id, amount, attachment_url, reference_label, reference_detail, transacted_at, created_at")
          .eq("description", "Payment voucher generated")
          .order("created_at", { ascending: false }),
        fetchApprovedPayoutRows(),
      ]);

    if (approvedPayoutResult.error) {
      setError(approvedPayoutResult.error);
      return;
    }

    if (voucherError) {
      setError(voucherError.message);
      return;
    }

    const nextPayouts = approvedPayoutResult.rows;
    const nextVoucherHistory = (voucherData as VoucherHistoryEntry[]) ?? [];

    const { data: payoutDataNeedingReceipt, error: payoutDataNeedingReceiptError } = await supabase
      .from("sales_case_payouts")
      .select("id, payment_receipt_url")
      .in("payout_type", ["standard", "tier_upgrade_top_up"])
      .in("payout_status", ["Pending", "Approve", "Paid"])
      .is("payment_receipt_url", null);

    if (!payoutDataNeedingReceiptError && payoutDataNeedingReceipt) {
      const payoutUrlMap = new Map<string, string>();
      nextVoucherHistory.forEach((historyEntry) => {
        const meta = parseVoucherHistoryMeta(historyEntry.reference_detail);
        const attachmentUrl = historyEntry.attachment_url;

        if (!attachmentUrl) {
          return;
        }

        (meta?.payoutIds ?? []).forEach((payoutId) => {
          if (payoutId) {
            payoutUrlMap.set(payoutId, attachmentUrl);
          }
        });

        (meta?.componentKeys ?? []).forEach((componentKey) => {
          const payoutId = getPayoutIdFromComponentKey(componentKey);

          if (payoutId) {
            payoutUrlMap.set(payoutId, attachmentUrl);
          }
        });
      });

      const missingRows = (payoutDataNeedingReceipt as Array<{ id: string; payment_receipt_url: string | null }>)
        .filter((row) => !row.payment_receipt_url && payoutUrlMap.has(row.id));

      if (missingRows.length > 0) {
        await Promise.all(
          missingRows.map((row) =>
            supabase
              .from("sales_case_payouts")
              .update({ payment_receipt_url: payoutUrlMap.get(row.id) ?? null })
              .eq("id", row.id)
          )
        );
      }
    }

    setPayouts(nextPayouts);
    setVoucherHistory(nextVoucherHistory);

    const payoutSalesCaseIds = nextPayouts.map((row) => row.sales_case_id);
    const historySalesCaseIds = nextVoucherHistory.flatMap((entry) => parseVoucherHistoryDetail(entry.reference_detail).salesCaseIds);
    const salesCaseIds = Array.from(new Set([...payoutSalesCaseIds, ...historySalesCaseIds].filter(Boolean)));
    const profileIds = Array.from(new Set(nextPayouts.map((row) => row.profile_id)));

    if (salesCaseIds.length === 0) {
      setCases([]);
      setProjects([]);
      setProfiles([]);
      return;
    }

    const { data: caseData, error: caseError } = await supabase
      .from("sales_cases")
      .select("*")
      .in("id", salesCaseIds);

    const profileFetchResult = profileIds.length > 0
      ? await supabase.from("profiles").select("id, name, email").in("id", profileIds)
      : { data: [], error: null };

    const profileData = profileFetchResult.data;
    const profileError = profileFetchResult.error;

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

    const projectIds = Array.from(new Set(nextCases.map((record) => record.project_id).filter(Boolean))) as string[];

    if (projectIds.length === 0) {
      setProjects([]);
      return;
    }

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(
        "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, direct_commission, holding_commission, commission_structures, default_commission_structure_id"
      )
      .in("id", projectIds);

    if (projectError) {
      setError(projectError.message);
      return;
    }

    setProjects((projectData as ProjectOption[]) ?? []);
  };

  useEffect(() => {
    void fetchData();
  }, [canGenerateVoucher]);

  const caseMap = useMemo(() => {
    const map = new Map<string, SalesCaseRecord>();
    cases.forEach((record) => map.set(record.id, record));
    return map;
  }, [cases]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileOption>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  const paidComponentKeys = useMemo(() => {
    const keys = new Set<string>();

    voucherHistory.forEach((history) => {
      const meta = parseVoucherHistoryMeta(history.reference_detail);
      (meta?.componentKeys ?? []).forEach((key) => {
        if (key) {
          keys.add(key);
        }
      });
    });

    return keys;
  }, [voucherHistory]);

  const groupedCases = useMemo(() => {
    const grouped = new Map<string, VoucherGroup>();

    payouts.forEach((payout) => {
      const record = caseMap.get(payout.sales_case_id) ?? null;
      const project = record?.project_id ? projectMap.get(record.project_id) ?? null : null;
      const profile = profileMap.get(payout.profile_id) ?? null;
      const projectName = project?.project_name || "-";
      const unitLabel = record?.unit_number || "-";

      const existing = grouped.get(payout.sales_case_id) ?? {
        salesCaseId: payout.sales_case_id,
        projectName,
        unitLabel,
        signedLoDate: record?.signed_lo_date ?? null,
        bookingFormUrl: record?.booking_form_url ?? null,
        totalAmount: 0,
        rows: [],
      };

      existing.rows.push({
        id: payout.id,
        salesCaseId: payout.sales_case_id,
        projectName,
        unitLabel,
        signedLoDate: record?.signed_lo_date ?? null,
        nettPrice: record?.nett_price ?? null,
        profileId: payout.profile_id,
        memberLabel: profile?.name || profile?.email || "-",
        agentCommissionPercentage: payout.agent_commission_percentage,
        preLeaderOverridePercentage: payout.pre_leader_override_percentage,
        leaderOverridePercentage: payout.leader_override_percentage,
        commissionPercentage:
          payout.agent_commission_percentage +
          payout.pre_leader_override_percentage +
          payout.leader_override_percentage,
        amount: payout.total_amount,
        isHoldingComm: isReleasedHoldingPayout(payout),
        componentCategory: "claim",
      });

      existing.totalAmount += payout.total_amount;
      grouped.set(payout.sales_case_id, existing);
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        rows: [...group.rows]
          .filter((row) => getVoucherComponentBreakdown(row).some((component) => !paidComponentKeys.has(component.key)))
          .sort((left, right) => {
          if (left.isHoldingComm !== right.isHoldingComm) {
            return left.isHoldingComm ? 1 : -1;
          }

          const memberCompare = left.memberLabel.localeCompare(right.memberLabel);
          if (memberCompare !== 0) {
            return memberCompare;
          }

            return left.id.localeCompare(right.id);
          }),
      }))
      .filter((group) => group.rows.length > 0)
      .sort((left, right) => {
        const leftProject = left.projectName.toLowerCase();
        const rightProject = right.projectName.toLowerCase();

        if (leftProject !== rightProject) {
          return leftProject.localeCompare(rightProject);
        }

        return left.unitLabel.localeCompare(right.unitLabel);
      });
  }, [caseMap, paidComponentKeys, payouts, profileMap, projectMap]);

  useEffect(() => {
    setExpandedCaseIds((prev) => prev.filter((id) => groupedCases.some((group) => group.salesCaseId === id)));
    setSelectedComponentKeys((prev) => {
      const validComponentKeys = new Set(
        groupedCases.flatMap((group) =>
          group.rows.flatMap((row) =>
            getVoucherComponentBreakdown(row)
              .filter((component) => !paidComponentKeys.has(component.key))
              .map((component) => component.key)
          )
        )
      );

      return prev.filter((key) => validComponentKeys.has(key));
    });
  }, [groupedCases, paidComponentKeys]);

  const allCaseComponents = useMemo<SelectedVoucherComponentRow[]>(() => {
    return groupedCases.flatMap((group) =>
      group.rows.flatMap((row) =>
        getVoucherComponentBreakdown(row)
          .filter((component) => !paidComponentKeys.has(component.key))
          .map((component) => ({
            componentKey: component.key,
            row,
            component,
          }))
      )
    );
  }, [groupedCases, paidComponentKeys]);

  const selectedComponentRows = useMemo(
    () => allCaseComponents.filter((item) => selectedComponentKeys.includes(item.componentKey)),
    [allCaseComponents, selectedComponentKeys]
  );

  const selectedRows = useMemo(
    () =>
      selectedComponentRows.map(({ componentKey, row, component }) => ({
        ...row,
        id: componentKey,
        commissionPercentage: component.percentage,
        amount: component.amount,
        componentCategory: component.componentCategory,
      })),
    [selectedComponentRows]
  );

  const toggleExpand = (salesCaseId: string) => {
    setExpandedCaseIds((prev) =>
      prev.includes(salesCaseId)
        ? prev.filter((caseId) => caseId !== salesCaseId)
        : [...prev, salesCaseId]
    );
  };

  const toggleSelectCase = (salesCaseId: string) => {
    const caseComponents = groupedCases
      .find((group) => group.salesCaseId === salesCaseId)
      ?.rows.flatMap((row) =>
        getVoucherComponentBreakdown(row)
          .filter((component) => !paidComponentKeys.has(component.key))
          .map((component) => ({ componentKey: component.key, row }))
      ) ?? [];
    const selectedProfileId = selectedComponentRows[0]?.row.profileId ?? null;

    if (!selectedProfileId && caseComponents.length > 1) {
      setError("Please tick one member row first. You can only select one member across multiple cases.");
      setSuccess(null);
      return;
    }

    const targetComponents = selectedProfileId
      ? caseComponents.filter((item) => item.row.profileId === selectedProfileId)
      : caseComponents;
    const caseComponentKeys = targetComponents.map((item) => item.componentKey);

    if (caseComponentKeys.length === 0) {
      setError("This case has no payout row for the selected member.");
      setSuccess(null);
      return;
    }

    setSelectedComponentKeys((prev) => {
      const allSelected = caseComponentKeys.every((key) => prev.includes(key));

      if (allSelected) {
        return prev.filter((key) => !caseComponentKeys.includes(key));
      }

      return Array.from(new Set([...prev, ...caseComponentKeys]));
    });
  };

  const toggleSelectComponent = (componentKey: string) => {
    const targetComponent = allCaseComponents.find((item) => item.componentKey === componentKey) ?? null;

    if (!targetComponent) {
      return;
    }

    const selectedProfileId = selectedComponentRows[0]?.row.profileId ?? null;

    if (selectedProfileId && selectedProfileId !== targetComponent.row.profileId) {
      setError("You can only tick one member at a time. Untick current member rows before choosing another member.");
      setSuccess(null);
      return;
    }

    setSelectedComponentKeys((prev) =>
      prev.includes(componentKey)
        ? prev.filter((key) => key !== componentKey)
        : [...prev, componentKey]
    );
  };

  const selectedMemberProfileId = selectedComponentRows[0]?.row.profileId ?? null;
  const selectedMemberName = selectedComponentRows[0]?.row.memberLabel ?? null;

  const historyRows = useMemo<VoucherHistoryDisplayRow[]>(
    () =>
      voucherHistory.map((history) => {
        const parsed = parseVoucherHistoryDetail(history.reference_detail);
        return {
          id: history.id,
          amount: deriveGrossAmountFromHistory(history.amount ?? 0, history.reference_detail),
          attachmentUrl: history.attachment_url,
          generatedAt: history.transacted_at || history.created_at,
          memberLabel: parsed.memberLabel,
          detailsLabel: parsed.detailsLabel,
          bookingFormUrls: parsed.bookingFormUrls,
          salesCaseIds: parsed.salesCaseIds,
        };
      }),
    [voucherHistory]
  );

  const filteredHistoryRows = useMemo(() => {
    const normalizedNameSearch = historyNameSearch.trim().toLowerCase();
    const normalizedDetailsSearch = historyDetailsSearch.trim().toLowerCase();
    const fromDate = historyDateFrom ? new Date(historyDateFrom) : null;
    const toDate = historyDateTo ? new Date(historyDateTo) : null;

    return historyRows.filter((row) => {
      const generatedDate = new Date(row.generatedAt);

      if (fromDate && !Number.isNaN(fromDate.getTime()) && generatedDate < fromDate) {
        return false;
      }

      if (toDate && !Number.isNaN(toDate.getTime())) {
        const inclusiveTo = new Date(toDate);
        inclusiveTo.setHours(23, 59, 59, 999);
        if (generatedDate > inclusiveTo) {
          return false;
        }
      }

      if (normalizedNameSearch && !row.memberLabel.toLowerCase().includes(normalizedNameSearch)) {
        return false;
      }

      if (normalizedDetailsSearch && !row.detailsLabel.toLowerCase().includes(normalizedDetailsSearch)) {
        return false;
      }

      return true;
    });
  }, [historyDateFrom, historyDateTo, historyDetailsSearch, historyNameSearch, historyRows]);

  const loadImageAsDataUrl = async (imagePath: string) => {
    const response = await fetch(imagePath);
    const imageBlob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error("Unable to read image data."));
      };
      reader.onerror = () => reject(new Error("Unable to load image data."));
      reader.readAsDataURL(imageBlob);
    });
  };

  const buildVoucherPdf = async (
    rows: VoucherBreakdownRow[],
    options: {
      deductSst: boolean;
      deductWithholdingTax: boolean;
    },
    voucherInfo: {
      icNo: string;
      refNo: string;
      chequersNo: string;
    }
  ) => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const navy: [number, number, number] = [18, 33, 95];
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const calculatedAmounts = calculateVoucherAmounts(
      rows.reduce((sum, row) => sum + row.amount, 0),
      options
    );
    const { subTotalAmount, sstAmount, withholdingTaxAmount, finalPayoutAmount } = calculatedAmounts;

    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await loadImageAsDataUrl("/AO_favicon.png");
    } catch {
      try {
        logoDataUrl = await loadImageAsDataUrl("/AOGfavicon.png");
      } catch {
        logoDataUrl = null;
      }
    }

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", 28, 26, 102, 62);
    }

    const leftMargin = 46;
    const rightMargin = pageWidth - 46;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...navy);
    doc.setFontSize(16);
    doc.text("ATLAS OLSEN GROUP SDN. BHD.", 136, 68);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("202101036790 (1437090-T)", 430, 82);
    doc.setDrawColor(...navy);
    doc.setLineWidth(1);
    doc.line(28, 98, rightMargin, 98);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    const companyAddressLines = [
      "22-02, Laman Niaga Sunway,",
      "Persiaran Medini 3,",
      "Sunway City Iskandar Puteri,",
      "79250 Iskandar Puteri, Johor Darul Takzim.",
      "Email: atlasolsenrealtysdbhd@gmail.com",
      "Contact: +6017-831 2209",
    ];
    companyAddressLines.forEach((line, index) => {
      doc.text(line, leftMargin, 146 + index * 22);
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(30 / 3.2);
    doc.text("PAYMENT VOUCHER", leftMargin, 300);
    doc.line(leftMargin, 304, leftMargin + 120, 304);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const distinctPayees = Array.from(new Set(rows.map((row) => row.memberLabel)));
    const payeeLabel = distinctPayees.length === 1 ? distinctPayees[0] : "MULTIPLE SELECTED AGENTS";
    doc.text("Payee", leftMargin, 326);
    doc.text(`: ${payeeLabel}`, 126, 326);
    doc.text("I/C No", leftMargin, 348);
    doc.text(`: ${voucherInfo.icNo || "-"}`, 126, 348);
    doc.text("Date", leftMargin, 370);
    doc.text(`: ${new Date().toLocaleDateString("en-MY")}`, 126, 370);

    doc.text("Ref. No.", 330, 326);
    doc.text(`: ${voucherInfo.refNo || "-"}`, 440, 326);
    doc.text("Chequers No.", 330, 348);
    doc.text(`: ${voucherInfo.chequersNo || "-"}`, 440, 348);

    const tableTop = 398;
    const col = {
      x0: 40,
      x1: 75,
      x2: 335,
      x3: 385,
      x4: 475,
      x5: 555,
    };

    const drawTableHeader = (topY: number) => {
      doc.setFillColor(...navy);
      doc.rect(col.x0, topY, col.x5 - col.x0, 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text("#", (col.x0 + col.x1) / 2, topY + 15, { align: "center" });
      doc.text("Item & Description", (col.x1 + col.x2) / 2, topY + 15, { align: "center" });
      doc.text("Qty", (col.x2 + col.x3) / 2, topY + 15, { align: "center" });
      doc.text("Rate (Commission)", (col.x3 + col.x4) / 2, topY + 15, { align: "center" });
      doc.text("Amount", (col.x4 + col.x5) / 2, topY + 15, { align: "center" });
    };

    drawTableHeader(tableTop);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const rowsForPdf = [...rows].sort((left, right) => {
      const leftHeading = getVoucherClaimHeading(left);
      const rightHeading = getVoucherClaimHeading(right);
      const sectionOrder: Record<string, number> = {
        "LO Signed Claim:": 0,
        "Overriding:": 1,
        "3rd Claim for Stage 2A:": 2,
      };

      const headingDelta = (sectionOrder[leftHeading] ?? 99) - (sectionOrder[rightHeading] ?? 99);
      if (headingDelta !== 0) {
        return headingDelta;
      }

      const projectDelta = left.projectName.localeCompare(right.projectName);
      if (projectDelta !== 0) {
        return projectDelta;
      }

      return left.unitLabel.localeCompare(right.unitLabel);
    });

    let currentY = tableTop + 36;
    const footerHeight = 40;
    const summaryBlockHeight =
      (options.deductSst ? 24 : 0) +
      30 +
      (options.deductWithholdingTax ? 30 : 0) +
      26;

    let previousHeading: string | null = null;

    rowsForPdf.forEach((row, index) => {
      const claimHeading = getVoucherClaimHeading(row);
      const itemBlockHeight = 62;
      const isLastRow = index === rowsForPdf.length - 1;
      const requiredHeight = itemBlockHeight + (isLastRow ? summaryBlockHeight + 8 : 0);

      if (currentY + requiredHeight > pageHeight - footerHeight) {
        doc.addPage();
        const nextTableTop = 52;
        drawTableHeader(nextTableTop);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        currentY = nextTableTop + 36;
        previousHeading = null;
      }

      const shouldRenderHeading = claimHeading !== previousHeading;

      const descriptionStartY = currentY;
      const amountRowY = currentY + 10;
      const indexY = currentY + 18;

      doc.text(String(index + 1), (col.x0 + col.x1) / 2, indexY, { align: "center" });

      if (shouldRenderHeading) {
        doc.setFont("helvetica", "bold");
        doc.text(claimHeading, col.x1 + 8, descriptionStartY);
      }

      doc.setFont("helvetica", "normal");
      doc.text(`${row.projectName} ${row.unitLabel}`, col.x1 + 8, descriptionStartY + 20);

      const nettPriceLabel = row.nettPrice !== null ? `RM ${formatAmount(row.nettPrice)}` : "-";
      doc.text(`Net purchase price: ${nettPriceLabel}`, col.x1 + 8, descriptionStartY + 40);

      doc.text("1", (col.x2 + col.x3) / 2, amountRowY, { align: "center" });
      doc.text(formatPercentage(row.commissionPercentage), (col.x3 + col.x4) / 2, amountRowY, { align: "center" });
      doc.text(`RM ${formatAmount(row.amount)}`, col.x5 - 8, amountRowY, { align: "right" });

      currentY += itemBlockHeight;
      previousHeading = claimHeading;
    });

    currentY += 8;
    doc.setFont("helvetica", "normal");
    if (options.deductSst) {
      doc.text("Deduct SST", 222, currentY);
      doc.text(":", 330, currentY);
      doc.text("8%", 430, currentY, { align: "right" });
      doc.text(`RM ${formatAmount(sstAmount)}`, col.x5 - 8, currentY, { align: "right" });
      currentY += 24;
    }

    doc.setFillColor(220, 220, 220);
    doc.rect(col.x0, currentY - 14, col.x5 - col.x0, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.text("Sub Total", 185, currentY);
    doc.text(`RM ${formatAmount(subTotalAmount)}`, col.x5 - 8, currentY, { align: "right" });
    currentY += 30;

    doc.setFont("helvetica", "normal");
    if (options.deductWithholdingTax) {
      doc.text("Deduct Withholding Tax", 172, currentY);
      doc.text(":", 330, currentY);
      doc.text("2%", 430, currentY, { align: "right" });
      doc.text(`RM ${formatAmount(withholdingTaxAmount)}`, col.x5 - 8, currentY, { align: "right" });
      currentY += 30;
    }

    doc.setFillColor(...navy);
    doc.rect(355, currentY - 15, 200, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("Total", 418, currentY + 1, { align: "center" });
    doc.text(`RM ${formatAmount(finalPayoutAmount)}`, 548, currentY + 1, { align: "right" });

    const pageCount = doc.getNumberOfPages();
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      doc.setPage(pageNumber);
      doc.text(String(pageNumber), pageWidth / 2, pageHeight - 24, { align: "center" });
    }

    return doc.output("blob");
  };

  const handleOpenGenerateOptions = () => {
    if (!canGenerateVoucher) {
      return;
    }

    if (selectedRows.length === 0) {
      setError("Please tick at least one agent payout row to generate payment voucher.");
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setDeductSst(false);
    setDeductWithholdingTax(false);
    setVoucherIcNo("");
    setVoucherRefNo("");
    setVoucherChequersNo("");
    setShowGenerateOptions(true);
  };

  const handleGenerateVoucher = async () => {
    if (!canGenerateVoucher) {
      return;
    }

    if (selectedRows.length === 0) {
      setError("Please tick at least one agent payout row to generate payment voucher.");
      setSuccess(null);
      setShowGenerateOptions(false);
      return;
    }

    const normalizedIcNo = voucherIcNo.trim();
    const normalizedRefNo = voucherRefNo.trim();
    const normalizedChequersNo = voucherChequersNo.trim();

    if (!normalizedIcNo || !normalizedRefNo || !normalizedChequersNo) {
      setError("Please fill in I/C No, Ref. No., and Chequers No. before generating the voucher.");
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setIsGenerating(true);
    try {
      const selectedDeductions = {
        deductSst,
        deductWithholdingTax,
      };

      const voucherBlob = await buildVoucherPdf(selectedRows, selectedDeductions, {
        icNo: normalizedIcNo,
        refNo: normalizedRefNo,
        chequersNo: normalizedChequersNo,
      });
      const voucherPath = buildUniqueVoucherPath(userId, selectedRows);

      const { error: uploadError } = await supabase.storage
        .from("cases")
        .upload(voucherPath, voucherBlob, {
          upsert: false,
          contentType: "application/pdf",
        });

      if (uploadError) {
        setError(uploadError.message);
        setIsGenerating(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from("cases").getPublicUrl(voucherPath);
      const voucherUrl = publicUrlData.publicUrl;

      const selectedDetails = Array.from(
        new Set(selectedRows.map((row) => `${row.projectName} Unit ${row.unitLabel}`))
      ).join("; ");
      const selectedMemberLabels = Array.from(new Set(selectedRows.map((row) => row.memberLabel)));
      const selectedComponentKeyList = Array.from(new Set(selectedRows.map((row) => row.id).filter(Boolean)));
      const selectedPayoutIds = Array.from(new Set(selectedComponentRows.map(({ row }) => row.id).filter(Boolean)));
      const selectedSalesCaseIds = Array.from(new Set(selectedRows.map((row) => row.salesCaseId).filter(Boolean)));
      const selectedProfileIds = Array.from(new Set(selectedRows.map((row) => row.profileId).filter(Boolean)));
      const selectedCommissionLabels = Array.from(
        new Set(selectedRows.map((row) => formatPercentage(row.commissionPercentage)).filter((label) => label !== "-"))
      );
      const selectedBookingFormUrls = Array.from(
        new Set(
          selectedRows
            .map((row) => caseMap.get(row.salesCaseId)?.booking_form_url ?? null)
            .filter((url): url is string => Boolean(url))
        )
      );

      const historyMetaPayload = JSON.stringify({
        payoutIds: selectedPayoutIds,
        componentKeys: selectedComponentKeyList,
        grossAmount: Number(selectedRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
        salesCaseIds: selectedSalesCaseIds,
        storagePath: voucherPath,
        profileIds: selectedProfileIds,
        memberLabels: selectedMemberLabels,
        commissionLabels: selectedCommissionLabels,
        bookingFormUrls: selectedBookingFormUrls,
        icNo: normalizedIcNo,
        refNo: normalizedRefNo,
        chequersNo: normalizedChequersNo,
      } as VoucherHistoryMeta);
      const storedReferenceDetail = `${selectedDetails}${HISTORY_META_SEPARATOR}${historyMetaPayload}`;

      const calculatedAmounts = calculateVoucherAmounts(
        selectedRows.reduce((sum, row) => sum + row.amount, 0),
        selectedDeductions
      );
      const totalAmount = calculatedAmounts.finalPayoutAmount;
      const deductionNote = [
        selectedDeductions.deductSst ? "Deduct SST 8%" : null,
        selectedDeductions.deductWithholdingTax ? "Deduct WHT 2%" : null,
      ]
        .filter(Boolean)
        .join(", ");

      const { error: insertError } = await supabase.from("finance_entries").insert({
        entry_type: "cash_out",
        amount: totalAmount,
        description: "Payment voucher generated",
        reference_label: `Payment Voucher ${new Date().toLocaleDateString("en-MY")}`,
        reference_detail: `${storedReferenceDetail}${deductionNote ? ` | ${deductionNote}` : ""}`,
        attachment_url: voucherUrl,
        sales_case_id: null,
        entry_scope: "manual",
        transacted_at: new Date().toISOString(),
        created_by: userId,
      });

      if (insertError) {
        await supabase.storage.from("cases").remove([voucherPath]).catch(() => undefined);
        setError(insertError.message);
        setIsGenerating(false);
        return;
      }

      const selectedByPayoutId = new Map<string, number>();
      selectedComponentRows.forEach(({ row }) => {
        selectedByPayoutId.set(row.id, (selectedByPayoutId.get(row.id) ?? 0) + 1);
      });

      const payoutIdsToAttachVoucher = Array.from(selectedByPayoutId.keys());

      if (payoutIdsToAttachVoucher.length > 0) {
        const { error: linkReceiptError } = await supabase
          .from("sales_case_payouts")
          .update({ payment_receipt_url: voucherUrl })
          .in("id", payoutIdsToAttachVoucher);

        if (linkReceiptError) {
          setError(`Payment voucher generated, but unable to link payout receipts: ${linkReceiptError.message}`);
          setIsGenerating(false);
          setShowGenerateOptions(false);
          await fetchData();
          return;
        }
      }

      const payoutIdsToMarkPaid = Array.from(selectedByPayoutId.entries())
        .filter(([payoutId, selectedCount]) => {
          const sourceRow = groupedCases.flatMap((group) => group.rows).find((row) => row.id === payoutId);

          if (!sourceRow) {
            return false;
          }

          const remainingComponentCount = getVoucherComponentBreakdown(sourceRow)
            .filter((component) => !paidComponentKeys.has(component.key)).length;

          return remainingComponentCount > 0 && selectedCount >= remainingComponentCount;
        })
        .map(([payoutId]) => payoutId);

      let markPaidError: { message: string } | null = null;

      if (payoutIdsToMarkPaid.length > 0) {
        const { error } = await supabase
          .from("sales_case_payouts")
          .update({
            payout_status: "Paid",
            paid_at: new Date().toISOString(),
            paid_by: userId,
            payment_receipt_url: voucherUrl,
          })
          .in("id", payoutIdsToMarkPaid);

        markPaidError = error;
      }

      if (markPaidError) {
        setError(`Payment voucher generated, but unable to update payout status: ${markPaidError.message}`);
        setIsGenerating(false);
        setShowGenerateOptions(false);
        await fetchData();
        return;
      }

      try {
        await notifyPaymentVoucherGenerated({
          actorUserId: userId,
          recipientIds: selectedProfileIds,
          salesCaseId: selectedSalesCaseIds[0] ?? null,
          details: selectedDetails,
          grossAmount: Number(selectedRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
        });
      } catch (notificationError) {
        console.error("Failed to create notifications for generated payment voucher", notificationError);
      }

      await fetchData();
      setSelectedComponentKeys([]);
      setIsGenerating(false);
      setShowGenerateOptions(false);
      setSuccess("Payment voucher PDF generated and saved to history.");
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : "Unable to generate payment voucher.";
      setError(message);
      setIsGenerating(false);
    }
  };

  const handleDeleteVoucherHistory = async () => {
    if (!pendingDeleteHistory) {
      return;
    }

    if (deleteConfirmationText !== "CONFIRM") {
      setError('Please type "CONFIRM" before deleting the payment voucher history.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsDeletingHistoryId(pendingDeleteHistory.id);

    const historyMeta = parseVoucherHistoryMeta(pendingDeleteHistory.reference_detail);
    const storagePathCandidates = new Set<string>();

    if (historyMeta?.storagePath) {
      storagePathCandidates.add(historyMeta.storagePath);
      storagePathCandidates.add(decodeURIComponent(historyMeta.storagePath));
    }

    const attachmentPath = getStoragePathFromPublicUrl(pendingDeleteHistory.attachment_url);
    if (attachmentPath) {
      storagePathCandidates.add(attachmentPath);
      storagePathCandidates.add(decodeURIComponent(attachmentPath));
    }

    const normalizedStoragePathCandidates = Array.from(storagePathCandidates)
      .map((path) => path.trim())
      .filter(Boolean);

    if (normalizedStoragePathCandidates.length === 0) {
      setError("Unable to determine payment voucher file path for deletion.");
      setIsDeletingHistoryId(null);
      return;
    }

    let storageDeleteSucceeded = false;
    const storageDeleteErrors: string[] = [];

    for (const candidatePath of normalizedStoragePathCandidates) {
      const { error: storageDeleteError } = await supabase.storage
        .from("cases")
        .remove([candidatePath]);

      if (!storageDeleteError) {
        storageDeleteSucceeded = true;
        break;
      }

      storageDeleteErrors.push(`${candidatePath}: ${storageDeleteError.message}`);
    }

    if (!storageDeleteSucceeded) {
      setError(`Unable to delete payment voucher PDF from storage. ${storageDeleteErrors.join(" | ")}`);
      setIsDeletingHistoryId(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("finance_entries")
      .delete()
      .eq("id", pendingDeleteHistory.id);

    if (deleteError) {
      setError(deleteError.message);
      setIsDeletingHistoryId(null);
      return;
    }

    const payoutIdsToRestore = Array.from(new Set((historyMeta?.payoutIds ?? []).filter(Boolean)));

    const restorePayload = {
      payout_status: "Approve" as const,
      paid_at: null,
      paid_by: null,
      payment_receipt_url: null,
    };

    if (payoutIdsToRestore.length > 0) {
      const { error: payoutRestoreError } = await supabase
        .from("sales_case_payouts")
        .update(restorePayload)
        .in("id", payoutIdsToRestore);

      if (payoutRestoreError) {
        setError(`Payment voucher history deleted, but unable to restore payout rows: ${payoutRestoreError.message}`);
        setIsDeletingHistoryId(null);
        await fetchData();
        return;
      }
    }

    if (pendingDeleteHistory.attachment_url) {
      const { error: payoutRestoreByReceiptError } = await supabase
        .from("sales_case_payouts")
        .update(restorePayload)
        .eq("payment_receipt_url", pendingDeleteHistory.attachment_url);

      if (payoutRestoreByReceiptError) {
        setError(`Payment voucher history deleted, but unable to restore receipt-linked payout rows: ${payoutRestoreByReceiptError.message}`);
        setIsDeletingHistoryId(null);
        await fetchData();
        return;
      }
    }

    await fetchData();
    setIsDeletingHistoryId(null);
    setPendingDeleteHistory(null);
    setDeleteConfirmationText("");
    setSuccess("Payment voucher history deleted successfully.");
  };

  const handleDownloadVoucher = async (attachmentUrl: string | null) => {
    if (!attachmentUrl) {
      return;
    }

    const attachmentPath = getStoragePathFromPublicUrl(attachmentUrl);

    if (!attachmentPath) {
      setError("Unable to find voucher file path for download.");
      return;
    }

    const { data, error: downloadError } = await supabase.storage
      .from("cases")
      .download(attachmentPath);

    if (downloadError || !data) {
      setError(downloadError?.message || "Unable to download the voucher file.");
      return;
    }

    const fileName = attachmentPath.split("/").pop() || "payment-voucher.pdf";
    const objectUrl = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleRevertCase = async (group: VoucherGroup) => {
    if (!canGenerateVoucher) {
      return;
    }

    if (group.rows.length === 0) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRevertingCaseId(group.salesCaseId);

    const payoutIds = group.rows.map((row) => row.id);

    const { error: revertError } = await supabase
      .from("sales_case_payouts")
      .update({ payout_status: "Pending" })
      .in("id", payoutIds);

    if (revertError) {
      setError(revertError.message);
      setIsRevertingCaseId(null);
      return;
    }

    await fetchData();
    setSelectedComponentKeys((prev) =>
      prev.filter((key) => !payoutIds.some((payoutId) => key.startsWith(`${payoutId}-`)))
    );
    setIsRevertingCaseId(null);
    setSuccess(`Reverted ${group.projectName} Unit ${group.unitLabel} back to Payout Approval.`);
  };

  const pendingCaseCount = groupedCases.length;

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Payment Voucher</h2>
          <p className="mt-1 text-sm text-gray-500">
            {canGenerateVoucher
              ? "Above shows cases that have not made payment yet. Tick one or more agent rows and generate payment voucher PDF."
              : "View only mode. Admin can only view generated payment voucher history."}
          </p>
        </div>
        {canGenerateVoucher && (
          <button
            type="button"
            onClick={handleOpenGenerateOptions}
            disabled={isGenerating}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isGenerating ? "Generating..." : "Generate Payment Voucher"}
          </button>
        )}
      </div>

      {canGenerateVoucher && (
        <div className="mb-4 rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
          Pending cases: <span className="font-semibold">{pendingCaseCount}</span> | Selected agent rows: <span className="font-semibold">{selectedRows.length}</span>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      {canGenerateVoucher && (
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
          Cases Pending Payment
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="px-4 py-3">Select</th>
                <th className="px-4 py-3">Project & Unit</th>
                <th className="px-4 py-3">Signed LO Date</th>
                <th className="px-4 py-3">Booking Form</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Total Comm (RM)</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {groupedCases.map((group) => {
                const isExpanded = expandedCaseIds.includes(group.salesCaseId);
                const selectableRows = selectedMemberProfileId
                  ? group.rows.filter((row) => row.profileId === selectedMemberProfileId)
                  : group.rows;
                const selectableComponentKeys = selectableRows.flatMap((row) =>
                  getVoucherComponentBreakdown(row)
                    .filter((component) => !paidComponentKeys.has(component.key))
                    .map((component) => component.key)
                );
                const isSelected =
                  selectableComponentKeys.length > 0 && selectableComponentKeys.every((key) => selectedComponentKeys.includes(key));

                return (
                  <Fragment key={group.salesCaseId}>
                    <tr key={group.salesCaseId} className="border-b border-gray-100">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectCase(group.salesCaseId)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        <div className="font-medium">{group.projectName}</div>
                        <div className="text-xs text-gray-500">Unit {group.unitLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(group.signedLoDate)}</td>
                      <td className="px-4 py-3 text-gray-700">
                        <button
                          type="button"
                          onClick={() => setSelectedCase(caseMap.get(group.salesCaseId) ?? null)}
                          disabled={!caseMap.get(group.salesCaseId)}
                          className="inline-flex items-center rounded-md border border-primary/25 px-2 py-1 text-xs text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          View
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{new Set(group.rows.map((row) => row.profileId)).size}</td>
                      <td className="px-4 py-3 text-gray-700">{formatAmount(group.totalAmount)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRevertCase(group)}
                            disabled={isRevertingCaseId === group.salesCaseId}
                            className="inline-flex items-center rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:text-amber-800 disabled:opacity-60"
                          >
                            {isRevertingCaseId === group.salesCaseId ? "Reverting..." : "Revert"}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExpand(group.salesCaseId)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-100 bg-gray-50/50">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-100 text-left text-gray-500">
                                  <th className="px-2 py-2">Tick</th>
                                  <th className="px-2 py-2">Member</th>
                                  <th className="px-2 py-2">Type</th>
                                  <th className="px-2 py-2">Commission %</th>
                                  <th className="px-2 py-2">Amount (RM)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.rows.map((row) => {
                                  const componentRows = getVoucherComponentBreakdown(row).filter(
                                    (component) => !paidComponentKeys.has(component.key)
                                  );

                                  return componentRows.map((component) => (
                                    <tr
                                      key={component.key}
                                      className={`border-b border-gray-100 ${component.typeLabel.includes("Holding Comm") ? "bg-yellow-50" : ""}`}
                                    >
                                      <td className="px-2 py-2 text-gray-700">
                                        <input
                                          type="checkbox"
                                          checked={selectedComponentKeys.includes(component.key)}
                                          onChange={() => toggleSelectComponent(component.key)}
                                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                      </td>
                                      <td className="px-2 py-2 text-gray-700">{row.memberLabel}</td>
                                      <td className="px-2 py-2 text-gray-700">{component.typeLabel}</td>
                                      <td className="px-2 py-2 text-gray-700">{formatPercentage(component.percentage)}</td>
                                      <td className="px-2 py-2 text-gray-700">{formatAmount(component.amount)}</td>
                                    </tr>
                                  ));
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {groupedCases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                    No approved payout cases available for voucher generation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      <div className="mt-6 rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm font-semibold text-gray-800">Generated Payment Voucher History</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                Total sent: <span className="font-semibold text-gray-800">{voucherHistory.length}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <input
              type="date"
              value={historyDateFrom}
              onChange={(event) => setHistoryDateFrom(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <input
              type="date"
              value={historyDateTo}
              onChange={(event) => setHistoryDateTo(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              value={historyNameSearch}
              onChange={(event) => setHistoryNameSearch(event.target.value)}
              placeholder="Search member name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              value={historyDetailsSearch}
              onChange={(event) => setHistoryDetailsSearch(event.target.value)}
              placeholder="Search details"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="px-4 py-3">Generated Date</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Amount (RM)</th>
                <th className="px-4 py-3">Details</th>
                {canGenerateVoucher && <th className="px-4 py-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredHistoryRows.map((history) => (
                <tr key={history.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-gray-700">{formatDate(history.generatedAt)}</td>
                  <td className="px-4 py-3 text-gray-700">{history.memberLabel}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {history.attachmentUrl ? (
                      <button
                        type="button"
                        onClick={() => void handleDownloadVoucher(history.attachmentUrl)}
                        className="inline-flex items-center rounded-md border border-primary/25 px-2 py-1 text-xs text-primary hover:bg-primary/5"
                      >
                        Download PDF
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatAmount(history.amount)}</td>
                  <td className="px-4 py-3 text-gray-700">{history.detailsLabel}</td>
                  {canGenerateVoucher && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          const rawEntry = voucherHistory.find((entry) => entry.id === history.id) ?? null;
                          setPendingDeleteHistory(rawEntry);
                          setDeleteConfirmationText("");
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}

              {filteredHistoryRows.length === 0 && (
                <tr>
                  <td colSpan={canGenerateVoucher ? 6 : 5} className="px-4 py-6 text-center text-gray-500">
                    No generated payment voucher found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canGenerateVoucher && showGenerateOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-100 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-800">Generate Payment Voucher</h3>
              <p className="mt-1 text-sm text-gray-500">
                Choose optional deductions to include in the voucher.
              </p>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-gray-700">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Selected member: <span className="font-semibold">{selectedMemberName || "-"}</span>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">I/C No</label>
                <input
                  type="text"
                  value={voucherIcNo}
                  onChange={(event) => setVoucherIcNo(event.target.value)}
                  placeholder="Enter I/C No"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Ref. No.</label>
                <input
                  type="text"
                  value={voucherRefNo}
                  onChange={(event) => setVoucherRefNo(event.target.value)}
                  placeholder="Enter Ref. No."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Chequers No.</label>
                <input
                  type="text"
                  value={voucherChequersNo}
                  onChange={(event) => setVoucherChequersNo(event.target.value)}
                  placeholder="Enter Chequers No."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={deductSst}
                  onChange={(event) => setDeductSst(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>Deduct 8% SST</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={deductWithholdingTax}
                  onChange={(event) => setDeductWithholdingTax(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>Deduct 2% Withholding Tax</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowGenerateOptions(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateVoucher()}
                disabled={isGenerating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isGenerating ? "Generating..." : "Generate PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canGenerateVoucher && pendingDeleteHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-100 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-800">Delete Payment Voucher History</h3>
              <p className="mt-1 text-sm text-gray-500">
                This will delete the voucher history row and remove the generated PDF from storage.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm text-gray-700">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Type <span className="font-semibold">CONFIRM</span> to delete
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
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteHistory(null);
                  setDeleteConfirmationText("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteVoucherHistory()}
                disabled={isDeletingHistoryId === pendingDeleteHistory.id || deleteConfirmationText !== "CONFIRM"}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isDeletingHistoryId === pendingDeleteHistory.id ? "Deleting..." : "Delete"}
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
          readOnly
          onClose={() => setSelectedCase(null)}
          onSaved={() => {
            setSelectedCase(null);
            void fetchData();
          }}
        />
      )}
    </div>
  );
}
