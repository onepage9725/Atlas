import { useEffect, useMemo, useRef, useState } from "react";
import { Download, EyeOff, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { buildTierUpgradeTopUpStructure, buildPayoutRowsForCommissionStructure } from "../lib/salesCasePayouts";
import { supabase } from "../lib/supabaseClient";
import {
  getCaseCommissionStructure,
  getDefaultProjectCommissionStructure,
  getCommissionStructureLabel,
  getProjectCommissionStructures,
  getShortCommissionStructureLabel,
  type CommissionStructure,
} from "../lib/commissionStructures";
import type { SalesCasePayoutRecord, SalesCaseStatus } from "./SalesCaseModal";

const PROJECT_TYPE_OPTIONS = ["Residential", "Commercial", "Mixed Development", "Others"] as const;
const PROPERTY_CATEGORY_OPTIONS = ["Condo", "Landed", "SOHO", "Shop Office", "Others"] as const;

type ProjectRecord = {
  id: string;
  project_name: string;
  developer_name: string | null;
  description: string | null;
  project_type: string | null;
  property_category: string | null;
  is_hidden: boolean;
  location: string | null;
  state_area: string | null;
  total_units: number | null;
  bedroom_min: number | null;
  bedroom_max: number | null;
  bathroom_min: number | null;
  bathroom_max: number | null;
  price_min: number | null;
  price_max: number | null;
  size_min: number | null;
  size_max: number | null;
  tenure: string | null;
  bumi_allocation: string | null;
  company_commission: number | null;
  agent_commission: number | null;
  pre_leader_override: number | null;
  leader_override: number | null;
  commission_structures: CommissionStructure[] | null;
  default_commission_structure_id: string | null;
  launch_date: string | null;
  completion_date: string | null;
  status: string | null;
  cover_image_url: string | null;
  attachment_1_url: string | null;
  attachment_1_label: string | null;
  attachment_2_url: string | null;
  attachment_2_label: string | null;
  created_at: string;
};

type EligibleSalesCaseRecord = {
  id: string;
  project_id: string | null;
  status: SalesCaseStatus | null;
  created_by: string | null;
  involved_profile_id: string | null;
  involved_user_ids: string[] | null;
  nett_price: number | null;
  commission_structure: CommissionStructure | null;
};

type PayoutProfileRecord = {
  id: string;
  rank: string | null;
  recruit_by: string | null;
};

type ProjectsFormProps = {
  role: string | null;
  userId: string | null;
};

type CommissionStructureForm = {
  id: string;
  label: string;
  minUnits: string;
  maxUnits: string;
  totalCommission: string;
  companyCommission: string;
  agentCommission: string;
  preLeaderOverride: string;
  leaderOverride: string;
};

const createTierId = () => `tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createEmptyCommissionStructure = (index: number): CommissionStructureForm => ({
  id: createTierId(),
  label: `Tier ${index}`,
  minUnits: "",
  maxUnits: "",
  totalCommission: "",
  companyCommission: "",
  agentCommission: "",
  preLeaderOverride: "",
  leaderOverride: "",
});

const createEmptyForm = () => ({
  projectName: "",
  developerName: "",
  description: "",
  projectType: "Residential",
  projectTypeOther: "",
  propertyCategory: "Condo",
  propertyCategoryOther: "",
  location: "",
  stateArea: "",
  totalUnits: "",
  bedroomMin: "",
  bedroomMax: "",
  bathroomMin: "",
  bathroomMax: "",
  priceMin: "",
  priceMax: "",
  sizeMin: "",
  sizeMax: "",
  tenure: "Freehold",
  commissionStructures: [createEmptyCommissionStructure(1)],
  defaultCommissionStructureId: "",
  launchDate: "",
  completionDate: "",
  status: "Coming Soon",
  coverImageUrl: "",
  coverImageName: "",
  attachment1Url: "",
  attachment1Name: "",
  attachment2Url: "",
  attachment2Name: "",
});

const formatNumber = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Number(value.toFixed(2));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const formatCommissionPercentage = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Number(value.toFixed(3));
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
};

const formatEditableCommissionValue = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "";
  }

  return value.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
};

const getTierUnitsSummary = (minUnits: string, maxUnits: string) => {
  if (minUnits && maxUnits) {
    return `${minUnits} - ${maxUnits} units`;
  }

  if (minUnits) {
    return `${minUnits}+ units`;
  }

  if (maxUnits) {
    return `Up to ${maxUnits} units`;
  }

  return "All units";
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
};

const formatRange = (min: number | null, max: number | null) => {
  if (min === null && max === null) {
    return "-";
  }

  if (min !== null && max !== null) {
    return `${min} - ${max}`;
  }

  return `${min ?? max}`;
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

const getStoragePathFromUrl = (url: string | null, bucket: string) => {
  if (!url) return null;

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

export function ProjectsForm({ role, userId }: ProjectsFormProps) {
  const [formData, setFormData] = useState(createEmptyForm);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [attachment1File, setAttachment1File] = useState<File | null>(null);
  const [attachment2File, setAttachment2File] = useState<File | null>(null);
  const coverImageInputRef = useRef<HTMLInputElement | null>(null);
  const attachment1InputRef = useRef<HTMLInputElement | null>(null);
  const attachment2InputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const canManageProjects = role === "admin" || role === "super_admin";
  const canViewHiddenProjects = role === "super_admin";
  const projectCount = useMemo(() => projects.length, [projects]);

  const generateTierUpgradeTopUps = async (
    projectId: string,
    previousStructure: CommissionStructure,
    nextStructure: CommissionStructure,
  ) => {
    const topUpStructure = buildTierUpgradeTopUpStructure(previousStructure, nextStructure);

    if (!topUpStructure) {
      return { createdCount: 0, skippedCount: 0 };
    }

    const { data: caseData, error: caseError } = await supabase
      .from("sales_cases")
      .select(
        "id, project_id, status, created_by, involved_profile_id, involved_user_ids, nett_price, commission_structure"
      )
      .eq("project_id", projectId)
      .in("status", ["Approve", "Paid"]);

    if (caseError) {
      throw caseError;
    }

    const caseRecords = (caseData as EligibleSalesCaseRecord[]) ?? [];
    const caseIds = caseRecords.map((record) => record.id);

    const { data: priorTopUpData, error: priorTopUpError } = caseIds.length
      ? await supabase
          .from("sales_case_payouts")
          .select("sales_case_id")
          .eq("payout_type", "tier_upgrade_top_up")
          .eq("target_commission_structure_id", previousStructure.id)
          .in("sales_case_id", caseIds)
      : { data: [], error: null };

    if (priorTopUpError) {
      throw priorTopUpError;
    }

    const priorTopUpCaseIds = new Set(
      (((priorTopUpData as Array<Pick<SalesCasePayoutRecord, "sales_case_id">>) ?? [])).map((row) => row.sales_case_id),
    );

    const eligibleCases = caseRecords.filter((record) => {
      const caseStructure = getCaseCommissionStructure(record, null);
      return caseStructure?.id === previousStructure.id || priorTopUpCaseIds.has(record.id);
    });

    if (eligibleCases.length === 0) {
      return { createdCount: 0, skippedCount: 0 };
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, rank, recruit_by");

    if (profileError) {
      throw profileError;
    }

    const profilesById = new Map<string, PayoutProfileRecord>();
    ((profileData as PayoutProfileRecord[]) ?? []).forEach((profile) => {
      profilesById.set(profile.id, profile);
    });

    const eligibleCaseIds = eligibleCases.map((record) => record.id);
    const { data: existingTopUpData, error: existingTopUpError } = await supabase
      .from("sales_case_payouts")
      .select("sales_case_id, profile_id")
      .eq("payout_type", "tier_upgrade_top_up")
      .eq("source_commission_structure_id", previousStructure.id)
      .eq("target_commission_structure_id", nextStructure.id)
      .in("sales_case_id", eligibleCaseIds);

    if (existingTopUpError) {
      throw existingTopUpError;
    }

    const existingTopUpKeys = new Set(
      (((existingTopUpData as Array<Pick<SalesCasePayoutRecord, "sales_case_id" | "profile_id">>) ?? [])).map(
        (row) => `${row.sales_case_id}:${row.profile_id}`,
      ),
    );

    const sourceLabel =
      getShortCommissionStructureLabel(getCommissionStructureLabel(previousStructure)) ?? previousStructure.id;
    const targetLabel =
      getShortCommissionStructureLabel(getCommissionStructureLabel(nextStructure)) ?? nextStructure.id;

    const payoutPayload = eligibleCases.flatMap((record) =>
      buildPayoutRowsForCommissionStructure(record, topUpStructure, profilesById)
        .filter((row) => !existingTopUpKeys.has(`${record.id}:${row.profileId}`))
        .map((row) => ({
          sales_case_id: record.id,
          profile_id: row.profileId,
          payout_type: "tier_upgrade_top_up" as const,
          source_commission_structure_id: previousStructure.id,
          source_commission_structure_label: sourceLabel,
          target_commission_structure_id: nextStructure.id,
          target_commission_structure_label: targetLabel,
          agent_commission_percentage: Number(row.agentCommissionPercentage.toFixed(3)),
          pre_leader_override_percentage: Number(row.preLeaderOverridePercentage.toFixed(3)),
          leader_override_percentage: Number(row.leaderOverridePercentage.toFixed(3)),
          total_amount: Number(row.totalAmount.toFixed(2)),
          payout_status: "Pending" as const,
          payment_receipt_url: null,
          approved_at: null,
          approved_by: null,
          rejected_at: null,
          rejected_by: null,
          paid_at: null,
          paid_by: null,
        })),
    );

    if (payoutPayload.length === 0) {
      return { createdCount: 0, skippedCount: existingTopUpKeys.size };
    }

    const { error: insertError } = await supabase.from("sales_case_payouts").insert(payoutPayload);

    if (insertError) {
      throw insertError;
    }

    return {
      createdCount: payoutPayload.length,
      skippedCount: existingTopUpKeys.size,
    };
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCommissionStructureChange = (
    structureId: string,
    field: keyof CommissionStructureForm,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      commissionStructures: prev.commissionStructures.map((structure) =>
        structure.id === structureId ? { ...structure, [field]: value } : structure
      ),
    }));
  };

  useEffect(() => {
    setFormData((prev) => {
      const firstStructureId = prev.commissionStructures[0]?.id ?? "";

      if (!firstStructureId) {
        return prev.defaultCommissionStructureId ? { ...prev, defaultCommissionStructureId: "" } : prev;
      }

      if (
        prev.defaultCommissionStructureId &&
        prev.commissionStructures.some((structure) => structure.id === prev.defaultCommissionStructureId)
      ) {
        return prev;
      }

      return { ...prev, defaultCommissionStructureId: firstStructureId };
    });
  }, [formData.commissionStructures]);

  const handleCoverImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setCoverImageFile(file ?? null);
    setFormData((prev) => {
      if (!file) {
        return {
          ...prev,
          coverImageName: prev.coverImageUrl ? prev.coverImageName : "",
        };
      }

      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;

      return {
        ...prev,
        coverImageName: file.name,
        coverImageUrl: previewUrl,
      };
    });
  };

  const handleTierTotalCommissionChange = (structureId: string, value: string) => {
    if (value === "") {
      handleCommissionStructureChange(structureId, "totalCommission", "");
      setFormData((prev) => ({
        ...prev,
        commissionStructures: prev.commissionStructures.map((structure) =>
          structure.id === structureId
            ? {
                ...structure,
                totalCommission: "",
                companyCommission: "",
                agentCommission: "",
                preLeaderOverride: "",
                leaderOverride: "",
              }
            : structure
        ),
      }));
      return;
    }

    const total = Number(value);
    if (Number.isNaN(total)) {
      handleCommissionStructureChange(structureId, "totalCommission", value);
      return;
    }

    const normalizeNumber = (num: number) =>
      num.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");

    setFormData((prev) => ({
      ...prev,
      commissionStructures: prev.commissionStructures.map((structure) =>
        structure.id === structureId
          ? {
              ...structure,
              totalCommission: value,
              companyCommission: normalizeNumber(total * 0.3),
              agentCommission: normalizeNumber(total * 0.5),
              preLeaderOverride: normalizeNumber(total * 0.1),
              leaderOverride: normalizeNumber(total * 0.1),
            }
          : structure
      ),
    }));
  };

  const addCommissionStructure = () => {
    setFormData((prev) => ({
      ...prev,
      commissionStructures: [
        ...prev.commissionStructures,
        createEmptyCommissionStructure(prev.commissionStructures.length + 1),
      ],
    }));
  };

  const removeCommissionStructure = (structureId: string) => {
    setFormData((prev) => {
      if (prev.commissionStructures.length === 1) {
        return prev;
      }

      const nextCommissionStructures = prev.commissionStructures.filter((structure) => structure.id !== structureId);

      return {
        ...prev,
        commissionStructures: nextCommissionStructures,
        defaultCommissionStructureId:
          prev.defaultCommissionStructureId === structureId
            ? nextCommissionStructures[0]?.id ?? ""
            : prev.defaultCommissionStructureId,
      };
    });
  };

  const handleAttachmentChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    attachmentKey: "attachment1" | "attachment2",
  ) => {
    const file = event.target.files?.[0] ?? null;

    if (attachmentKey === "attachment1") {
      setAttachment1File(file);
      setFormData((prev) => ({
        ...prev,
        attachment1Name: file?.name ?? (prev.attachment1Url ? prev.attachment1Name : ""),
      }));
      return;
    }

    setAttachment2File(file);
    setFormData((prev) => ({
      ...prev,
      attachment2Name: file?.name ?? (prev.attachment2Url ? prev.attachment2Name : ""),
    }));
  };

  const clearPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  const resetForm = () => {
    clearPreview();
    setFormData(createEmptyForm());
    setEditingId(null);
    setCoverImageFile(null);
    setAttachment1File(null);
    setAttachment2File(null);
    if (coverImageInputRef.current) {
      coverImageInputRef.current.value = "";
    }
    if (attachment1InputRef.current) {
      attachment1InputRef.current.value = "";
    }
    if (attachment2InputRef.current) {
      attachment2InputRef.current.value = "";
    }
  };

  const closeProjectModal = () => {
    setShowProjectModal(false);
    resetForm();
  };

  const openNewProjectModal = () => {
    if (!canManageProjects) {
      return;
    }

    setError(null);
    resetForm();
    setShowProjectModal(true);
  };

  const toNumberOrNull = (value: string) => {
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const toIntOrNull = (value: string) => {
    if (value === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const mapRecordToForm = (project: ProjectRecord) => {
    const commissionStructures = getProjectCommissionStructures(project);

    setFormData({
      projectName: project.project_name ?? "",
      developerName: project.developer_name ?? "",
      description: project.description ?? "",
      projectType:
        project.project_type && PROJECT_TYPE_OPTIONS.includes(project.project_type as (typeof PROJECT_TYPE_OPTIONS)[number])
          ? project.project_type
          : "Others",
      projectTypeOther:
        project.project_type && PROJECT_TYPE_OPTIONS.includes(project.project_type as (typeof PROJECT_TYPE_OPTIONS)[number])
          ? ""
          : project.project_type ?? "",
      propertyCategory:
        project.property_category && PROPERTY_CATEGORY_OPTIONS.includes(project.property_category as (typeof PROPERTY_CATEGORY_OPTIONS)[number])
          ? project.property_category
          : "Others",
      propertyCategoryOther:
        project.property_category && PROPERTY_CATEGORY_OPTIONS.includes(project.property_category as (typeof PROPERTY_CATEGORY_OPTIONS)[number])
          ? ""
          : project.property_category ?? "",
      location: project.location ?? "",
      stateArea: project.state_area ?? "",
      totalUnits: project.total_units?.toString() ?? "",
      bedroomMin: project.bedroom_min?.toString() ?? "",
      bedroomMax: project.bedroom_max?.toString() ?? "",
      bathroomMin: project.bathroom_min?.toString() ?? "",
      bathroomMax: project.bathroom_max?.toString() ?? "",
      priceMin: project.price_min?.toString() ?? "",
      priceMax: project.price_max?.toString() ?? "",
      sizeMin: project.size_min?.toString() ?? "",
      sizeMax: project.size_max?.toString() ?? "",
      tenure: project.tenure ?? "Freehold",
      commissionStructures: commissionStructures.map((structure, index) => ({
        id: structure.id,
        label: structure.label ?? `Tier ${index + 1}`,
        minUnits: structure.min_units?.toString() ?? "",
        maxUnits: structure.max_units?.toString() ?? "",
        totalCommission: formatEditableCommissionValue(
          [
            structure.company_commission,
            structure.agent_commission,
            structure.pre_leader_override,
            structure.leader_override,
          ]
            .filter((value) => typeof value === "number")
            .reduce((sum, value) => sum + (value ?? 0), 0)
        ),
        companyCommission: formatEditableCommissionValue(structure.company_commission),
        agentCommission: formatEditableCommissionValue(structure.agent_commission),
        preLeaderOverride: formatEditableCommissionValue(structure.pre_leader_override),
        leaderOverride: formatEditableCommissionValue(structure.leader_override),
      })),
      defaultCommissionStructureId:
        project.default_commission_structure_id &&
        commissionStructures.some((structure) => structure.id === project.default_commission_structure_id)
          ? project.default_commission_structure_id
          : commissionStructures[0]?.id ?? "",
      launchDate: project.launch_date ?? "",
      completionDate: project.completion_date ?? "",
      status: project.status ?? "Coming Soon",
      coverImageUrl: project.cover_image_url ?? "",
      coverImageName: project.cover_image_url ? project.cover_image_url.split("/").pop() ?? "" : "",
      attachment1Url: project.attachment_1_url ?? "",
      attachment1Name: project.attachment_1_label ?? (project.attachment_1_url ? project.attachment_1_url.split("/").pop() ?? "" : ""),
      attachment2Url: project.attachment_2_url ?? "",
      attachment2Name: project.attachment_2_label ?? (project.attachment_2_url ? project.attachment_2_url.split("/").pop() ?? "" : ""),
    });
  };

  const fetchProjects = async () => {
    setError(null);
    let query = supabase.from("projects").select("*").order("created_at", { ascending: false });

    if (!canViewHiddenProjects) {
      query = query.eq("is_hidden", false);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setProjects((data as ProjectRecord[]) ?? []);
  };

  useEffect(() => {
    fetchProjects();
  }, [canViewHiddenProjects]);

  useEffect(() => {
    return () => {
      clearPreview();
    };
  }, []);

  const deleteCoverImageFromStorage = async (url: string | null) => {
    const path = getStoragePathFromUrl(url, "cases");
    if (!path) return;
    const { error: deleteError } = await supabase.storage.from("cases").remove([path]);
    if (deleteError) {
      throw deleteError;
    }
  };

  const deleteProjectFileFromStorage = async (url: string | null) => {
    const path = getStoragePathFromUrl(url, "cases");
    if (!path) return;
    const { error: deleteError } = await supabase.storage.from("cases").remove([path]);
    if (deleteError) {
      throw deleteError;
    }
  };

  const uploadProjectFile = async (
    file: File | null,
    folder: string,
    owner: string,
    currentUrl: string,
  ): Promise<{ newUrl: string | null; oldUrl: string | null }> => {
    if (!file) {
      return { newUrl: currentUrl || null, oldUrl: null };
    }

    const filePath = `${folder}/${owner}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from("cases").upload(filePath, file, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return { newUrl: data.publicUrl, oldUrl: currentUrl || null };
  };

  const uploadCoverImage = async (): Promise<{ newUrl: string | null; oldUrl: string | null }> => {
    if (!coverImageFile) {
      return { newUrl: formData.coverImageUrl || null, oldUrl: null };
    }

    const owner = userId ?? "project-cover";
    const filePath = `project-covers/${owner}/${Date.now()}-${sanitizeFileName(coverImageFile.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("cases")
      .upload(filePath, coverImageFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("cases").getPublicUrl(filePath);
    return { newUrl: data.publicUrl, oldUrl: formData.coverImageUrl || null };
  };

  const handleDownloadAttachment = async (url: string | null) => {
    if (!url) {
      return;
    }

    const path = getStoragePathFromUrl(url, "cases");
    if (!path) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const { data, error: signedUrlError } = await supabase.storage
      .from("cases")
      .createSignedUrl(path, 3600, { download: true });

    if (signedUrlError) {
      setError(signedUrlError.message);
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canManageProjects) {
      setError("You do not have permission to manage projects.");
      return;
    }

    if (formData.projectType === "Others" && !formData.projectTypeOther.trim()) {
      setError("Please enter the project type when selecting Others.");
      return;
    }

    if (formData.propertyCategory === "Others" && !formData.propertyCategoryOther.trim()) {
      setError("Please enter the property category when selecting Others.");
      return;
    }

    const bedroomMin = toIntOrNull(formData.bedroomMin);
    const bedroomMax = toIntOrNull(formData.bedroomMax);
    const bathroomMin = toIntOrNull(formData.bathroomMin);
    const bathroomMax = toIntOrNull(formData.bathroomMax);

    if (bedroomMin !== null && bedroomMax !== null && bedroomMin > bedroomMax) {
      setError("Bedroom range is invalid. The minimum bedroom count cannot be more than the maximum.");
      return;
    }

    if (bathroomMin !== null && bathroomMax !== null && bathroomMin > bathroomMax) {
      setError("Bathroom range is invalid. The minimum bathroom count cannot be more than the maximum.");
      return;
    }

    const normalizedCommissionStructures = formData.commissionStructures.map((structure, index) => ({
      id: structure.id,
      label: structure.label.trim() || `Tier ${index + 1}`,
      min_units: toIntOrNull(structure.minUnits),
      max_units: toIntOrNull(structure.maxUnits),
      company_commission: toNumberOrNull(structure.companyCommission),
      agent_commission: toNumberOrNull(structure.agentCommission),
      pre_leader_override: toNumberOrNull(structure.preLeaderOverride),
      leader_override: toNumberOrNull(structure.leaderOverride),
    }));

    if (normalizedCommissionStructures.length === 0) {
      setError("Please add at least one commission structure.");
      return;
    }

    if (
      normalizedCommissionStructures.some(
        (structure) =>
          structure.min_units !== null &&
          structure.max_units !== null &&
          structure.min_units > structure.max_units
      )
    ) {
      setError("One of the commission tier unit ranges is invalid. The minimum units cannot be more than the maximum.");
      return;
    }

    if (
      normalizedCommissionStructures.some(
        (structure) =>
          structure.company_commission === null &&
          structure.agent_commission === null &&
          structure.pre_leader_override === null &&
          structure.leader_override === null
      )
    ) {
      setError("Each commission structure must include at least one commission percentage.");
      return;
    }

    if (!formData.defaultCommissionStructureId) {
      setError("Please choose the current tier.");
      return;
    }

    if (!normalizedCommissionStructures.some((structure) => structure.id === formData.defaultCommissionStructureId)) {
      setError("Please choose a valid current tier.");
      return;
    }

    const primaryCommissionStructure = normalizedCommissionStructures[0];
    const editingProject = editingId ? projects.find((project) => project.id === editingId) ?? null : null;
    const previousDefaultStructure = getDefaultProjectCommissionStructure(editingProject);
    const nextDefaultStructure = getDefaultProjectCommissionStructure({
      commission_structures: normalizedCommissionStructures,
      default_commission_structure_id: formData.defaultCommissionStructureId,
    });
    const tierUpgradeSourceStructure = previousDefaultStructure;
    const shouldGenerateTopUps = Boolean(
      editingId &&
        tierUpgradeSourceStructure &&
        nextDefaultStructure &&
        tierUpgradeSourceStructure.id !== nextDefaultStructure.id &&
        Boolean(buildTierUpgradeTopUpStructure(tierUpgradeSourceStructure, nextDefaultStructure)) &&
        window.confirm(
          `Default tier is changing from ${
            previousDefaultStructure ? getCommissionStructureLabel(previousDefaultStructure) : "the previous tier"
          } to ${getCommissionStructureLabel(nextDefaultStructure)}. Generate top-up payout rows for approved or paid cases that are still on ${getCommissionStructureLabel(
            tierUpgradeSourceStructure,
          )}?`,
        ),
    );

    setIsSubmitting(true);
    setError(null);

    let uploadedCoverImageUrl: string | null = null;
    const uploadedAttachmentUrls: string[] = [];

    try {
      const owner = userId ?? "project-file";
      const { newUrl, oldUrl } = await uploadCoverImage();
      const attachment1Upload = await uploadProjectFile(
        attachment1File,
        "project-attachments",
        owner,
        formData.attachment1Url,
      );
      const attachment2Upload = await uploadProjectFile(
        attachment2File,
        "project-attachments",
        owner,
        formData.attachment2Url,
      );

      uploadedCoverImageUrl = coverImageFile ? newUrl : null;
      if (attachment1File && attachment1Upload.newUrl) {
        uploadedAttachmentUrls.push(attachment1Upload.newUrl);
      }
      if (attachment2File && attachment2Upload.newUrl) {
        uploadedAttachmentUrls.push(attachment2Upload.newUrl);
      }

      const payload = {
        project_name: formData.projectName,
        developer_name: formData.developerName,
        description: formData.description.trim() || null,
        project_type: formData.projectType === "Others" ? formData.projectTypeOther.trim() : formData.projectType,
        property_category: formData.propertyCategory === "Others" ? formData.propertyCategoryOther.trim() : formData.propertyCategory,
        location: formData.location,
        state_area: formData.stateArea,
        total_units: toIntOrNull(formData.totalUnits),
        bedroom_min: bedroomMin,
        bedroom_max: bedroomMax,
        bathroom_min: bathroomMin,
        bathroom_max: bathroomMax,
        price_min: toNumberOrNull(formData.priceMin),
        price_max: toNumberOrNull(formData.priceMax),
        size_min: toNumberOrNull(formData.sizeMin),
        size_max: toNumberOrNull(formData.sizeMax),
        tenure: formData.tenure,
        company_commission: primaryCommissionStructure.company_commission,
        agent_commission: primaryCommissionStructure.agent_commission,
        pre_leader_override: primaryCommissionStructure.pre_leader_override,
        leader_override: primaryCommissionStructure.leader_override,
        commission_structures: normalizedCommissionStructures,
        default_commission_structure_id: formData.defaultCommissionStructureId,
        launch_date: formData.launchDate || null,
        completion_date: formData.completionDate || null,
        status: formData.status,
        cover_image_url: newUrl,
        attachment_1_url: attachment1Upload.newUrl,
        attachment_1_label: formData.attachment1Name.trim() || null,
        attachment_2_url: attachment2Upload.newUrl,
        attachment_2_label: formData.attachment2Name.trim() || null,
      };

      const { error: submitError } = editingId
        ? await supabase.from("projects").update(payload).eq("id", editingId)
        : await supabase.from("projects").insert([payload]);

      if (submitError) {
        if (uploadedCoverImageUrl) {
          await deleteCoverImageFromStorage(uploadedCoverImageUrl).catch(() => undefined);
        }
        await Promise.all(uploadedAttachmentUrls.map((url) => deleteProjectFileFromStorage(url).catch(() => undefined)));
        setError(submitError.message);
        setIsSubmitting(false);
        return;
      }

      let topUpSummary: { createdCount: number; skippedCount: number } | null = null;

      if (editingId && shouldGenerateTopUps && nextDefaultStructure && tierUpgradeSourceStructure) {
        topUpSummary = await generateTierUpgradeTopUps(editingId, tierUpgradeSourceStructure, nextDefaultStructure);
      }

      await fetchProjects();
      if (newUrl && oldUrl && newUrl !== oldUrl) {
        await deleteCoverImageFromStorage(oldUrl);
      }
      if (attachment1Upload.newUrl && attachment1Upload.oldUrl && attachment1Upload.newUrl !== attachment1Upload.oldUrl) {
        await deleteProjectFileFromStorage(attachment1Upload.oldUrl);
      }
      if (attachment2Upload.newUrl && attachment2Upload.oldUrl && attachment2Upload.newUrl !== attachment2Upload.oldUrl) {
        await deleteProjectFileFromStorage(attachment2Upload.oldUrl);
      }
      resetForm();
      setShowProjectModal(false);
      setIsSubmitting(false);

      if (topUpSummary?.createdCount) {
        window.alert(`Project updated. Generated ${topUpSummary.createdCount} tier upgrade top-up payout row(s).`);
      } else if (topUpSummary && topUpSummary.skippedCount > 0) {
        window.alert("Project updated. Matching tier top-up payout rows already existed, so no new rows were generated.");
      }
    } catch (err) {
      if (uploadedCoverImageUrl) {
        await deleteCoverImageFromStorage(uploadedCoverImageUrl).catch(() => undefined);
      }
      await Promise.all(uploadedAttachmentUrls.map((url) => deleteProjectFileFromStorage(url).catch(() => undefined)));
      setError(err instanceof Error ? err.message : "Unable to save project.");
      setIsSubmitting(false);
    }
  };

  const handleToggleHidden = async (project: ProjectRecord) => {
    if (!canManageProjects) {
      return;
    }

    setError(null);

    const nextHiddenState = !project.is_hidden;
    const { error: updateError } = await supabase
      .from("projects")
      .update({ is_hidden: nextHiddenState })
      .eq("id", project.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (selectedProject?.id === project.id) {
      setSelectedProject({ ...selectedProject, is_hidden: nextHiddenState });
    }

    await fetchProjects();
  };

  const handleEdit = (project: ProjectRecord) => {
    if (!canManageProjects) {
      return;
    }

    clearPreview();
    setEditingId(project.id);
    mapRecordToForm(project);
    setCoverImageFile(null);
    setAttachment1File(null);
    setAttachment2File(null);
    if (coverImageInputRef.current) {
      coverImageInputRef.current.value = "";
    }
    if (attachment1InputRef.current) {
      attachment1InputRef.current.value = "";
    }
    if (attachment2InputRef.current) {
      attachment2InputRef.current.value = "";
    }
    setShowProjectModal(true);
  };

  const handleDelete = async (project: ProjectRecord) => {
    if (!canManageProjects) {
      return;
    }

    const isConfirmed = window.confirm(
      "Delete this project? If the project is deleted successfully, the cover image and all project attachments will also be deleted from Supabase storage."
    );

    if (!isConfirmed) {
      return;
    }

    setError(null);

    const { error: deleteError } = await supabase.from("projects").delete().eq("id", project.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    try {
      await Promise.all([
        deleteCoverImageFromStorage(project.cover_image_url),
        deleteProjectFileFromStorage(project.attachment_1_url),
        deleteProjectFileFromStorage(project.attachment_2_url),
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Project deleted, but attachment cleanup failed: ${err.message}`
          : "Project deleted, but attachment cleanup failed."
      );
      await fetchProjects();
      if (editingId === project.id) {
        resetForm();
        setShowProjectModal(false);
      }
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
      }
      return;
    }

    await fetchProjects();
    if (editingId === project.id) {
      resetForm();
      setShowProjectModal(false);
    }
    if (selectedProject?.id === project.id) {
      setSelectedProject(null);
    }
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Projects</h2>
          <p className="text-gray-500 text-sm mt-1">Browse project launches, details, and specifications</p>
          <p className="text-xs text-gray-400 mt-1">{projectCount} projects saved</p>
        </div>
        {canManageProjects && (
          <button
            type="button"
            onClick={openNewProjectModal}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            <Save className="w-4 h-4" />
            Add Project
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">Saved Projects</h3>
          {!canManageProjects && (
            <span className="text-sm text-gray-500">View only</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedProject(project)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedProject(project);
                }
              }}
              className="overflow-hidden rounded-2xl border border-gray-100 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
            >
              <div className="bg-gradient-to-b from-slate-50 to-white px-5 pt-5">
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
                  {project.cover_image_url ? (
                    <img
                      src={project.cover_image_url}
                      alt={project.project_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 text-sm font-medium text-slate-500">
                      No Cover Image
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {project.status || "-"}
                      </span>
                      {project.is_hidden && (
                        <span className="inline-flex rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white">
                          Hidden
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-5">
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{project.project_name}</h4>
                  <p className="text-sm text-gray-500">{project.developer_name || "-"}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Type</p>
                    <p className="mt-1 font-medium text-gray-700">{project.project_type || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Location</p>
                    <p className="mt-1 font-medium text-gray-700">{project.state_area || project.location || "-"}</p>
                  </div>
                </div>

                {canManageProjects && (
                  <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleEdit(project);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleHidden(project);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:text-amber-800"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      {project.is_hidden ? "Unhide" : "Hide"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(project);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center text-gray-500">
              No projects yet.
            </div>
          )}
        </div>
      </div>

      {showProjectModal && canManageProjects && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-gray-100 bg-[var(--color-body)] shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {editingId ? "Edit Project" : "Add New Project"}
                </h3>
                <p className="mt-1 text-sm text-gray-500">Insert project details and specifications</p>
              </div>
              <button
                type="button"
                onClick={closeProjectModal}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">Basic Project Info</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                    <input
                      type="text"
                      name="projectName"
                      value={formData.projectName}
                      onChange={handleChange}
                      placeholder="e.g. Residensi Wilayah Sentul"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Developer Name</label>
                    <input
                      type="text"
                      name="developerName"
                      value={formData.developerName}
                      onChange={handleChange}
                      placeholder="Developer Name"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Description</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="Describe the project highlights, facilities, concept, or any important notes"
                      rows={5}
                      className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <p className="mt-1 text-xs text-gray-500">Line breaks will be saved and shown when viewing the project.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Type</label>
                    <select
                      name="projectType"
                      value={formData.projectType}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      {PROJECT_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Property Category</label>
                    <select
                      name="propertyCategory"
                      value={formData.propertyCategory}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      {PROPERTY_CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  {formData.projectType === "Others" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Project Type - Others</label>
                      <input
                        type="text"
                        name="projectTypeOther"
                        value={formData.projectTypeOther}
                        onChange={handleChange}
                        placeholder="Enter the project type"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        required
                      />
                    </div>
                  )}
                  {formData.propertyCategory === "Others" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Property Category - Others</label>
                      <input
                        type="text"
                        name="propertyCategoryOther"
                        value={formData.propertyCategoryOther}
                        onChange={handleChange}
                        placeholder="Enter the property category"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        required
                      />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Cover Picture</label>
                    <input
                      ref={coverImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCoverImageChange}
                      className="hidden"
                    />
                    <div className="rounded-xl border border-dashed border-gray-200 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-16 w-24 overflow-hidden rounded-lg bg-slate-100">
                            {formData.coverImageUrl ? (
                              <img
                                src={formData.coverImageUrl}
                                alt="Project cover preview"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                                No Image
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-700">
                              {formData.coverImageName || "No cover image selected"}
                            </p>
                            <p className="text-xs text-gray-500">Upload a cover image for the project card.</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => coverImageInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <Upload className="h-4 w-4" />
                          Upload Cover
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Attachments</label>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-dashed border-gray-200 p-4">
                        <input
                          ref={attachment1InputRef}
                          type="file"
                          accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                          onChange={(event) => handleAttachmentChange(event, "attachment1")}
                          className="hidden"
                        />
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-700">Attachment 1</p>
                            <p className="text-xs text-gray-500">PDF, image, or office document.</p>
                          </div>
                          <input
                            type="text"
                            value={formData.attachment1Name}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, attachment1Name: event.target.value }))
                            }
                            placeholder="Attachment display name"
                            className="w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                          />
                          <p className="text-sm text-gray-600 break-all">
                            {attachment1File?.name || formData.attachment1Url.split("/").pop() || "No attachment selected"}
                          </p>
                          <button
                            type="button"
                            onClick={() => attachment1InputRef.current?.click()}
                            className="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Upload className="h-4 w-4" />
                            Upload Attachment 1
                          </button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-dashed border-gray-200 p-4">
                        <input
                          ref={attachment2InputRef}
                          type="file"
                          accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                          onChange={(event) => handleAttachmentChange(event, "attachment2")}
                          className="hidden"
                        />
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-700">Attachment 2</p>
                            <p className="text-xs text-gray-500">PDF, image, or office document.</p>
                          </div>
                          <input
                            type="text"
                            value={formData.attachment2Name}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, attachment2Name: event.target.value }))
                            }
                            placeholder="Attachment display name"
                            className="w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                          />
                          <p className="text-sm text-gray-600 break-all">
                            {attachment2File?.name || formData.attachment2Url.split("/").pop() || "No attachment selected"}
                          </p>
                          <button
                            type="button"
                            onClick={() => attachment2InputRef.current?.click()}
                            className="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Upload className="h-4 w-4" />
                            Upload Attachment 2
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Location / Address</label>
                    <input
                      type="text"
                      name="location"
                      value={formData.location}
                      onChange={handleChange}
                      placeholder="Full Address"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">State & Area</label>
                    <input
                      type="text"
                      name="stateArea"
                      value={formData.stateArea}
                      onChange={handleChange}
                      placeholder="e.g. Kuala Lumpur, Selangor"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">Pricing & Units</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Units Available</label>
                    <input
                      type="number"
                      name="totalUnits"
                      value={formData.totalUnits}
                      onChange={handleChange}
                      placeholder="0"
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tenure Type</label>
                    <select
                      name="tenure"
                      value={formData.tenure}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      <option value="Freehold">Freehold</option>
                      <option value="Leasehold">Leasehold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bedroom Range</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        name="bedroomMin"
                        value={formData.bedroomMin}
                        onChange={handleChange}
                        placeholder="Min"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                      <span className="pt-2 text-gray-500">-</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        name="bedroomMax"
                        value={formData.bedroomMax}
                        onChange={handleChange}
                        placeholder="Max"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bathroom Range</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        name="bathroomMin"
                        value={formData.bathroomMin}
                        onChange={handleChange}
                        placeholder="Min"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                      <span className="pt-2 text-gray-500">-</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        name="bathroomMax"
                        value={formData.bathroomMax}
                        onChange={handleChange}
                        placeholder="Max"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price Range (Min - Max)</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-2.5 text-gray-500 text-sm">RM</span>
                        <input
                          type="number"
                          name="priceMin"
                          value={formData.priceMin}
                          onChange={handleChange}
                          placeholder="Min"
                          className="w-full border border-gray-200 rounded-lg p-2.5 pl-10 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        />
                      </div>
                      <span className="pt-2 text-gray-500">-</span>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-2.5 text-gray-500 text-sm">RM</span>
                        <input
                          type="number"
                          name="priceMax"
                          value={formData.priceMax}
                          onChange={handleChange}
                          placeholder="Max"
                          className="w-full border border-gray-200 rounded-lg p-2.5 pl-10 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Built-up Size Range (sqft)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        name="sizeMin"
                        value={formData.sizeMin}
                        onChange={handleChange}
                        placeholder="Min sqft"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                      <span className="pt-2 text-gray-500">-</span>
                      <input
                        type="number"
                        name="sizeMax"
                        value={formData.sizeMax}
                        onChange={handleChange}
                        placeholder="Max sqft"
                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none flex-1"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">Commission Structure</h3>
                <div className="space-y-4">
                  {formData.commissionStructures.map((structure, index) => (
                    <div
                      key={structure.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/40 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="border-b border-slate-200 bg-white/70 px-5 py-4 backdrop-blur">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-xl font-semibold tracking-tight text-slate-900">
                                {structure.label || `Tier ${index + 1}`}
                              </h4>
                              {formData.defaultCommissionStructureId === structure.id && (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                  Current Tier
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-500">Set the commission percentages for this tier.</p>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                                {getTierUnitsSummary(structure.minUnits, structure.maxUnits)}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                                Total {structure.totalCommission || "0"}%
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start md:justify-end">
                            {formData.commissionStructures.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeCommissionStructure(structure.id)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                                Remove Tier
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5 p-5">
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Tier Setup</h5>
                                <p className="mt-1 text-xs text-slate-400">Label this range and define which units belong here.</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div className="md:col-span-2">
                                <label className="mb-1 block text-sm font-medium text-slate-700">Tier Label</label>
                                <input
                                  type="text"
                                  value={structure.label}
                                  onChange={(event) => handleCommissionStructureChange(structure.id, "label", event.target.value)}
                                  placeholder={`Tier ${index + 1}`}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700">Units From</label>
                                <input
                                  type="number"
                                  value={structure.minUnits}
                                  onChange={(event) => handleCommissionStructureChange(structure.id, "minUnits", event.target.value)}
                                  placeholder="e.g. 1"
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700">Units To</label>
                                <input
                                  type="number"
                                  value={structure.maxUnits}
                                  onChange={(event) => handleCommissionStructureChange(structure.id, "maxUnits", event.target.value)}
                                  placeholder="e.g. 10"
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-sky-50 p-4 shadow-sm">
                            <div className="mb-4">
                              <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Auto Split</h5>
                              <p className="mt-1 text-xs text-slate-500">Set the total commission and the tier will pre-fill the split below.</p>
                            </div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Total Commission (%)</label>
                            <input
                              type="number"
                              value={structure.totalCommission}
                              onChange={(event) => handleTierTotalCommissionChange(structure.id, event.target.value)}
                              placeholder="e.g. 8"
                              step="0.001"
                              className="w-full rounded-xl border border-blue-200 bg-white p-3 text-lg font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                            />
                            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600">
                              <div className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                                <span className="block text-[11px] uppercase tracking-wide text-slate-400">Company</span>
                                <span className="font-semibold text-slate-800">30%</span>
                              </div>
                              <div className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                                <span className="block text-[11px] uppercase tracking-wide text-slate-400">Agent</span>
                                <span className="font-semibold text-slate-800">50%</span>
                              </div>
                              <div className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                                <span className="block text-[11px] uppercase tracking-wide text-slate-400">Pre Leader</span>
                                <span className="font-semibold text-slate-800">10%</span>
                              </div>
                              <div className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                                <span className="block text-[11px] uppercase tracking-wide text-slate-400">Leader</span>
                                <span className="font-semibold text-slate-800">10%</span>
                              </div>
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-slate-500">
                              You can fine-tune the split after auto-fill if this tier needs a custom allocation.
                            </p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Commission Breakdown</h5>
                            <p className="mt-1 text-xs text-slate-400">Adjust each portion manually if this tier needs a different split.</p>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-sm font-medium text-slate-700">Company Commission (%)</label>
                              <input
                                type="number"
                                value={structure.companyCommission}
                                onChange={(event) => handleCommissionStructureChange(structure.id, "companyCommission", event.target.value)}
                                placeholder="e.g. 4"
                                step="0.001"
                                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-slate-700">Agent Commission (%)</label>
                              <input
                                type="number"
                                value={structure.agentCommission}
                                onChange={(event) => handleCommissionStructureChange(structure.id, "agentCommission", event.target.value)}
                                placeholder="e.g. 2"
                                step="0.001"
                                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-slate-700">Pre Leader Override (%)</label>
                              <input
                                type="number"
                                value={structure.preLeaderOverride}
                                onChange={(event) => handleCommissionStructureChange(structure.id, "preLeaderOverride", event.target.value)}
                                placeholder="e.g. 1"
                                step="0.001"
                                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium text-slate-700">Leader Override (%)</label>
                              <input
                                type="number"
                                value={structure.leaderOverride}
                                onChange={(event) => handleCommissionStructureChange(structure.id, "leaderOverride", event.target.value)}
                                placeholder="e.g. 1"
                                step="0.001"
                                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Current Tier</label>
                    <select
                      name="defaultCommissionStructureId"
                      value={formData.defaultCommissionStructureId}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      {formData.commissionStructures.map((structure, index) => (
                        <option key={structure.id} value={structure.id}>
                          {getCommissionStructureLabel(
                            {
                              id: structure.id,
                              label: structure.label || `Tier ${index + 1}`,
                              min_units: structure.minUnits ? Number(structure.minUnits) : null,
                              max_units: structure.maxUnits ? Number(structure.maxUnits) : null,
                              company_commission: structure.companyCommission ? Number(structure.companyCommission) : null,
                              agent_commission: structure.agentCommission ? Number(structure.agentCommission) : null,
                              pre_leader_override: structure.preLeaderOverride ? Number(structure.preLeaderOverride) : null,
                              leader_override: structure.leaderOverride ? Number(structure.leaderOverride) : null,
                            },
                            index,
                          )}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      New cases will automatically use this tier. Users will no longer choose it in the sales case form.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addCommissionStructure}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-4 w-4" />
                    New Tier
                  </button>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-3 mb-4">Timeline</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Launch Date</label>
                    <input
                      type="date"
                      name="launchDate"
                      value={formData.launchDate}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expected Completion Date (VP)</label>
                    <input
                      type="date"
                      name="completionDate"
                      value={formData.completionDate}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Status</label>
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleChange}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-white"
                    >
                      <option value="Coming Soon">Coming Soon</option>
                      <option value="Active">Active</option>
                      <option value="Completed">Completed</option>
                      <option value="On Hold">On Hold</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeProjectModal}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {isSubmitting ? "Saving..." : editingId ? "Save Changes" : "Save Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl">
            <div className="bg-gradient-to-b from-slate-50 to-white px-6 pt-6">
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
                {selectedProject.cover_image_url ? (
                  <img
                    src={selectedProject.cover_image_url}
                    alt={selectedProject.project_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 text-sm font-medium text-slate-500">
                    No Cover Image
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedProject(null)}
                className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-gray-600 shadow-sm hover:text-gray-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{selectedProject.project_name}</h3>
                  <p className="mt-1 text-sm text-gray-500">{selectedProject.developer_name || "-"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                    {selectedProject.status || "-"}
                  </span>
                  {selectedProject.is_hidden && (
                    <span className="inline-flex w-fit rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white">
                      Hidden Project
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-gray-100 p-5">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Overview</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-400">Type</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.project_type || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Category</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.property_category || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Location</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.location || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">State & Area</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.state_area || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Total Units</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.total_units ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Bedroom Range</p>
                      <p className="mt-1 font-medium text-gray-800">{formatRange(selectedProject.bedroom_min, selectedProject.bedroom_max)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Bathroom Range</p>
                      <p className="mt-1 font-medium text-gray-800">{formatRange(selectedProject.bathroom_min, selectedProject.bathroom_max)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Tenure</p>
                      <p className="mt-1 font-medium text-gray-800">{selectedProject.tenure || "-"}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-gray-100 p-5">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pricing</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-400">Price From</p>
                      <p className="mt-1 font-medium text-gray-800">RM {formatNumber(selectedProject.price_min)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Price To</p>
                      <p className="mt-1 font-medium text-gray-800">RM {formatNumber(selectedProject.price_max)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Size From</p>
                      <p className="mt-1 font-medium text-gray-800">{formatNumber(selectedProject.size_min)} sqft</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Size To</p>
                      <p className="mt-1 font-medium text-gray-800">{formatNumber(selectedProject.size_max)} sqft</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-gray-100 p-5">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Commission</h4>
                  <div className="space-y-3 text-sm">
                    {getProjectCommissionStructures(selectedProject).map((structure, index) => (
                      <div key={structure.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-gray-800">{getCommissionStructureLabel(structure, index)}</p>
                          {selectedProject.default_commission_structure_id === structure.id && (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              Current Tier
                            </span>
                          )}
                        </div>
                        <div className={`mt-3 grid gap-4 ${canManageProjects ? "grid-cols-2" : "grid-cols-1 md:grid-cols-3"}`}>
                          {canManageProjects && (
                            <div>
                              <p className="text-gray-400">Company</p>
                              <p className="mt-1 font-medium text-gray-800">{formatCommissionPercentage(structure.company_commission)}%</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-400">Agent</p>
                            <p className="mt-1 font-medium text-gray-800">{formatCommissionPercentage(structure.agent_commission)}%</p>
                          </div>
                          <div>
                            <p className="text-gray-400">Pre Leader</p>
                            <p className="mt-1 font-medium text-gray-800">{formatCommissionPercentage(structure.pre_leader_override)}%</p>
                          </div>
                          <div>
                            <p className="text-gray-400">Leader</p>
                            <p className="mt-1 font-medium text-gray-800">{formatCommissionPercentage(structure.leader_override)}%</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-gray-100 p-5">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Timeline</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-400">Launch Date</p>
                      <p className="mt-1 font-medium text-gray-800">{formatDate(selectedProject.launch_date)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Completion Date</p>
                      <p className="mt-1 font-medium text-gray-800">{formatDate(selectedProject.completion_date)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-gray-100 p-5">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Description</h4>
                <p className="whitespace-pre-wrap text-sm font-medium text-gray-800">
                  {selectedProject.description || "-"}
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 p-5">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Attachments</h4>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {selectedProject.attachment_1_url ? (
                    <button
                      type="button"
                      onClick={() => void handleDownloadAttachment(selectedProject.attachment_1_url)}
                      className="inline-flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className="truncate pr-3">{selectedProject.attachment_1_label || "Attachment 1"}</span>
                      <Download className="h-4 w-4 flex-shrink-0" />
                    </button>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">
                      Attachment 1 not available
                    </div>
                  )}
                  {selectedProject.attachment_2_url ? (
                    <button
                      type="button"
                      onClick={() => void handleDownloadAttachment(selectedProject.attachment_2_url)}
                      className="inline-flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className="truncate pr-3">{selectedProject.attachment_2_label || "Attachment 2"}</span>
                      <Download className="h-4 w-4 flex-shrink-0" />
                    </button>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">
                      Attachment 2 not available
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
