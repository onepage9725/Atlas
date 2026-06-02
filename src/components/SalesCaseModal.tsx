import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Save, Trash2, Upload, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  createCaseNotifications,
  getNotificationProfileLabel,
  notifyCaseAudience,
} from "../lib/notifications";
import {
  getDefaultProjectCommissionStructure,
  getCaseCommissionStructure,
  getCommissionStructureLabel,
  type CommissionStructure,
} from "../lib/commissionStructures";

export type ProjectOption = {
  id: string;
  project_name: string | null;
  company_commission: number | null;
  agent_commission: number | null;
  pre_leader_override: number | null;
  leader_override: number | null;
  commission_structures: CommissionStructure[] | null;
  default_commission_structure_id: string | null;
};

export const CREATOR_CASE_STATUS_OPTIONS = ["Pending", "Signed LO", "Cancel"] as const;
export const ADMIN_CASE_STATUS_OPTIONS = ["Claimable", "Approve", "Paid", "Reject"] as const;
export const DISPLAY_ONLY_CASE_STATUS_OPTIONS = ["Completed"] as const;
export const ALL_CASE_STATUS_OPTIONS = [
  ...CREATOR_CASE_STATUS_OPTIONS,
  ...ADMIN_CASE_STATUS_OPTIONS,
  ...DISPLAY_ONLY_CASE_STATUS_OPTIONS,
] as const;
export const MANAGE_CASE_STATUS_OPTIONS = [
  ...CREATOR_CASE_STATUS_OPTIONS,
  "Claimable",
  "Reject",
] as const;
export const REVIEW_CASE_STATUSES = ["Claimable"] as const;

export type SalesCaseStatus =
  | (typeof CREATOR_CASE_STATUS_OPTIONS)[number]
  | (typeof ADMIN_CASE_STATUS_OPTIONS)[number]
  | (typeof DISPLAY_ONLY_CASE_STATUS_OPTIONS)[number];

export const normalizeCaseStatus = (status: string | null | undefined): SalesCaseStatus => {
  const validStatuses = new Set<string>([
    ...CREATOR_CASE_STATUS_OPTIONS,
    ...ADMIN_CASE_STATUS_OPTIONS,
    ...DISPLAY_ONLY_CASE_STATUS_OPTIONS,
  ]);

  return validStatuses.has(status ?? "") ? (status as SalesCaseStatus) : "Pending";
};

export const getCaseStatusClasses = (status: string | null | undefined) => {
  switch (normalizeCaseStatus(status)) {
    case "Signed LO":
      return "bg-blue-50 text-blue-700 border-blue-100";
    case "Claimable":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "Approve":
      return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "Paid":
      return "bg-green-50 text-green-700 border-green-100";
    case "Completed":
      return "bg-green-50 text-green-700 border-green-100";
    case "Reject":
      return "bg-violet-50 text-violet-700 border-violet-100";
    case "Cancel":
      return "bg-red-50 text-red-700 border-red-100";
    default:
      return "bg-slate-50 text-slate-700 border-slate-100";
  }
};

export const hasCaseWorkflowColumns = (
  record: Partial<SalesCaseRecord> | null | undefined
) => Boolean(record && ("status" in record || "lo_draft_url" in record));

export const isCaseLockedForEditing = (status: string | null | undefined) => {
  const normalizedStatus = normalizeCaseStatus(status);
  return normalizedStatus === "Approve" || normalizedStatus === "Paid";
};

type StatusSelectProps = {
  value: SalesCaseStatus;
  options: readonly SalesCaseStatus[];
  onChange: (status: SalesCaseStatus) => void;
};

function StatusSelect({ value, options, onChange }: StatusSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedStatus = normalizeCaseStatus(value);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-medium shadow-sm transition focus:outline-none focus:ring-1 focus:ring-primary ${getCaseStatusClasses(selectedStatus)}`}
      >
        <span>{selectedStatus}</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Case Status"
          className="absolute z-20 mt-2 w-full space-y-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
        >
          {options.map((statusOption) => {
            const isSelected = statusOption === selectedStatus;

            return (
              <button
                key={statusOption}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(statusOption);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium transition hover:opacity-90 ${getCaseStatusClasses(statusOption)}`}
              >
                <span>{statusOption}</span>
                {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ProfileOption = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  rank: string | null;
  recruit_by: string | null;
};

