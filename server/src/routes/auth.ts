import { Router } from 'express';
import { createAdminUsersRouter } from './auth/adminUsers.js';
import { createPasswordResetRouter } from './auth/passwordReset.js';
import { createAuthPreferencesRouter, userWantsNotification } from './auth/preferences.js';
import { createAuthProfileRouter } from './auth/profile.js';
import { createAuthSessionRouter } from './auth/session.js';

const router = Router();

router.use(createAuthSessionRouter());
router.use(createAuthProfileRouter());
router.use(createAuthPreferencesRouter());
router.use(createPasswordResetRouter());
router.use(createAdminUsersRouter());

export { userWantsNotification };
export default router;
