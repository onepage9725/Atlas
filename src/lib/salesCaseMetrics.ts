import { getCaseCommissionStructure } from "./commissionStructures";
import type { ProjectOption, SalesCasePayoutRecord, SalesCaseRecord } from "../components/SalesCaseModal";

type CommissionProfile = {
  id: string;
  rank: string | null;
  recruit_by: string | null;
};

export const getStoredInvolvedProfileId = (record: SalesCaseRecord | null | undefined) => {
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

export const getCaseParticipantProfileIds = (record: SalesCaseRecord) =>
  Array.from(new Set([record.created_by, getStoredInvolvedProfileId(record)].filter(Boolean))) as string[];

export const getCasePersonalAmountForProfile = (
  record: SalesCaseRecord,
  totalAmount: number | null | undefined,
  profileId: string
) => {
  const participantIds = getCaseParticipantProfileIds(record);

  if (!profileId || participantIds.length === 0 || !participantIds.includes(profileId)) {
    return 0;
  }

  return Number(totalAmount ?? 0) / participantIds.length;
};

export const getCasePersonalAmountForProfiles = (
  record: SalesCaseRecord,
  totalAmount: number | null | undefined,
  profileIds: Iterable<string>
) => {
  const participantIds = getCaseParticipantProfileIds(record);

  if (participantIds.length === 0) {
    return 0;
  }

  const scopedIds = new Set(profileIds);
  const matchedParticipantCount = participantIds.filter((profileId) => scopedIds.has(profileId)).length;

  if (matchedParticipantCount === 0) {
    return 0;
  }

  return (Number(totalAmount ?? 0) / participantIds.length) * matchedParticipantCount;
};

export const getStandardPayouts = (payouts: SalesCasePayoutRecord[]) =>
  payouts.filter((payout) => payout.payout_type === "standard");

export const isCompletedByPayouts = (payouts: SalesCasePayoutRecord[]) => {
  const standardPayouts = getStandardPayouts(payouts);
  return standardPayouts.length > 0 && standardPayouts.every((payout) => payout.payout_status === "Paid");
};

const getLeaderChain = (
  profile: CommissionProfile | null,
  profileMap: Map<string, CommissionProfile>,
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

  const recruiter = profile.recruit_by ? profileMap.get(profile.recruit_by) ?? null : null;

  if (!recruiter) {
    return { preLeader: null, leader: null };
  }

  if (recruiter.rank === "leader") {
    return { preLeader: null, leader: recruiter };
  }

  if (recruiter.rank === "pre_leader") {
    const leader = recruiter.recruit_by ? profileMap.get(recruiter.recruit_by) ?? null : null;
    return { preLeader: recruiter, leader };
  }

  if (recruiter.rank === "agent") {
    return getLeaderChain(recruiter, profileMap, nextVisitedIds);
  }

  return { preLeader: null, leader: null };
};

export const getCaseCommissionAmountForProfile = (
  record: SalesCaseRecord,
  project: ProjectOption | null | undefined,
  profiles: CommissionProfile[],
  profileId: string
) => {
  if (!profileId) {
    return 0;
  }

  const commissionStructure = getCaseCommissionStructure(record, project);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const viewerProfile = profileMap.get(profileId) ?? null;
  const creatorProfile = record.created_by ? profileMap.get(record.created_by) ?? null : null;
  const involvedUserId = getStoredInvolvedProfileId(record);
  const involvedProfile = involvedUserId ? profileMap.get(involvedUserId) ?? null : null;

  if (!project || !viewerProfile || !commissionStructure) {
    return 0;
  }

  const participantIds = Array.from(new Set([record.created_by, involvedUserId].filter(Boolean))) as string[];
  const participants = [creatorProfile, involvedProfile].filter(
    (profile, index, array): profile is CommissionProfile =>
      Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index
  );

  if (participantIds.length === 0) {
    return 0;
  }

  const splitAgentPercentage = (commissionStructure.agent_commission ?? 0) / participantIds.length;
  const splitPreLeaderPercentage = (commissionStructure.pre_leader_override ?? 0) / participantIds.length;
  const splitLeaderPercentage = (commissionStructure.leader_override ?? 0) / participantIds.length;
  let totalPercentage = 0;

  participants.forEach((participant) => {
    const chain = getLeaderChain(participant, profileMap);

    if (participant.id === profileId) {
      totalPercentage += splitAgentPercentage;
    }

    if (participant.rank === "agent") {
      const preLeaderRecipient = chain.preLeader ?? chain.leader;

      if (preLeaderRecipient?.id === profileId) {
        totalPercentage += splitPreLeaderPercentage;
      }

      if (chain.leader?.id === profileId) {
        totalPercentage += splitLeaderPercentage;
      }

      return;
    }

    if (participant.rank === "pre_leader") {
      if (participant.id === profileId) {
        totalPercentage += splitPreLeaderPercentage;
      }

      if (chain.leader?.id === profileId) {
        totalPercentage += splitLeaderPercentage;
      }

      return;
    }

    if (participant.rank === "leader" && participant.id === profileId) {
      totalPercentage += splitPreLeaderPercentage + splitLeaderPercentage;
    }
  });

  return (record.nett_price ?? 0) * (totalPercentage / 100);
};

export const getCaseCommissionAmountForProfiles = (
  record: SalesCaseRecord,
  project: ProjectOption | null | undefined,
  profiles: CommissionProfile[],
  profileIds: Iterable<string>
) => {
  const scopedIds = new Set(profileIds);

  return Array.from(scopedIds).reduce(
    (sum, profileId) => sum + getCaseCommissionAmountForProfile(record, project, profiles, profileId),
    0
  );
};

export const getCompletedCommissionAmountForProfiles = (
  payouts: SalesCasePayoutRecord[],
  profileIds: Iterable<string>
) => {
  const standardPayouts = getStandardPayouts(payouts);

  if (standardPayouts.length === 0 || !standardPayouts.every((payout) => payout.payout_status === "Paid")) {
    return 0;
  }

  return getPayoutCommissionAmountForProfiles(standardPayouts, profileIds);
};

export const getPayoutCommissionAmountForProfiles = (
  payouts: SalesCasePayoutRecord[],
  profileIds: Iterable<string>
) => {
  const standardPayouts = getStandardPayouts(payouts);

  const scopedIds = new Set(profileIds);

  return standardPayouts.reduce((sum, payout) => {
    if (!scopedIds.has(payout.profile_id)) {
      return sum;
    }

    return sum + Number(payout.total_amount ?? 0);
  }, 0);
};