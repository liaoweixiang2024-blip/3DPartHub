import { Router } from 'express';
import { createAdminUsersRouter } from './auth/adminUsers.js';
import { createAuthPreferencesRouter, userWantsNotification } from './auth/preferences.js';
import { createAuthProfileRouter } from './auth/profile.js';
import { createAuthSessionRouter } from './auth/session.js';

const router = Router();

router.use(createAuthSessionRouter());
router.use(createAuthProfileRouter());
router.use(createAuthPreferencesRouter());
router.use(createAdminUsersRouter());

export { userWantsNotification };
export default router;
