import { Router } from "express";

import { acceptStaffInvitationController } from "./auth.controller.js";

const router = Router();

router.post(
  "/invitations/:token/accept",
  acceptStaffInvitationController,
);

export default router;