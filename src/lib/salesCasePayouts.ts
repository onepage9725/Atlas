import { getCommissionStructureTotal, type CommissionStructure } from "./commissionStructures";

type SalesCasePayoutSource = {
  created_by: string | null;
  involved_profile_id: string | null;
  involved_user_ids: string[] | null;
  nett_price: number | null;
};

type ProfilePayoutSource = {
  id: string;
  rank: string | null;
  recruit_by: string | null;
};

export type ComputedPayoutRow = {
  profileId: string;
  agentCommissionPercentage: number;
  preLeaderOverridePercentage: number;
  leaderOverridePercentage: number;
  totalAmount: number;
};

export const getStoredInvolvedProfileId = (record: SalesCasePayoutSource) => {
  if (record.involved_profile_id) {
    return record.involved_profile_id;
  }

  const legacyInvolvedIds = (record.involved_user_ids ?? []).filter(
    (profileId) => profileId !== record.created_by,
  );

  return legacyInvolvedIds.length === 1 ? legacyInvolvedIds[0] : null;
};

const getLeaderChain = (
  profile: ProfilePayoutSource | null,
  profilesById: Map<string, ProfilePayoutSource>,
  visitedIds = new Set<string>(),
) => {
  if (!profile || visitedIds.has(profile.id)) {
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
    return getLeaderChain(recruiter, profilesById, nextVisitedIds);
  }

  return { preLeader: null, leader: null };
};

export const buildPayoutRowsForCommissionStructure = (
  record: SalesCasePayoutSource,
  commissionStructure: CommissionStructure | null,
  profilesById: Map<string, ProfilePayoutSource>,
) => {
  if (!commissionStructure || record.nett_price === null) {
    return [] as ComputedPayoutRow[];
  }

  const creatorProfile = record.created_by ? profilesById.get(record.created_by) ?? null : null;
  const involvedProfileId = getStoredInvolvedProfileId(record);
  const involvedProfile = involvedProfileId ? profilesById.get(involvedProfileId) ?? null : null;
  const participants = [creatorProfile, involvedProfile].filter(
    (profile, index, array): profile is ProfilePayoutSource =>
      Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index,
  );

  if (participants.length === 0) {
    return [] as ComputedPayoutRow[];
  }

  const splitAgentPercentage = (commissionStructure.agent_commission ?? 0) / participants.length;
  const splitPreLeaderPercentage = (commissionStructure.pre_leader_override ?? 0) / participants.length;
  const splitLeaderPercentage = (commissionStructure.leader_override ?? 0) / participants.length;
  const rowsByProfileId = new Map<string, ComputedPayoutRow>();

  const appendPercentage = (
    profile: ProfilePayoutSource | null,
    field: keyof Omit<ComputedPayoutRow, "profileId" | "totalAmount">,
    percentage: number,
  ) => {
    if (!profile || percentage === 0) {
      return;
    }

    const existingRow = rowsByProfileId.get(profile.id) ?? {
      profileId: profile.id,
      agentCommissionPercentage: 0,
      preLeaderOverridePercentage: 0,
      leaderOverridePercentage: 0,
      totalAmount: 0,
    };

    existingRow[field] += percentage;
    existingRow.totalAmount =
      record.nett_price === null
        ? 0
        : record.nett_price * (
            (existingRow.agentCommissionPercentage +
              existingRow.preLeaderOverridePercentage +
              existingRow.leaderOverridePercentage) /
              100
          );

    rowsByProfileId.set(profile.id, existingRow);
  };

  participants.forEach((participant) => {
    appendPercentage(participant, "agentCommissionPercentage", splitAgentPercentage);

    const chain = getLeaderChain(participant, profilesById);

    if (participant.rank === "agent") {
      appendPercentage(
        chain.preLeader ?? chain.leader,
        "preLeaderOverridePercentage",
        splitPreLeaderPercentage,
      );
      appendPercentage(chain.leader, "leaderOverridePercentage", splitLeaderPercentage);
      return;
    }

    if (participant.rank === "pre_leader") {
      appendPercentage(participant, "preLeaderOverridePercentage", splitPreLeaderPercentage);
      appendPercentage(chain.leader, "leaderOverridePercentage", splitLeaderPercentage);
      return;
    }

    if (participant.rank === "leader") {
      appendPercentage(participant, "preLeaderOverridePercentage", splitPreLeaderPercentage);
      appendPercentage(participant, "leaderOverridePercentage", splitLeaderPercentage);
    }
  });

  return Array.from(rowsByProfileId.values());
};

export const buildTierUpgradeTopUpStructure = (
  previousStructure: CommissionStructure,
  nextStructure: CommissionStructure,
) => {
  const companyCommission = Math.max((nextStructure.company_commission ?? 0) - (previousStructure.company_commission ?? 0), 0);
  const agentCommission = Math.max((nextStructure.agent_commission ?? 0) - (previousStructure.agent_commission ?? 0), 0);
  const preLeaderOverride = Math.max(
    (nextStructure.pre_leader_override ?? 0) - (previousStructure.pre_leader_override ?? 0),
    0,
  );
  const leaderOverride = Math.max((nextStructure.leader_override ?? 0) - (previousStructure.leader_override ?? 0), 0);

  if (companyCommission === 0 && agentCommission === 0 && preLeaderOverride === 0 && leaderOverride === 0) {
    return null;
  }

  return {
    id: `${previousStructure.id}-to-${nextStructure.id}-top-up`,
    label: `${nextStructure.label ?? nextStructure.id} Top-Up`,
    min_units: null,
    max_units: null,
    company_commission: companyCommission,
    agent_commission: agentCommission,
    pre_leader_override: preLeaderOverride,
    leader_override: leaderOverride,
    direct_commission: null,
    holding_commission: null,
  } satisfies CommissionStructure;
};

export const buildCommissionStructureByTotalPercentage = (
  sourceStructure: CommissionStructure,
  totalPercentage: number,
  structureId = `${sourceStructure.id}-scaled`,
  structureLabel = sourceStructure.label,
) => {
  const sourceTotal = getCommissionStructureTotal(sourceStructure);

  if (sourceTotal <= 0 || totalPercentage <= 0) {
    return null;
  }

  const scale = totalPercentage / sourceTotal;

  return {
    ...sourceStructure,
    id: structureId,
    label: structureLabel,
    company_commission: (sourceStructure.company_commission ?? 0) * scale,
    agent_commission: (sourceStructure.agent_commission ?? 0) * scale,
    pre_leader_override: (sourceStructure.pre_leader_override ?? 0) * scale,
    leader_override: (sourceStructure.leader_override ?? 0) * scale,
    direct_commission: null,
    holding_commission: null,
  } satisfies CommissionStructure;
};