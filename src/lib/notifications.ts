import { supabase } from "./supabaseClient";

export type NotificationTargetView = "Dashboard" | "Manage Cases" | "Sales Cases";

export type AppNotification = {
  id: string;
  sales_case_id: string | null;
  title: string;
  message: string;
  target_view: NotificationTargetView;
  is_read: boolean;
  created_at: string;
};

export type NotificationProfile = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  rank?: string | null;
  is_active?: boolean | null;
};

export type NotificationCommissionRow = {
  profileId: string;
  type?: "agent" | "pre_leader" | "leader";
};

type CreateCaseNotificationsParams = {
  actorUserId: string;
  salesCaseId: string;
  caseOwnerId: string;
  involvedProfileId: string | null;
  projectName: string | null;
  unitNumber: string | null;
  spaPrice: number | null;
  profiles: NotificationProfile[];
  commissionRows: NotificationCommissionRow[];
};

type NotifyCaseAudienceParams = {
  actorUserId: string;
  salesCaseId: string | null;
  caseOwnerId: string;
  involvedProfileId: string | null;
  title: string;
  message: string;
  profiles: NotificationProfile[];
  commissionRows: NotificationCommissionRow[];
  includeAdmins?: boolean;
  includeMembers?: boolean;
};

type NotificationInsertRow = {
  recipient_id: string;
  sales_case_id: string | null;
  title: string;
  message: string;
  target_view: NotificationTargetView;
  created_by: string;
};

