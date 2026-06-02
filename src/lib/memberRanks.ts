export type MemberRank = "agent" | "pre_leader" | "leader";

export type RankProfile = {
  id: string;
  role: string | null;
  rank: string | null;
  recruit_by: string | null;
  personal_points: number | null;
  group_points: number | null;
};

export type RankCase = {
  id: string;
  created_by: string | null;
  involved_user_ids: string[] | null;
  status: string | null;
};

export type RankPayout = {
  sales_case_id: string;
  profile_id: string;
  payout_type: string | null;
  payout_status: string | null;
  total_amount: number | null;
};

export type MemberRankSummary = {
  rank: MemberRank;
  eligibleRank: MemberRank;
  personalPoints: number;
  groupPoints: number;
  directRecruitCount: number;
  completedCaseCount: number;
};

const MEMBER_ROLES = new Set(["agent", "leader"]);
const COMPLETED_CASE_STATUSES = new Set(["Paid", "Completed"]);
const getStoredPersonalPoints = (profile: Pick<RankProfile, "personal_points">) =>
  Number(profile.personal_points ?? 0);

const getStoredGroupPoints = (profile: Pick<RankProfile, "group_points">) =>
  Number(profile.group_points ?? 0);

const normalizeMemberRank = (value: string | null | undefined): MemberRank => {
  if (value === "pre_leader" || value === "leader") {
    return value;
  }

  return "agent";
};

const isMemberProfile = (profile: Pick<RankProfile, "role">) => MEMBER_ROLES.has(profile.role ?? "");

export const getDirectRecruitCount = (profileId: string, profiles: RankProfile[]) =>
  profiles.filter((profile) => profile.recruit_by === profileId && isMemberProfile(profile)).length;

export const getCompletedRelatedCaseCount = (profileId: string, cases: RankCase[]) =>
  cases.filter(
    (record) =>
      COMPLETED_CASE_STATUSES.has(record.status ?? "") &&
      (record.created_by === profileId || (record.involved_user_ids ?? []).includes(profileId))
  ).length;

export const getCompletedCaseIds = (cases: RankCase[], payouts: RankPayout[]) => {
  const standardPayoutsByCase = new Map<string, RankPayout[]>();

  payouts
    .filter((payout) => payout.payout_type === "standard")
    .forEach((payout) => {
      const relatedPayouts = standardPayoutsByCase.get(payout.sales_case_id) ?? [];
      relatedPayouts.push(payout);
      standardPayoutsByCase.set(payout.sales_case_id, relatedPayouts);
    });

  return new Set(
    cases
      .filter((record) => {
        const relatedPayouts = standardPayoutsByCase.get(record.id) ?? [];
        return relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid");
      })
      .map((record) => record.id)
  );
};

export const getEarnedPersonalPoints = (profileId: string, cases: RankCase[], payouts: RankPayout[]) => {
  const completedCaseIds = getCompletedCaseIds(cases, payouts);

  return payouts.reduce((sum, payout) => {
    if (
      payout.profile_id !== profileId ||
      payout.payout_type !== "standard" ||
      payout.payout_status !== "Paid" ||
      !completedCaseIds.has(payout.sales_case_id)
    ) {
      return sum;
    }

    return sum + Number(payout.total_amount ?? 0);
  }, 0);
};

export const getPersonalPoints = (
  profile: RankProfile,
  cases: RankCase[],
  payouts: RankPayout[]
) => getStoredPersonalPoints(profile) + getEarnedPersonalPoints(profile.id, cases, payouts);

export const getCompletedRelatedCaseCountFromPayouts = (
  profileId: string,
  cases: RankCase[],
  payouts: RankPayout[]
) => {
  const completedCaseIds = getCompletedCaseIds(cases, payouts);

  return cases.filter(
    (record) =>
      completedCaseIds.has(record.id) &&
      (record.created_by === profileId || (record.involved_user_ids ?? []).includes(profileId))
  ).length;
};

export const getGroupPoints = (
  profileId: string,
  profiles: RankProfile[],
  cases: RankCase[],
  payouts: RankPayout[]
) => {
  const profilesByRecruiter = new Map<string, RankProfile[]>();

  profiles.forEach((profile) => {
    if (!profile.recruit_by) {
      return;
    }

    const recruiterProfiles = profilesByRecruiter.get(profile.recruit_by) ?? [];
    recruiterProfiles.push(profile);
    profilesByRecruiter.set(profile.recruit_by, recruiterProfiles);
  });

  const visitedIds = new Set<string>();

  const sumDescendantPoints = (currentProfileId: string): number => {
    if (visitedIds.has(currentProfileId)) {
      return 0;
    }

    visitedIds.add(currentProfileId);

    const directProfiles = profilesByRecruiter.get(currentProfileId) ?? [];

    return directProfiles.reduce(
      (sum, profile) => sum + getEarnedPersonalPoints(profile.id, cases, payouts) + sumDescendantPoints(profile.id),
      0
    );
  };

  const currentProfile = profiles.find((profile) => profile.id === profileId);
  const storedGroupPoints = getStoredGroupPoints(currentProfile ?? { group_points: 0 });
  const ownEarnedPoints = getEarnedPersonalPoints(profileId, cases, payouts);
  const computedGroupPoints = ownEarnedPoints + sumDescendantPoints(profileId);
  return storedGroupPoints + computedGroupPoints;
};

export const getMemberRankSummary = (
  profile: RankProfile,
  profiles: RankProfile[],
  cases: RankCase[],
  payouts: RankPayout[]
): MemberRankSummary => {
  const personalPoints = getPersonalPoints(profile, cases, payouts);
  const directRecruitCount = getDirectRecruitCount(profile.id, profiles);
  const completedCaseCount = getCompletedRelatedCaseCountFromPayouts(profile.id, cases, payouts);
  const groupPoints = getGroupPoints(profile.id, profiles, cases, payouts);
  const rank = normalizeMemberRank(profile.rank);

  let eligibleRank: MemberRank = "agent";

  if (personalPoints >= 300000 && groupPoints >= 100000) {
    eligibleRank = "leader";
  } else if (personalPoints >= 120000 && directRecruitCount >= 3) {
    eligibleRank = "pre_leader";
  }

  return {
    rank,
    eligibleRank,
    personalPoints,
    groupPoints,
    directRecruitCount,
    completedCaseCount,
  };
};
