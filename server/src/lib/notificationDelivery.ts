import type { Prisma } from '@prisma/client';
import { sendTemplateEmail, type TemplateVars } from './email.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';

const DEFAULT_IN_APP_NOTIFICATION_PREFS: Record<string, boolean> = {
  ticket: true,
  inquiry: true,
  favorite: true,
  model_conversion: true,
  backup: true,
  download: false,
};

const DEFAULT_EMAIL_NOTIFICATION_PREFS: Record<string, boolean> = {
  ticket: true,
  inquiry: true,
  favorite: false,
  model_conversion: true,
  backup: true,
  download: false,
};

export const DEFAULT_NOTIFICATION_PREFS: Record<string, boolean> = {
  ...DEFAULT_IN_APP_NOTIFICATION_PREFS,
  ...Object.fromEntries(
    Object.entries(DEFAULT_EMAIL_NOTIFICATION_PREFS).map(([key, value]) => [`email_${key}`, value]),
  ),
};

type NotificationPrefs = Record<string, boolean>;

export type BusinessNotificationParams = {
  userId: string;
  title: string;
  message: string;
  type?: string;
  audience?: 'user' | 'admin' | 'sales' | 'owner' | 'staff';
  preferenceType?: string;
  relatedId?: string | null;
  siteUrl?: string;
  emailTemplateKey?: string | null;
  emailVars?: TemplateVars;
};

function jsonObject(value: unknown): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Prisma.JsonObject) };
}

function booleanRecord(value: unknown): NotificationPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
}

export function notificationPrefsFromMetadata(metadata: unknown): NotificationPrefs {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...booleanRecord(jsonObject(metadata).notificationPrefs),
  };
}

function emailPrefKey(type: string): string {
  return `email_${type}`;
}

function wantsInAppNotification(prefs: NotificationPrefs, type: string): boolean {
  return prefs[type] !== false;
}

function wantsEmailNotification(prefs: NotificationPrefs, type: string): boolean {
  return prefs[emailPrefKey(type)] !== false;
}

function encodedRelatedId(relatedId?: string | null): string {
  return encodeURIComponent(String(relatedId || ''));
}

export function getBusinessNotificationActionPath(
  params: Pick<BusinessNotificationParams, 'audience' | 'relatedId' | 'type'>,
): string {
  const type = params.type || 'info';
  const id = encodedRelatedId(params.relatedId);

  if (type === 'backup') return '/admin/settings#backup';
  if (!id) return '/';
  if (type === 'ticket')
    return params.audience === 'admin' ? `/admin/tickets/${id}#messages` : `/my-tickets/${id}#messages`;
  if (type === 'inquiry') {
    return params.audience === 'admin' ? `/admin/inquiries/${id}#messages` : `/my-inquiries/${id}#messages`;
  }
  if (
    type === 'favorite' ||
    type === 'download' ||
    type === 'model_conversion' ||
    type === 'success' ||
    type === 'error'
  ) {
    return `/model/${id}`;
  }
  return '/';
}

function actionLabelForNotification(params: BusinessNotificationParams): string {
  const type = params.type || 'info';
  if (type === 'backup') return '打开备份设置';
  if (type === 'ticket') return '打开工单';
  if (type === 'inquiry') return '打开询价';
  if (type === 'favorite' || type === 'download' || type === 'model_conversion') return '打开模型';
  return '打开详情';
}

function actionVarsForNotification(params: BusinessNotificationParams): TemplateVars {
  const emailVars = params.emailVars || {};
  if (emailVars.actionUrl || emailVars.actionPath) {
    return {
      actionLabel: emailVars.actionLabel || actionLabelForNotification(params),
    };
  }
  return {
    actionPath: getBusinessNotificationActionPath(params),
    actionLabel: emailVars.actionLabel || actionLabelForNotification(params),
  };
}

export async function userWantsNotification(userId: string, type: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    return wantsInAppNotification(notificationPrefsFromMetadata(user?.metadata), type);
  } catch {
    return true;
  }
}

export async function userWantsEmailNotification(userId: string, type: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    return wantsEmailNotification(notificationPrefsFromMetadata(user?.metadata), type);
  } catch {
    return true;
  }
}

function sendEmailInBackground(params: {
  userId: string;
  toEmail: string;
  templateKey: string;
  vars: TemplateVars;
  type: string;
}) {
  void sendTemplateEmail(params.templateKey, params.toEmail, params.vars).catch((err) => {
    logger.warn(
      { err, userId: params.userId, templateKey: params.templateKey, notificationType: params.type },
      'Failed to send notification email',
    );
  });
}

export async function sendBusinessNotification(params: BusinessNotificationParams) {
  if (!prisma) return { notification: null, emailQueued: false };

  const notificationType = params.type || 'info';
  const preferenceType = params.preferenceType || notificationType;

  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, username: true, email: true, role: true, metadata: true },
    });
    if (!user) return { notification: null, emailQueued: false };

    const prefs = notificationPrefsFromMetadata(user.metadata);
    const shouldCreateInApp = wantsInAppNotification(prefs, preferenceType);
    // Admins work from the in-app notification center; avoid noisy operational email floods.
    const allowEmailForRecipient = user.role !== 'ADMIN' && params.audience !== 'admin';
    const shouldSendEmail = Boolean(
      allowEmailForRecipient && params.emailTemplateKey && user.email && wantsEmailNotification(prefs, preferenceType),
    );

    const notification = shouldCreateInApp
      ? await prisma.notification.create({
          data: {
            userId: params.userId,
            title: params.title,
            message: params.message,
            type: notificationType,
            relatedId: params.relatedId || null,
          },
        })
      : null;

    if (shouldSendEmail && params.emailTemplateKey) {
      sendEmailInBackground({
        userId: params.userId,
        toEmail: user.email,
        templateKey: params.emailTemplateKey,
        type: preferenceType,
        vars: {
          username: user.username || user.email,
          siteUrl: params.siteUrl,
          ...actionVarsForNotification(params),
          ...params.emailVars,
        },
      });
    }

    return { notification, emailQueued: shouldSendEmail };
  } catch (err) {
    logger.error({ err, userId: params.userId, notificationType }, 'Failed to deliver business notification');
    return { notification: null, emailQueued: false };
  }
}

export async function createNotification(params: BusinessNotificationParams) {
  const result = await sendBusinessNotification(params);
  return result.notification;
}