const formatCurrency = (value: number | null) =>
  `RM ${Number(value ?? 0).toLocaleString("en-MY", {
    minimumFractionDigits: Number.isInteger(Number(value ?? 0)) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const insertNotificationRows = async (rows: NotificationInsertRow[]) => {
  if (rows.length === 0) {
    return;
  }

  const dedupedRows = Array.from(
    new Map(
      rows.map((row) => [
        `${row.recipient_id}-${row.target_view}-${row.title}-${row.sales_case_id ?? "none"}`,
        row,
      ])
    ).values()
  );

  const { error } = await supabase.from("notifications").insert(dedupedRows);

  if (error) {
    throw error;
  }
};

export const fetchNotificationProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, rank, is_active")
    .is("deleted_at", null)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return (data as NotificationProfile[]) ?? [];
};

export const getNotificationProfileLabel = (
  profileId: string | null | undefined,
  profiles: NotificationProfile[]
) => {
  if (!profileId) {
    return "A member";
  }

  const profile = profiles.find((item) => item.id === profileId) ?? null;
  return profile?.name || profile?.email || "A member";
};

const getCaseRecipientGroups = ({
  actorUserId,
  caseOwnerId,
  involvedProfileId,
  profiles,
  commissionRows,
}: Omit<NotifyCaseAudienceParams, "salesCaseId" | "title" | "message" | "includeAdmins" | "includeMembers">) => {
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  const adminRecipientIds = profiles
    .filter((profile) => (profile.role === "admin" || profile.role === "super_admin") && profile.id !== actorUserId)
    .map((profile) => profile.id);

  const memberRecipientIds = Array.from(
    new Set([
      caseOwnerId,
      involvedProfileId,
      ...commissionRows.map((row) => row.profileId),
    ].filter(Boolean) as string[])
  ).filter((recipientId) => {
    if (recipientId === actorUserId) {
      return false;
    }

    const recipient = profileMap.get(recipientId) ?? null;
    return recipient?.role !== "admin" && recipient?.role !== "super_admin";
  });

  return { adminRecipientIds, memberRecipientIds };
};

export const notifyCaseAudience = async ({
  actorUserId,
  salesCaseId,
  caseOwnerId,
  involvedProfileId,
  title,
  message,
  profiles,
  commissionRows,
  includeAdmins = true,
  includeMembers = true,
}: NotifyCaseAudienceParams) => {
  const { adminRecipientIds, memberRecipientIds } = getCaseRecipientGroups({
    actorUserId,
    caseOwnerId,
    involvedProfileId,
    profiles,
    commissionRows,
  });

  const rows: NotificationInsertRow[] = [];

  if (includeAdmins) {
    rows.push(
      ...adminRecipientIds.map((recipientId) => ({
        recipient_id: recipientId,
        sales_case_id: salesCaseId,
        title,
        message,
        target_view: "Manage Cases" as NotificationTargetView,
        created_by: actorUserId,
      }))
    );
  }

  if (includeMembers) {
    rows.push(
      ...memberRecipientIds.map((recipientId) => ({
        recipient_id: recipientId,
        sales_case_id: salesCaseId,
        title,
        message,
        target_view: "Sales Cases" as NotificationTargetView,
        created_by: actorUserId,
      }))
    );
  }

  await insertNotificationRows(rows);
};

export const createCaseNotifications = async ({
  actorUserId,
  salesCaseId,
  caseOwnerId,
  involvedProfileId,
  projectName,
  unitNumber,
  spaPrice,
  profiles,
  commissionRows,
}: CreateCaseNotificationsParams) => {
  const creatorLabel = getNotificationProfileLabel(caseOwnerId, profiles);
  const message = `${creatorLabel} created a new sale for ${projectName || "Unnamed project"}, ${unitNumber ? `Unit ${unitNumber}` : "Unit -"}, SPA ${formatCurrency(spaPrice)}.`;

  await notifyCaseAudience({
    actorUserId,
    salesCaseId,
    caseOwnerId,
    involvedProfileId,
    title: "New sales case added",
    message,
    profiles,
    commissionRows,
  });
};

export const notifyDeleteRequest = async ({
  actorUserId,
  salesCaseId,
  caseOwnerId,
  involvedProfileId,
  projectName,
  unitNumber,
  spaPrice,
  profiles,
  commissionRows,
}: CreateCaseNotificationsParams) => {
  const actorLabel = getNotificationProfileLabel(actorUserId, profiles);
  const message = `${actorLabel} requested to delete the sales case for ${projectName || "Unnamed project"}, ${unitNumber ? `Unit ${unitNumber}` : "Unit -"}, SPA ${formatCurrency(spaPrice)}.`;

  await notifyCaseAudience({
    actorUserId,
    salesCaseId,
    caseOwnerId,
    involvedProfileId,
    title: "Delete request submitted",
    message,
    profiles,
    commissionRows,
    includeMembers: false,
  });
};

export const notifyPayoutPaid = async ({
  actorUserId,
  recipientId,
  salesCaseId,
  projectName,
  unitNumber,
  amount,
}: {
  actorUserId: string;
  recipientId: string;
  salesCaseId: string;
  projectName: string | null;
  unitNumber: string | null;
  amount: number | null;
}) => {
  await insertNotificationRows([
    {
      recipient_id: recipientId,
      sales_case_id: salesCaseId,
      title: "Commission paid",
      message: `Your commission for ${projectName || "Unnamed project"}, ${unitNumber ? `Unit ${unitNumber}` : "Unit -"} has been marked paid. Amount: ${formatCurrency(amount)}.`,
      target_view: "Sales Cases",
      created_by: actorUserId,
    },
  ]);
};

export const notifyPaymentVoucherGenerated = async ({
  actorUserId,
  recipientIds,
  salesCaseId,
  details,
  grossAmount,
}: {
  actorUserId: string;
  recipientIds: string[];
  salesCaseId: string | null;
  details: string;
  grossAmount: number;
}) => {
  const uniqueRecipientIds = Array.from(new Set(recipientIds.filter(Boolean))).filter(
    (recipientId) => recipientId !== actorUserId
  );

  if (uniqueRecipientIds.length === 0) {
    return;
  }

  const detailsLabel = details || "the related sales case";
  const amountLabel = formatCurrency(grossAmount);

  await insertNotificationRows(
    uniqueRecipientIds.map((recipientId) => ({
      recipient_id: recipientId,
      sales_case_id: salesCaseId,
      title: "Payment voucher generated",
      message: `A payment voucher has been generated for ${detailsLabel}. Amount: ${amountLabel}.`,
      target_view: "Sales Cases" as NotificationTargetView,
      created_by: actorUserId,
    }))
  );
};

export const notifyEventCreated = async ({
  actorUserId,
  eventName,
  startDate,
  profiles,
}: {
  actorUserId: string;
  eventName: string;
  startDate: string | null;
  profiles: NotificationProfile[];
}) => {
  const actorLabel = getNotificationProfileLabel(actorUserId, profiles);
  const dateLabel = startDate ? ` on ${startDate}` : "";

  await insertNotificationRows(
    profiles.map((profile) => ({
      recipient_id: profile.id,
      sales_case_id: null,
      title: "New event created",
      message: `${actorLabel} created a new event: ${eventName}${dateLabel}.`,
      target_view: "Dashboard" as NotificationTargetView,
      created_by: actorUserId,
    }))
  );
};
