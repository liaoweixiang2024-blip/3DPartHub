import { Router } from "express";
import { createAdminInquiriesRouter } from "./inquiries/adminInquiries.js";
import { createUserInquiriesRouter } from "./inquiries/userInquiries.js";

const router = Router();

router.use(createUserInquiriesRouter());
router.use(createAdminInquiriesRouter());

export default router;
