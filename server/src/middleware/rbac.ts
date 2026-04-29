import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import type { AuthRequest } from "./auth.js";
import { Role } from "@prisma/client";

/**
 * Check if user has one of the required global roles.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ detail: "未认证" });
      return;
    }
    if (roles.includes(req.user.role)) {
      next();
      return;
    }
    res.status(403).json({ detail: "权限不足" });
  };
}

/**
 * Check if user has the required role within a project.
 * Looks up projectId from req.params.projectId or req.body.projectId.
 */
const PROJECT_ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
};

export function requireProjectRole(...roles: Role[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ detail: "未认证" });
      return;
    }

    const projectId = req.params.projectId || req.params.id || req.body.projectId;
    if (!projectId) {
      res.status(400).json({ detail: "缺少项目 ID" });
      return;
    }

    // Project owner always has full access
    try {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        res.status(404).json({ detail: "项目不存在" });
        return;
      }
      if (project.ownerId === req.user.userId) {
        next();
        return;
      }

      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: req.user.userId } },
      });

      if (!member) {
        res.status(403).json({ detail: "不是项目成员" });
        return;
      }

      const requiredRank = Math.min(...roles.map((role) => PROJECT_ROLE_RANK[role]));
      if (PROJECT_ROLE_RANK[member.role] >= requiredRank) {
        next();
        return;
      }

      res.status(403).json({ detail: "项目权限不足" });
    } catch (err) {
      res.status(500).json({ detail: "权限检查失败" });
    }
  };
}