type CommissionRow = {
  id: string;
  profileId: string;
  label: string;
  rank: string;
  percentage: number;
  amount: number;
  type: "agent" | "pre_leader" | "leader";
};

export type SalesCasePayoutStatus = "Pending" | "Approve" | "Reject" | "Paid";

export type SalesCasePayoutType = "standard" | "tier_upgrade_top_up";

export type SalesCasePayoutRecord = {
  id: string;
  sales_case_id: string;
  profile_id: string;
  payout_type: SalesCasePayoutType;
  source_commission_structure_id: string | null;
  source_commission_structure_label: string | null;
  target_commission_structure_id: string | null;
  target_commission_structure_label: string | null;
  agent_commission_percentage: number;
  pre_leader_override_percentage: number;
  leader_override_percentage: number;
  total_amount: number;
  payout_status: SalesCasePayoutStatus;
  payment_receipt_url: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
};

export type SalesCaseRecord = {
  id: string;
  project_id: string | null;
  booking_date: string | null;
  spa_price: number | null;
  nett_price: number | null;
  booking_fee: number | null;
  unit_number: string | null;
  customer_name: string | null;
  customer_id: string | null;
  customer_contact_number: string | null;
  customer_email: string | null;
  race: string | null;
  buyer_type: string | null;
  booking_form_url: string | null;
  lo_draft_url: string | null;
  commission_structure: CommissionStructure | null;
  status: SalesCaseStatus | null;
  created_by: string | null;
  involved_profile_id: string | null;
  involved_user_ids: string[] | null;
  delete_requested: boolean | null;
  delete_requested_by: string | null;
  delete_requested_at: string | null;
  edited_at: string | null;
  edited_by: string | null;
  edit_reviewed_at: string | null;
  edit_reviewed_by: string | null;
  commission_review_sent_at: string | null;
  commission_review_sent_by: string | null;
  created_at: string;
};

type SalesCaseModalProps = {
  userId: string;
  projects: ProjectOption[];
  initialCase: SalesCaseRecord | null;
  readOnly?: boolean;
  allowCaseOwnerSelection?: boolean;
  enableWorkflowFields?: boolean;
  allowStatusEdit?: boolean;
  allowLoDraftUpload?: boolean;
  statusOptions?: readonly SalesCaseStatus[];
  paidReceiptRows?: Array<{
    id: string;
    memberLabel: string;
    receiptUrl: string;
    paidAt: string | null;
  }>;
  onDelete?: () => void;
  onClose: () => void;
  onSaved: () => void;
};

const getStoredInvolvedProfileId = (record: SalesCaseRecord | null) => {
  if (!record) {
    return "";
  }

  if (record.involved_profile_id) {
    return record.involved_profile_id;
  }

  const legacyInvolvedIds = (record.involved_user_ids ?? []).filter(
    (profileId) => profileId !== record.created_by
  );

  return legacyInvolvedIds.length === 1 ? legacyInvolvedIds[0] : "";
};

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const createEmptyForm = () => ({
  caseOwnerId: "",
  bookingDate: getTodayDate(),
  projectId: "",
  involvedUserId: "",
  spaPrice: "",
  nettPrice: "",
  bookingFee: "",
  unitNumber: "",
  customerName: "",
  customerId: "",
  customerContactNumber: "",
  customerEmail: "",
  race: "Malay",
  raceOther: "",
  buyerType: "Loan",
  bookingFormName: "",
  status: "Pending" as SalesCaseStatus,
  loDraftName: "",
});

const formatNumberInput = (value: number | null) => (value === null ? "" : value.toString());

