import { Router } from "express";

import { validate } from "../../middleware/validate.js";
import {
  acceptStaffInvitationController,
  acceptInvitationSchema,
} from "./auth.controller.js";

const router = Router();

router.post(
  "/invitations/:token/accept",
  validate(acceptInvitationSchema),
  acceptStaffInvitationController,
);

export default router;