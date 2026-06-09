import { useEffect, useMemo, useState } from "react";
import { buildPayoutRowsForCommissionStructure, type ComputedPayoutRow } from "../lib/salesCasePayouts";
import { fetchNotificationProfiles, getNotificationProfileLabel, notifyCaseAudience } from "../lib/notifications";
import { supabase } from "../lib/supabaseClient";
import { getCaseCommissionStructure } from "../lib/commissionStructures";
import {
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
  rank: string | null;
  recruit_by: string | null;
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

const getCompanyCommission = (record: SalesCaseRecord, project: ProjectOption | null) => {
  const commissionStructure = getCaseCommissionStructure(record, project);

  if (!project || !commissionStructure || record.nett_price === null) {
    return null;
  }

  return (record.nett_price * (commissionStructure.company_commission ?? 0)) / 100;
};

const getTotalPayout = (record: SalesCaseRecord, project: ProjectOption | null) => {
  const commissionStructure = getCaseCommissionStructure(record, project);

  if (!project || !commissionStructure || record.nett_price === null) {
    return null;
  }

  const totalPercentage =
    (commissionStructure.agent_commission ?? 0) +
    (commissionStructure.pre_leader_override ?? 0) +
    (commissionStructure.leader_override ?? 0);

  return (record.nett_price * totalPercentage) / 100;
};

export function CommReviewPage({ userId }: { userId: string }) {
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<SalesCaseRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRevertingId, setIsRevertingId] = useState<string | null>(null);
  const [isApprovingId, setIsApprovingId] = useState<string | null>(null);

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

  const fetchCases = async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("sales_cases")
      .select("*")
      .not("commission_review_sent_at", "is", null)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const rawCases = (data as SalesCaseRecord[]) ?? [];
    setCases(
      rawCases.filter((record) => normalizeCaseStatus(record.status) === "Claimable")
    );
  };

  const fetchProjects = async () => {
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

  const fetchProfiles = async () => {
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, name, email, rank, recruit_by")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setProfiles((data as ProfileOption[]) ?? []);
  };

  useEffect(() => {
    fetchCases();
    fetchProjects();
    fetchProfiles();
  }, []);

  const buildPayoutRows = (record: SalesCaseRecord, project: ProjectOption | null) => {
    const commissionStructure = getCaseCommissionStructure(record, project);

    if (!project) {
      return [] as ComputedPayoutRow[];
    }

    return buildPayoutRowsForCommissionStructure(record, commissionStructure, profileMap);
  };

  const handleRevert = async (record: SalesCaseRecord) => {
    setError(null);
    setSuccess(null);
    setIsRevertingId(record.id);

    const { data, error: updateError } = await supabase
      .from("sales_cases")
      .update({
        status: "Reject",
        commission_review_sent_at: null,
        commission_review_sent_by: null,
      })
      .eq("id", record.id)
      .eq("status", "Claimable")
      .select("id, status");

    if (updateError) {
      setError(updateError.message);
      setIsRevertingId(null);
      return;
    }

    if (!data || data.length === 0) {
      setError("Unable to revert this case. Please refresh and try again.");
      setIsRevertingId(null);
      return;
    }

    setSuccess("Case reverted to Reject.");
    await fetchCases();
    setIsRevertingId(null);
  };

  const handleApproved = async (record: SalesCaseRecord) => {
    setError(null);
    setSuccess(null);
    setIsApprovingId(record.id);

    const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
    const payoutRows = buildPayoutRows(record, project);

    if (payoutRows.length === 0) {
      setError("Unable to build payout rows for this case.");
      setIsApprovingId(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("sales_case_payouts")
      .delete()
      .eq("sales_case_id", record.id)
      .eq("payout_type", "standard");

    if (deleteError) {
      setError(deleteError.message);
      setIsApprovingId(null);
      return;
    }

    const payoutPayload: Omit<SalesCasePayoutRecord, "id" | "created_at">[] = payoutRows.map((row) => ({
      sales_case_id: record.id,
      profile_id: row.profileId,
      payout_type: "standard",
      source_commission_structure_id: null,
      source_commission_structure_label: null,
      target_commission_structure_id: null,
      target_commission_structure_label: null,
      agent_commission_percentage: row.agentCommissionPercentage,
      pre_leader_override_percentage: row.preLeaderOverridePercentage,
      leader_override_percentage: row.leaderOverridePercentage,
      total_amount: Number(row.totalAmount.toFixed(2)),
      payout_status: "Pending",
      payment_receipt_url: null,
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
      paid_at: null,
      paid_by: null,
    }));

    const { error: insertError } = await supabase
      .from("sales_case_payouts")
      .insert(payoutPayload);

    if (insertError) {
      setError(insertError.message);
      setIsApprovingId(null);
      return;
    }

    const { data, error: updateError } = await supabase
      .from("sales_cases")
      .update({
        status: "Approve",
        commission_review_sent_at: null,
        commission_review_sent_by: null,
      })
      .eq("id", record.id)
      .eq("status", "Claimable")
      .select("id, status");

    if (updateError) {
      setError(updateError.message);
      setIsApprovingId(null);
      return;
    }

    if (!data || data.length === 0) {
      setError("Unable to approve this case. Please refresh and try again.");
      setIsApprovingId(null);
      return;
    }

    try {
      const notificationProfiles = await fetchNotificationProfiles();
      const actorLabel = getNotificationProfileLabel(userId, notificationProfiles);

      await notifyCaseAudience({
        actorUserId: userId,
        salesCaseId: record.id,
        caseOwnerId: record.created_by ?? userId,
        involvedProfileId: record.involved_profile_id,
        title: "Sales case approved",
        message: `${actorLabel} approved the sales case for ${project?.project_name || "Unnamed project"}, ${record.unit_number ? `Unit ${record.unit_number}` : "Unit -"}, SPA RM ${formatAmount(record.spa_price)}.`,
        profiles: notificationProfiles,
        commissionRows: payoutRows.map((row) => ({ profileId: row.profileId })),
      });
    } catch (notificationError) {
      console.error("Failed to create approval notifications", notificationError);
    }

    setSuccess("Case approved and sent to Payout.");
    await fetchCases();
    setIsApprovingId(null);
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cases Approval</h2>
          <p className="text-gray-500 text-sm mt-1">
            Review claimable cases that have been sent for commission approval.
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

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2">Created Date</th>
                <th className="py-2">Booking Date</th>
                <th className="py-2">Project Unit</th>
                <th className="py-2">SPA Price (RM)</th>
                <th className="py-2">Nett Price (RM)</th>
                <th className="py-2">Booking Form</th>
                <th className="py-2">LO Draft</th>
                <th className="py-2">Company Comm (RM)</th>
                <th className="py-2">Total Payout (RM)</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((record) => {
                const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
                const createdAt = record.created_at ? new Date(record.created_at) : null;
                const bookingDate = record.booking_date ? new Date(record.booking_date) : null;
                const companyCommission = getCompanyCommission(record, project);
                const totalPayout = getTotalPayout(record, project);

                return (
                  <tr key={record.id} className="border-b border-gray-50">
                    <td className="py-3 text-gray-600">
                      {createdAt ? createdAt.toLocaleDateString() : "-"}
                    </td>
                    <td className="py-3 text-gray-600">
                      {bookingDate ? bookingDate.toLocaleDateString() : "-"}
                    </td>
                    <td className="py-3 text-gray-600">
                      <div className="font-medium text-gray-800">
                        {project?.project_name || "-"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {record.unit_number ? `Unit ${record.unit_number}` : "-"}
                      </div>
                    </td>
                    <td className="py-3 text-gray-600">{formatAmount(record.spa_price)}</td>
                    <td className="py-3 text-gray-600">{formatAmount(record.nett_price)}</td>
                    <td className="py-3 text-gray-600">
                      {record.booking_form_url ? (
                        <a
                          href={record.booking_form_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 text-gray-600">
                      {record.lo_draft_url ? (
                        <a
                          href={record.lo_draft_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 text-gray-600">{formatAmount(companyCommission)}</td>
                    <td className="py-3 text-gray-600">{formatAmount(totalPayout)}</td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCase(record);
                            setIsModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:text-gray-700"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevert(record)}
                          disabled={isRevertingId === record.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:text-red-700 disabled:opacity-60"
                        >
                          {isRevertingId === record.id ? "Reverting..." : "Revert"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproved(record)}
                          disabled={isApprovingId === record.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-green-200 text-green-700 hover:text-green-800 disabled:opacity-60"
                        >
                          {isApprovingId === record.id ? "Approving..." : "Approved"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {cases.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-gray-500">
                    No cases are waiting for commission review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && selectedCase && (
        <SalesCaseModal
          userId={selectedCase.created_by ?? ""}
          projects={projects}
          initialCase={selectedCase}
          readOnly
          enableWorkflowFields
          allowStatusEdit={false}
          allowLoDraftUpload={false}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedCase(null);
          }}
          onSaved={() => fetchCases()}
        />
      )}
    </div>
  );
}