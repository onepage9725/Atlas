import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type MemberVoucherPayoutRow = {
  id: string;
  sales_case_id: string;
  payout_status: string;
  payout_type: string;
  source_commission_structure_id: string | null;
  target_commission_structure_id: string | null;
  source_commission_structure_label: string | null;
  target_commission_structure_label: string | null;
  agent_commission_percentage: number;
  pre_leader_override_percentage: number;
  leader_override_percentage: number;
  total_amount: number;
  payment_receipt_url: string | null;
  paid_at: string | null;
  created_at: string;
};

type SalesCaseVoucherInfo = {
  id: string;
  project_id: string | null;
  unit_number: string | null;
  booking_form_url: string | null;
};

type ProjectNameRow = {
  id: string;
  project_name: string | null;
};

type VoucherRow = {
  id: string;
  amount: number;
  voucherUrl: string | null;
  generatedAt: string;
  details: string;
};

type FinanceVoucherEntry = {
  id: string;
  attachment_url: string | null;
  amount: number;
  reference_detail: string | null;
  transacted_at: string | null;
  created_at: string;
};

type VoucherHistoryMeta = {
  grossAmount?: number;
  payoutIds?: string[];
  profileIds?: string[];
  componentKeys?: string[];
  salesCaseIds?: string[];
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

const normalizeText = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

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

const parseVoucherHistoryMeta = (referenceDetail: string | null | undefined) => {
  if (!referenceDetail || !referenceDetail.includes(HISTORY_META_SEPARATOR)) {
    return null;
  }

  const [, metaPayload] = referenceDetail.split(HISTORY_META_SEPARATOR);

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

const getVoucherReferenceBaseDetail = (referenceDetail: string | null | undefined) => {
  if (!referenceDetail) {
    return "";
  }

  const [baseDetail] = referenceDetail.split(HISTORY_META_SEPARATOR);
  return (baseDetail || "").trim();
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

const isReleasedHoldingPayout = (payout: MemberVoucherPayoutRow) => {
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

export function MyPaymentVoucherPage({
  userId,
}: {
  userId: string;
  userName: string | null;
  userEmail: string | null;
}) {
  const [payouts, setPayouts] = useState<MemberVoucherPayoutRow[]>([]);
  const [cases, setCases] = useState<SalesCaseVoucherInfo[]>([]);
  const [projects, setProjects] = useState<ProjectNameRow[]>([]);
  const [voucherEntries, setVoucherEntries] = useState<FinanceVoucherEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");

  useEffect(() => {
    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);

      const { data: payoutData, error: payoutError } = await supabase
        .from("sales_case_payouts")
        .select(
          "id, sales_case_id, payout_status, payout_type, source_commission_structure_id, target_commission_structure_id, source_commission_structure_label, target_commission_structure_label, agent_commission_percentage, pre_leader_override_percentage, leader_override_percentage, total_amount, payment_receipt_url, paid_at, created_at"
        )
        .eq("profile_id", userId)
        .in("payout_type", ["standard", "tier_upgrade_top_up"])
        .in("payout_status", ["Pending", "Approve", "Paid"])
        .order("paid_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (payoutError) {
        setError(payoutError.message);
        setIsLoading(false);
        return;
      }

      const memberPayoutRows = ((payoutData as MemberVoucherPayoutRow[]) ?? []).filter(
        (row) => row.payout_type === "standard" || isReleasedHoldingPayout(row)
      );
      setPayouts(memberPayoutRows);

      const payoutIdSet = new Set(memberPayoutRows.map((row) => row.id));
      const payoutReceiptUrls = new Set(
        memberPayoutRows.map((row) => row.payment_receipt_url).filter((url): url is string => Boolean(url))
      );

      const { data: voucherEntryData, error: voucherEntryError } = await supabase
        .from("finance_entries")
        .select("id, attachment_url, amount, reference_detail, transacted_at, created_at")
        .eq("description", "Payment voucher generated")
        .order("created_at", { ascending: false });

      if (voucherEntryError) {
        setError(voucherEntryError.message);
        setIsLoading(false);
        return;
      }

      const relevantVoucherEntries = ((voucherEntryData as FinanceVoucherEntry[]) ?? []).filter((entry) => {
        const meta = parseVoucherHistoryMeta(entry.reference_detail);
        const hasDirectProfileMatch = (meta?.profileIds ?? []).includes(userId);

        if (hasDirectProfileMatch) {
          return true;
        }

        const hasComponentMatch = (meta?.componentKeys ?? []).some((componentKey) => {
          const payoutId = getPayoutIdFromComponentKey(componentKey);
          return Boolean(payoutId && payoutIdSet.has(payoutId));
        });

        if (hasComponentMatch) {
          return true;
        }

        const hasPayoutIdMatch = (meta?.payoutIds ?? []).some((payoutId) => payoutIdSet.has(payoutId));

        if (hasPayoutIdMatch) {
          return true;
        }

        return Boolean(entry.attachment_url && payoutReceiptUrls.has(entry.attachment_url));
      });

      setVoucherEntries(relevantVoucherEntries);

      const payoutsById = new Map(memberPayoutRows.map((row) => [row.id, row]));
      const salesCaseIds = new Set<string>(
        memberPayoutRows.map((row) => row.sales_case_id).filter((salesCaseId): salesCaseId is string => Boolean(salesCaseId))
      );

      relevantVoucherEntries.forEach((entry) => {
        const meta = parseVoucherHistoryMeta(entry.reference_detail);

        (meta?.salesCaseIds ?? []).forEach((salesCaseId) => {
          if (salesCaseId) {
            salesCaseIds.add(salesCaseId);
          }
        });

        (meta?.componentKeys ?? []).forEach((componentKey) => {
          const payoutId = getPayoutIdFromComponentKey(componentKey);
          const payout = payoutId ? payoutsById.get(payoutId) : null;

          if (payout?.sales_case_id) {
            salesCaseIds.add(payout.sales_case_id);
          }
        });
      });

      const uniqueSalesCaseIds = Array.from(salesCaseIds);

      if (uniqueSalesCaseIds.length === 0) {
        setCases([]);
        setProjects([]);
        setIsLoading(false);
        return;
      }

      const { data: caseData, error: caseError } = await supabase
        .from("sales_cases")
        .select("id, project_id, unit_number, booking_form_url")
        .in("id", uniqueSalesCaseIds);

      if (caseError) {
        setError(caseError.message);
        setIsLoading(false);
        return;
      }

      const nextCases = (caseData as SalesCaseVoucherInfo[]) ?? [];
      setCases(nextCases);

      const projectIds = Array.from(new Set(nextCases.map((row) => row.project_id).filter(Boolean))) as string[];

      if (projectIds.length === 0) {
        setProjects([]);
        setIsLoading(false);
        return;
      }

      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("id, project_name")
        .in("id", projectIds);

      if (projectError) {
        setError(projectError.message);
        setIsLoading(false);
        return;
      }

      setProjects((projectData as ProjectNameRow[]) ?? []);
      setIsLoading(false);
    };

    void loadHistory();
  }, [userId]);

  const caseMap = useMemo(() => {
    const map = new Map<string, SalesCaseVoucherInfo>();
    cases.forEach((row) => map.set(row.id, row));
    return map;
  }, [cases]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectNameRow>();
    projects.forEach((row) => map.set(row.id, row));
    return map;
  }, [projects]);

  const voucherGrossAmountMap = useMemo(() => {
    const latestEntryByUrl = new Map<string, FinanceVoucherEntry>();

    voucherEntries.forEach((entry) => {
      if (!entry.attachment_url) {
        return;
      }

      const existing = latestEntryByUrl.get(entry.attachment_url);
      const existingTime = new Date(existing?.transacted_at || existing?.created_at || 0).getTime();
      const currentTime = new Date(entry.transacted_at || entry.created_at || 0).getTime();

      if (!existing || currentTime >= existingTime) {
        latestEntryByUrl.set(entry.attachment_url, entry);
      }
    });

    const map = new Map<string, number>();

    latestEntryByUrl.forEach((entry, attachmentUrl) => {
      const grossAmount = deriveGrossAmountFromHistory(entry.amount ?? 0, entry.reference_detail);
      map.set(attachmentUrl, grossAmount);
    });

    return map;
  }, [voucherEntries]);

  const ownVoucherRows = useMemo<VoucherRow[]>(() => {
    if (voucherEntries.length > 0) {
      const payoutsById = new Map(payouts.map((payout) => [payout.id, payout]));

      return voucherEntries.map((entry) => {
        const meta = parseVoucherHistoryMeta(entry.reference_detail);
        const voucherUrl = entry.attachment_url;
        const amount = voucherUrl
          ? voucherGrossAmountMap.get(voucherUrl) ?? deriveGrossAmountFromHistory(entry.amount ?? 0, entry.reference_detail)
          : deriveGrossAmountFromHistory(entry.amount ?? 0, entry.reference_detail);

        const metaSalesCaseIds = (meta?.salesCaseIds ?? []).filter(Boolean);
        const componentSalesCaseIds = (meta?.componentKeys ?? [])
          .map((componentKey) => {
            const payoutId = getPayoutIdFromComponentKey(componentKey);
            return payoutId ? payoutsById.get(payoutId)?.sales_case_id ?? null : null;
          })
          .filter((salesCaseId): salesCaseId is string => Boolean(salesCaseId));
        const relatedSalesCaseIds = Array.from(new Set([...metaSalesCaseIds, ...componentSalesCaseIds]));

        const relatedCaseDetails = relatedSalesCaseIds
          .map((salesCaseId) => {
            const relatedCase = caseMap.get(salesCaseId) ?? null;
            const relatedProject = relatedCase?.project_id ? projectMap.get(relatedCase.project_id) ?? null : null;
            const projectName = relatedProject?.project_name || "-";
            const unitLabel = relatedCase?.unit_number || "-";
            return `${projectName} Unit ${unitLabel}`;
          })
          .filter(Boolean);

        const detailsFromReference = getVoucherReferenceBaseDetail(entry.reference_detail);
        const details = detailsFromReference || Array.from(new Set(relatedCaseDetails)).join("; ") || "-";

        return {
          id: entry.id,
          amount,
          voucherUrl,
          generatedAt: entry.transacted_at || entry.created_at,
          details,
        };
      });
    }

    const groupedByVoucher = new Map<string, MemberVoucherPayoutRow[]>();

    payouts
      .filter((payout) => payout.payout_status === "Paid" || Boolean(payout.payment_receipt_url))
      .forEach((payout) => {
        const voucherKey = payout.payment_receipt_url || `payout-${payout.id}`;
        const group = groupedByVoucher.get(voucherKey) ?? [];
        group.push(payout);
        groupedByVoucher.set(voucherKey, group);
      });

    return Array.from(groupedByVoucher.entries()).map(([voucherKey, groupedPayouts]) => {
      const voucherUrl = groupedPayouts[0]?.payment_receipt_url ?? null;

      const detailLabels = Array.from(
        new Set(
          groupedPayouts.map((payout) => {
            const relatedCase = caseMap.get(payout.sales_case_id) ?? null;
            const relatedProject = relatedCase?.project_id ? projectMap.get(relatedCase.project_id) ?? null : null;
            const projectName = relatedProject?.project_name || "-";
            const unitLabel = relatedCase?.unit_number || "-";
            return `${projectName} Unit ${unitLabel}`;
          })
        )
      );

      const fallbackAmount = groupedPayouts.reduce((sum, payout) => sum + Number(payout.total_amount ?? 0), 0);
      const grossAmount = voucherUrl
        ? voucherGrossAmountMap.get(voucherUrl) ?? fallbackAmount
        : fallbackAmount;

      const generatedAt = groupedPayouts.reduce((latest, payout) => {
        const candidate = payout.paid_at || payout.created_at;
        if (!latest) {
          return candidate;
        }

        return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
      }, "");

      return {
        id: voucherUrl || voucherKey,
        amount: grossAmount,
        voucherUrl,
        generatedAt,
        details: detailLabels.join("; "),
      };
    });
  }, [caseMap, payouts, projectMap, voucherEntries, voucherGrossAmountMap]);

  const filteredRows = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    const normalizedDetails = normalizeText(detailsSearch);

    return ownVoucherRows.filter((row) => {
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

      if (normalizedDetails && !normalizeText(row.details).includes(normalizedDetails)) {
        return false;
      }

      return true;
    });
  }, [dateFrom, dateTo, detailsSearch, ownVoucherRows]);

  const totalAmount = filteredRows.reduce((sum, row) => sum + row.amount, 0);

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

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">My Payment Voucher</h2>
        <p className="mt-1 text-sm text-gray-500">
          This page shows your own generated payment vouchers.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Payment Voucher</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{filteredRows.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Amount</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">RM {formatAmount(totalAmount)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="text-sm font-semibold text-gray-800">Payment Voucher History</div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              value={detailsSearch}
              onChange={(event) => setDetailsSearch(event.target.value)}
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
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Amount (RM)</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Loading vouchers...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    No payment voucher found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-700">{formatDate(row.generatedAt)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.voucherUrl ? (
                        <button
                          type="button"
                          onClick={() => void handleDownloadVoucher(row.voucherUrl)}
                          className="inline-flex items-center rounded-md border border-primary/25 px-2 py-1 text-xs text-primary hover:bg-primary/5"
                        >
                          Download PDF
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatAmount(row.amount)}</td>
                    <td className="px-4 py-3 text-gray-700">{row.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