function toNumberOrNull(value: string) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function SalesCaseModal({
  userId,
  projects,
  initialCase,
  readOnly = false,
  allowCaseOwnerSelection = false,
  enableWorkflowFields = true,
  allowStatusEdit = true,
  allowLoDraftUpload = true,
  statusOptions = CREATOR_CASE_STATUS_OPTIONS,
  paidReceiptRows = [],
  onDelete,
  onClose,
  onSaved,
}: SalesCaseModalProps) {
  const [formData, setFormData] = useState(createEmptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingFormFile, setBookingFormFile] = useState<File | null>(null);
  const [loDraftFile, setLoDraftFile] = useState<File | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);

  const isEditing = Boolean(initialCase);
  const isReadOnly = readOnly && isEditing;
  const showWorkflowFields = enableWorkflowFields && isEditing;
  const currentStatus = normalizeCaseStatus(initialCase?.status);

  useEffect(() => {
    const fetchProfiles = async () => {
      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("id, name, email, role, rank, recruit_by")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setProfiles((data as ProfileOption[]) ?? []);
    };

    fetchProfiles();
  }, []);

  const profilesById = useMemo(() => {
    const map = new Map<string, ProfileOption>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  useEffect(() => {
    if (!initialCase) {
      setFormData(createEmptyForm());
      setBookingFormFile(null);
      setLoDraftFile(null);
      return;
    }

    const raceValue = initialCase.race ?? "Malay";
    const isOtherRace =
      raceValue !== "Malay" && raceValue !== "Chinese" && raceValue !== "Indian";

    setFormData({
      caseOwnerId: initialCase.created_by ?? "",
      bookingDate: initialCase.booking_date ?? "",
      projectId: initialCase.project_id ?? "",
      involvedUserId: getStoredInvolvedProfileId(initialCase),
      spaPrice: formatNumberInput(initialCase.spa_price),
      nettPrice: formatNumberInput(initialCase.nett_price),
      bookingFee: formatNumberInput(initialCase.booking_fee),
      unitNumber: initialCase.unit_number ?? "",
      customerName: initialCase.customer_name ?? "",
      customerId: initialCase.customer_id ?? "",
      customerContactNumber: initialCase.customer_contact_number ?? "",
      customerEmail: initialCase.customer_email ?? "",
      race: isOtherRace ? "Other" : raceValue,
      raceOther: isOtherRace ? raceValue : "",
      buyerType: initialCase.buyer_type ?? "Loan",
      bookingFormName: initialCase.booking_form_url
        ? initialCase.booking_form_url.split("/").pop() ?? ""
        : "",
      status: normalizeCaseStatus(initialCase.status),
      loDraftName: initialCase.lo_draft_url
        ? initialCase.lo_draft_url.split("/").pop() ?? ""
        : "",
    });
    setBookingFormFile(null);
    setLoDraftFile(null);
  }, [initialCase]);

  const caseOwnerId = initialCase?.created_by ?? (allowCaseOwnerSelection ? formData.caseOwnerId : userId);
  const creatorProfile = caseOwnerId ? profilesById.get(caseOwnerId) ?? null : null;
  const selectedProject = projects.find((project) => project.id === formData.projectId) ?? null;
  const selectedCommissionStructure = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    return initialCase
      ? getCaseCommissionStructure(initialCase, selectedProject)
      : getDefaultProjectCommissionStructure(selectedProject);
  }, [initialCase, selectedProject]);
  const selectedInvolvedProfile = formData.involvedUserId
    ? profilesById.get(formData.involvedUserId) ?? null
    : null;
  const caseOwnerOptions = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.role !== "admin" &&
          profile.role !== "super_admin"
      ),
    [profiles]
  );
  const involvedOptions = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.id !== caseOwnerId &&
          profile.role !== "admin"
      ),
    [caseOwnerId, profiles]
  );

  const getProfileLabel = (profile: ProfileOption | null) =>
    profile?.name || profile?.email || "-";

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

    const recruiter = profile.recruit_by ? profilesById.get(profile.recruit_by) ?? null : null;
    if (!recruiter) {
      return { preLeader: null, leader: null };
    }

    if (recruiter.rank === "leader") {
      return { preLeader: null, leader: recruiter };
    }

    if (recruiter.rank === "pre_leader") {
      const leader = recruiter.recruit_by ? profilesById.get(recruiter.recruit_by) ?? null : null;
      return { preLeader: recruiter, leader };
    }

    if (recruiter.rank === "agent") {
      return getLeaderChain(recruiter, nextVisitedIds);
    }

    return { preLeader: null, leader: null };
  };

  const commissionRows = useMemo(() => {
    if (!selectedProject || !selectedCommissionStructure) {
      return [] as CommissionRow[];
    }

    const nettPrice = toNumberOrNull(formData.nettPrice) ?? 0;
    const participants = [creatorProfile, selectedInvolvedProfile].filter(
      (profile, index, array): profile is ProfileOption =>
        Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index
    );

    if (participants.length === 0) {
      return [] as CommissionRow[];
    }

    const splitAgentPercentage = (selectedCommissionStructure.agent_commission ?? 0) / participants.length;
    const splitPreLeaderPercentage =
      (selectedCommissionStructure.pre_leader_override ?? 0) / participants.length;
    const splitLeaderPercentage = (selectedCommissionStructure.leader_override ?? 0) / participants.length;

    const rowsByKey = new Map<string, CommissionRow>();

    const appendRow = (
      profile: ProfileOption | null,
      type: CommissionRow["type"],
      percentage: number
    ) => {
      if (!profile || percentage === 0) {
        return;
      }

      const key = `${profile.id}-${type}`;
      const existing = rowsByKey.get(key);
      const nextPercentage = (existing?.percentage ?? 0) + percentage;

      rowsByKey.set(key, {
        id: key,
        profileId: profile.id,
        label: getProfileLabel(profile),
        rank: profile.rank || "member",
        percentage: nextPercentage,
        amount: nettPrice * (nextPercentage / 100),
        type,
      });
    };

    participants.forEach((participant) => {
      appendRow(participant, "agent", splitAgentPercentage);

      const chain = getLeaderChain(participant);

      if (participant.rank === "agent") {
        if (chain.preLeader) {
          appendRow(chain.preLeader, "pre_leader", splitPreLeaderPercentage);
        } else {
          appendRow(chain.leader, "pre_leader", splitPreLeaderPercentage);
        }
        appendRow(chain.leader, "leader", splitLeaderPercentage);
        return;
      }

      if (participant.rank === "pre_leader") {
        appendRow(participant, "pre_leader", splitPreLeaderPercentage);
        appendRow(chain.leader, "leader", splitLeaderPercentage);
        return;
      }

      if (participant.rank === "leader") {
        appendRow(participant, "pre_leader", splitPreLeaderPercentage);
        appendRow(participant, "leader", splitLeaderPercentage);
      }
    });

    return Array.from(rowsByKey.values());
  }, [creatorProfile, selectedCommissionStructure, selectedInvolvedProfile, selectedProject, formData.nettPrice]);

  const commissionTypeLabel = {
    agent: "Agent Commission",
    pre_leader: "Pre Leader Override",
    leader: "Leader Override",
  } as const;

  const formatCommissionAmount = (value: number) =>
    `RM ${value.toLocaleString("en-MY", {
      minimumFractionDigits: Math.round(value) === value ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;

  const formatCommissionPercentage = (value: number) =>
    Number(value.toFixed(3)).toLocaleString("en-MY", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });

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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleBookingFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setBookingFormFile(file);
    setFormData((prev) => ({ ...prev, bookingFormName: file ? file.name : "" }));
  };

  const handleLoDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setLoDraftFile(file);
    setFormData((prev) => ({ ...prev, loDraftName: file ? file.name : prev.loDraftName }));
  };

  const getStoragePathFromUrl = (url: string, bucket: string) => {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  };

  const deleteBookingFormFromStorage = async (url: string | null) => {
    if (!url) return;
    const path = getStoragePathFromUrl(url, "cases");
    if (!path) return;
    await supabase.storage.from("cases").remove([path]);
  };

  const uploadBookingForm = async () => {
    if (!bookingFormFile) return initialCase?.booking_form_url ?? null;
    const filePath = `${userId}/${Date.now()}-${sanitizeFileName(bookingFormFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, bookingFormFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const uploadLoDraft = async () => {
    if (!enableWorkflowFields) return null;
    if (!loDraftFile) return initialCase?.lo_draft_url ?? null;
    const filePath = `${userId}/${Date.now()}-${sanitizeFileName(loDraftFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, loDraftFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isReadOnly) {
      return;
    }

    setError(null);

    if (!userId) {
      setError("Missing user session.");
      return;
    }

    if (!formData.projectId) {
      setError("Please select a project.");
      return;
    }

    if (!formData.bookingDate) {
      setError("Please select the booking date.");
      return;
    }

    if (!isEditing && allowCaseOwnerSelection && !formData.caseOwnerId) {
      setError("Please select the case agent before proceeding.");
      return;
    }

    if (formData.race === "Other" && !formData.raceOther.trim()) {
      setError("Please specify the race.");
      return;
    }

    if (!isEditing && !bookingFormFile) {
      setError("Please attach the booking form PDF.");
      return;
    }

    setIsSubmitting(true);

    try {
      const bookingFormUrl = await uploadBookingForm();
      const loDraftUrl = await uploadLoDraft();
      const nextStatus = enableWorkflowFields && isEditing ? formData.status : "Pending";
      const nextCommissionStructure = selectedCommissionStructure;

      if (!nextCommissionStructure) {
        setError("Unable to determine the commission structure for this case.");
        setIsSubmitting(false);
        return;
      }

      if (enableWorkflowFields && nextStatus === "Signed LO" && !loDraftUrl) {
        setError("Please upload the LO Draft before changing the status to Signed LO.");
        setIsSubmitting(false);
        return;
      }

      const involvedIds = Array.from(
        new Set(
          [
            caseOwnerId,
            formData.involvedUserId || null,
            ...commissionRows.map((row) => row.profileId),
          ].filter(Boolean)
        )
      ) as string[];

      const payload: {
        project_id: string;
        booking_date: string;
        spa_price: number | null;
        nett_price: number | null;
        booking_fee: number | null;
        unit_number: string;
        customer_name: string;
        customer_id: string;
        customer_contact_number: string;
        customer_email: string;
        race: string;
        buyer_type: string;
        booking_form_url: string | null;
        commission_structure: CommissionStructure;
        lo_draft_url?: string | null;
        status?: SalesCaseStatus;
        created_by: string;
        involved_profile_id: string | null;
        involved_user_ids: string[];
        edited_at?: string | null;
        edited_by?: string | null;
        edit_reviewed_at?: string | null;
        edit_reviewed_by?: string | null;
      } = {
        project_id: formData.projectId,
        booking_date: formData.bookingDate,
        spa_price: toNumberOrNull(formData.spaPrice),
        nett_price: toNumberOrNull(formData.nettPrice),
        booking_fee: toNumberOrNull(formData.bookingFee),
        unit_number: formData.unitNumber,
        customer_name: formData.customerName,
        customer_id: formData.customerId,
        customer_contact_number: formData.customerContactNumber,
        customer_email: formData.customerEmail,
        race: formData.race === "Other" ? formData.raceOther : formData.race,
        buyer_type: formData.buyerType,
        booking_form_url: bookingFormUrl,
        commission_structure: nextCommissionStructure,
        created_by: caseOwnerId,
        involved_profile_id: formData.involvedUserId || null,
        involved_user_ids: involvedIds,
      };

      if (enableWorkflowFields) {
        payload.lo_draft_url = loDraftUrl;
        payload.status = nextStatus;
      }

      if (isEditing && initialCase) {
        const previousStatus = normalizeCaseStatus(initialCase.status);
        payload.edited_at = new Date().toISOString();
        payload.edited_by = userId;
        payload.edit_reviewed_at = null;
        payload.edit_reviewed_by = null;

        const { error: updateError } = await supabase
          .from("sales_cases")
          .update(payload)
          .eq("id", initialCase.id);

        if (updateError) {
          setError(updateError.message);
          setIsSubmitting(false);
          return;
        }

        if (bookingFormFile && initialCase.booking_form_url) {
          await deleteBookingFormFromStorage(initialCase.booking_form_url);
        }

        if (enableWorkflowFields && loDraftFile && initialCase.lo_draft_url) {
          await deleteBookingFormFromStorage(initialCase.lo_draft_url);
        }

        try {
          const actorLabel = getNotificationProfileLabel(userId, profiles);
          const isCancelling = nextStatus === "Cancel" && previousStatus !== "Cancel";
          const hasNewLoDraft = enableWorkflowFields && Boolean(loDraftFile);
          const amountLabel = formatCommissionAmount(toNumberOrNull(formData.spaPrice) ?? 0);
          const title = isCancelling
            ? "Sales case cancelled"
            : hasNewLoDraft
              ? "Signed LO draft uploaded"
              : "Sales case updated";
          const message = isCancelling
            ? `${actorLabel} cancelled the sales case for ${selectedProject?.project_name || "Unnamed project"}, ${formData.unitNumber ? `Unit ${formData.unitNumber}` : "Unit -"}, SPA ${amountLabel}.`
            : hasNewLoDraft
              ? `${actorLabel} uploaded a signed LO draft for ${selectedProject?.project_name || "Unnamed project"}, ${formData.unitNumber ? `Unit ${formData.unitNumber}` : "Unit -"}, SPA ${amountLabel}.`
              : `${actorLabel} updated the sales case for ${selectedProject?.project_name || "Unnamed project"}, ${formData.unitNumber ? `Unit ${formData.unitNumber}` : "Unit -"}, SPA ${amountLabel}.`;

          await notifyCaseAudience({
            actorUserId: userId,
            salesCaseId: initialCase.id,
            caseOwnerId,
            involvedProfileId: formData.involvedUserId || null,
            title,
            message,
            profiles,
            commissionRows: commissionRows.map((row) => ({ profileId: row.profileId, type: row.type })),
          });
        } catch (notificationError) {
          console.error("Failed to create notifications for updated sales case", notificationError);
        }
      } else {
        const { data: insertedCase, error: submitError } = await supabase
          .from("sales_cases")
          .insert([payload])
          .select("id")
          .single();

        if (submitError) {
          setError(submitError.message);
          setIsSubmitting(false);
          return;
        }

        try {
          await createCaseNotifications({
            actorUserId: userId,
            salesCaseId: insertedCase.id,
            caseOwnerId,
            involvedProfileId: formData.involvedUserId || null,
            projectName: selectedProject?.project_name ?? null,
            unitNumber: formData.unitNumber || null,
            spaPrice: toNumberOrNull(formData.spaPrice),
            profiles,
            commissionRows: commissionRows.map((row) => ({ profileId: row.profileId, type: row.type })),
          });
        } catch (notificationError) {
          console.error("Failed to create notifications for new sales case", notificationError);
        }
      }

      setIsSubmitting(false);
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {isReadOnly ? "View Sales Case" : isEditing ? "Edit Sales Case" : "New Sales Case"}
            </h3>
            <p className="text-xs text-gray-500">
              {isReadOnly
                ? "Review the case details below."
                : isEditing
                  ? "Update the case details."
                  : "Fill in the case details below."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 px-6 py-5">
          <fieldset disabled={isReadOnly} className="space-y-6 disabled:opacity-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isEditing && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Case Agent
                </label>
                <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
                  {getProfileLabel(creatorProfile)}
                </div>
              </div>
            )}
            {!isEditing && allowCaseOwnerSelection && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Case Agent
                </label>
                <select
                  name="caseOwnerId"
                  value={formData.caseOwnerId}
                  onChange={handleChange}
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                  required
                >
                  <option value="" disabled>
                    Select member
                  </option>
                  {caseOwnerOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {getProfileLabel(profile)}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-gray-500">
                  Choose the member who owns this case before filling in the rest of the form.
                </p>
              </div>
            )}
            {showWorkflowFields && (
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Case Status</label>
                  {allowStatusEdit ? (
                    <StatusSelect
                      value={formData.status}
                      options={statusOptions}
                      onChange={(status) => setFormData((prev) => ({ ...prev, status }))}
                    />
                  ) : (
                    <div
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${getCaseStatusClasses(currentStatus)}`}
                    >
                      {currentStatus}
                    </div>
                  )}
                  {allowStatusEdit && (
                    <p className="mt-2 text-xs text-gray-500">
                      Upload the LO Draft before setting the case to Signed LO.
                    </p>
                  )}
                </div>

                {(allowLoDraftUpload || initialCase?.lo_draft_url || isReadOnly) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">LO Draft (PDF)</label>
                    {allowLoDraftUpload ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                          <Upload className="w-4 h-4 text-gray-500" />
                          Upload LO Draft
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={handleLoDraftChange}
                            className="hidden"
                          />
                        </label>
                        <span className="text-xs text-gray-500">
                          {loDraftFile?.name || formData.loDraftName || "No file selected"}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
                        {initialCase?.lo_draft_url ? (
                          <a
                            href={initialCase.lo_draft_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            View LO Draft
                          </a>
                        ) : (
                          "-"
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Booking Date</label>
              <input
                type="date"
                name="bookingDate"
                value={formData.bookingDate}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select
                name="projectId"
                value={formData.projectId}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                required
              >
                <option value="" disabled>
                  Select project
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_name || "Untitled project"}
                  </option>
                ))}
              </select>
            </div>
            {selectedProject && selectedCommissionStructure && (
              <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <span className="font-medium text-gray-800">Commission Structure:</span>{" "}
                {getCommissionStructureLabel(selectedCommissionStructure)}
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sales Person Involve
              </label>
              <select
                name="involvedUserId"
                value={formData.involvedUserId}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
              >
                <option value="">None</option>
                {involvedOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {getProfileLabel(profile)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SPA Price (RM)</label>
              <input
                type="number"
                name="spaPrice"
                value={formData.spaPrice}
                onChange={handleChange}
                inputMode="decimal"
                min="0"
                step="0.01"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nett Price (RM)</label>
              <input
                type="number"
                name="nettPrice"
                value={formData.nettPrice}
                onChange={handleChange}
                inputMode="decimal"
                min="0"
                step="0.01"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Booking Fee (RM)</label>
              <input
                type="number"
                name="bookingFee"
                value={formData.bookingFee}
                onChange={handleChange}
                inputMode="decimal"
                min="0"
                step="0.01"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit Number</label>
              <input
                type="text"
                name="unitNumber"
                value={formData.unitNumber}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
              <input
                type="text"
                name="customerName"
                value={formData.customerName}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer IC / Passport</label>
              <input
                type="text"
                name="customerId"
                value={formData.customerId}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Contact Number
              </label>
              <input
                type="tel"
                name="customerContactNumber"
                value={formData.customerContactNumber}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Email</label>
              <input
                type="email"
                name="customerEmail"
                value={formData.customerEmail}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Race</label>
              <select
                name="race"
                value={formData.race}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
              >
                {["Malay", "Chinese", "Indian", "Other"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {formData.race === "Other" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Other Race</label>
                <input
                  type="text"
                  name="raceOther"
                  value={formData.raceOther}
                  onChange={handleChange}
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Buyer Type</label>
              <select
                name="buyerType"
                value={formData.buyerType}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
              >
                {["Loan", "Cash"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attach Booking Form (PDF)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                  <Upload className="w-4 h-4 text-gray-500" />
                  Upload PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleBookingFormChange}
                    className="hidden"
                  />
                </label>
                <span className="text-xs text-gray-500">
                  {formData.bookingFormName || "No file selected"}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Combine booking form, IC/passport, and booking receipt in one PDF.
              </p>
            </div>
          </div>

          {selectedProject && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-gray-800">Commission Breakdown</h4>
                <p className="text-xs text-gray-500 mt-1">
                  Based on nett price and split equally across the eligible members in each rank.
                </p>
                {selectedCommissionStructure && (
                  <p className="text-xs text-gray-500 mt-1">
                    Selected structure: {getCommissionStructureLabel(selectedCommissionStructure)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {commissionRows.length > 0 ? (
                  commissionRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100 text-sm"
                    >
                      <div>
                        <div className="font-medium text-gray-800">{row.label}</div>
                        <div className="text-xs text-gray-500">
                          {commissionTypeLabel[row.type]} • {row.rank.replace("_", " ")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-800">
                          {formatCommissionPercentage(row.percentage)}%
                        </div>
                        <div className="text-xs text-gray-500">{formatCommissionAmount(row.amount)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg bg-white px-3 py-2 border border-gray-100 text-sm text-gray-500">
                    No member commission applies yet. Select a project and involved salesperson.
                  </div>
                )}
              </div>

              {paidReceiptRows.length > 0 && (
                <div className="border-t border-gray-200 pt-5">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">Payout Receipts</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      Admin and super admin can review and download any receipt that has already been uploaded after the payout is marked as paid.
                    </p>
                  </div>

                  <div className="mt-4 space-y-2">
                    {paidReceiptRows.map((receiptRow) => (
                      <div
                        key={receiptRow.id}
                        className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100 text-sm"
                      >
                        <div>
                          <div className="font-medium text-gray-800">{receiptRow.memberLabel}</div>
                          <div className="text-xs text-gray-500">
                            {receiptRow.paidAt ? new Date(receiptRow.paidAt).toLocaleDateString() : "Paid receipt"}
                          </div>
                        </div>
                        <a
                          href={receiptRow.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          Download Receipt
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          </fieldset>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              {isReadOnly ? "Close" : "Cancel"}
            </button>
            {!isReadOnly && isEditing && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            {!isReadOnly && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Save Case"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
