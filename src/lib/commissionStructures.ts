export type CommissionStructure = {
  id: string;
  label: string | null;
  min_units: number | null;
  max_units: number | null;
  company_commission: number | null;
  agent_commission: number | null;
  pre_leader_override: number | null;
  leader_override: number | null;
  direct_commission: number | null;
  holding_commission: number | null;
};

type ProjectCommissionSource = {
  company_commission?: unknown;
  agent_commission?: unknown;
  pre_leader_override?: unknown;
  leader_override?: unknown;
  direct_commission?: unknown;
  holding_commission?: unknown;
  commission_structures?: unknown;
  default_commission_structure_id?: unknown;
};

type CaseCommissionSource = {
  commission_structure?: unknown;
};

const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableString = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const normalizeCommissionStructure = (
  value: unknown,
  fallbackId: string,
): CommissionStructure | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    id: toNullableString(record.id) ?? fallbackId,
    label: toNullableString(record.label),
    min_units: toNullableNumber(record.min_units),
    max_units: toNullableNumber(record.max_units),
    company_commission: toNullableNumber(record.company_commission),
    agent_commission: toNullableNumber(record.agent_commission),
    pre_leader_override: toNullableNumber(record.pre_leader_override),
    leader_override: toNullableNumber(record.leader_override),
    direct_commission: toNullableNumber(record.direct_commission),
    holding_commission: toNullableNumber(record.holding_commission),
  };
};

export const buildDefaultCommissionStructure = (
  source: Pick<ProjectCommissionSource, "company_commission" | "agent_commission" | "pre_leader_override" | "leader_override" | "direct_commission" | "holding_commission">,
): CommissionStructure => ({
  id: "default-tier",
  label: "Default Tier",
  min_units: null,
  max_units: null,
  company_commission: toNullableNumber(source.company_commission),
  agent_commission: toNullableNumber(source.agent_commission),
  pre_leader_override: toNullableNumber(source.pre_leader_override),
  leader_override: toNullableNumber(source.leader_override),
  direct_commission: toNullableNumber(source.direct_commission),
  holding_commission: toNullableNumber(source.holding_commission),
});

export const getProjectCommissionStructures = (
  project: ProjectCommissionSource | null | undefined,
): CommissionStructure[] => {
  if (!project) {
    return [];
  }

  if (Array.isArray(project.commission_structures) && project.commission_structures.length > 0) {
    return project.commission_structures
      .map((structure, index) => normalizeCommissionStructure(structure, `tier-${index + 1}`))
      .filter((structure): structure is CommissionStructure => Boolean(structure));
  }

  return [buildDefaultCommissionStructure(project)];
};

export const getCaseCommissionStructure = (
  record: CaseCommissionSource | null | undefined,
  project: ProjectCommissionSource | null | undefined,
): CommissionStructure | null => {
  const snapshot = normalizeCommissionStructure(record?.commission_structure, "case-tier");

  if (snapshot) {
    return snapshot;
  }

  return getProjectCommissionStructures(project)[0] ?? null;
};

export const getDefaultProjectCommissionStructure = (
  project: ProjectCommissionSource | null | undefined,
): CommissionStructure | null => {
  const structures = getProjectCommissionStructures(project);

  if (structures.length === 0) {
    return null;
  }

  const defaultStructureId = toNullableString(project?.default_commission_structure_id);

  if (!defaultStructureId) {
    return structures[0] ?? null;
  }

  return structures.find((structure) => structure.id === defaultStructureId) ?? structures[0] ?? null;
};

export const getCommissionStructureLabel = (
  structure: CommissionStructure,
  index = 0,
) => {
  const baseLabel = structure.label ?? `Tier ${index + 1}`;

  if (structure.min_units !== null && structure.max_units !== null) {
    return `${baseLabel} (${structure.min_units} - ${structure.max_units} units)`;
  }

  if (structure.min_units !== null) {
    return `${baseLabel} (${structure.min_units}+ units)`;
  }

  if (structure.max_units !== null) {
    return `${baseLabel} (Up to ${structure.max_units} units)`;
  }

  return baseLabel;
};

export const getShortCommissionStructureLabel = (label: string | null | undefined) => {
  if (!label) {
    return null;
  }

  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
};

export const getCommissionStructureTotal = (structure: CommissionStructure | null | undefined) => {
  if (!structure) {
    return 0;
  }

  return (
    (structure.company_commission ?? 0) +
    (structure.agent_commission ?? 0) +
    (structure.pre_leader_override ?? 0) +
    (structure.leader_override ?? 0)
  );
};

export const getDirectCommissionPercentage = (structure: CommissionStructure | null | undefined) => {
  if (!structure) {
    return 0;
  }

  const totalCommission = getCommissionStructureTotal(structure);
  const directCommission = structure.direct_commission;
  return directCommission === null || directCommission === undefined ? totalCommission : directCommission;
};

export const getHoldingCommissionPercentage = (structure: CommissionStructure | null | undefined) => {
  if (!structure) {
    return 0;
  }

  return structure.holding_commission ?? 0;
};