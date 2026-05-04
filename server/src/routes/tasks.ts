import { Router } from 'express';
import { createConversionQueueRouter } from './tasks/queue.js';
import { createTaskStatusRouter } from './tasks/status.js';
import { createSupportTicketRouter } from './tasks/tickets.js';

const router = Router();

router.use(createConversionQueueRouter());
router.use(createSupportTicketRouter());
router.use(createTaskStatusRouter());

export default router;
