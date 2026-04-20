import { Router, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireProjectRole } from "../middleware/rbac.js";

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// List user's projects
router.get("/api/projects", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: req.user!.userId },
          { members: { some: { userId: req.user!.userId } } },
        ],
      },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { models: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(projects);
  } catch {
    res.status(500).json({ detail: "获取项目列表失败" });
  }
});

// Create project
router.post("/api/projects", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, description, coverImage } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ detail: "项目名称不能为空" });
    return;
  }
  if (name.length > 100) {
    res.status(400).json({ detail: "项目名称不能超过100个字符" });
    return;
  }

  try {
    const project = await prisma.project.create({
      data: {
        name,
        description,
        coverImage,
        ownerId: req.user!.userId,
        members: {
          create: { userId: req.user!.userId, role: "ADMIN" },
        },
      },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { models: true } },
      },
    });
    res.json(project);
  } catch {
    res.status(500).json({ detail: "创建项目失败" });
  }
});

// Get project detail
router.get("/api/projects/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true, role: true } } },
        },
        models: {
          where: { status: "completed" },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        _count: { select: { models: true } },
      },
    });

    if (!project) {
      res.status(404).json({ detail: "项目不存在" });
      return;
    }

    // Check access
    const isMember = project.members.some((m) => m.userId === req.user!.userId);
    if (!isMember && project.ownerId !== req.user!.userId) {
      res.status(403).json({ detail: "无权访问此项目" });
      return;
    }

    res.json(project);
  } catch {
    res.status(500).json({ detail: "获取项目详情失败" });
  }
});

// Update project
router.put("/api/projects/:id", authMiddleware, requireProjectRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  const { name, description, coverImage } = req.body;

  try {
    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(coverImage !== undefined && { coverImage }),
      },
      include: {
        owner: { select: { id: true, username: true } },
        _count: { select: { models: true } },
      },
    });
    res.json(project);
  } catch {
    res.status(500).json({ detail: "更新项目失败" });
  }
});

// Delete project (owner only)
router.delete("/api/projects/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      res.status(404).json({ detail: "项目不存在" });
      return;
    }
    if (project.ownerId !== req.user!.userId) {
      res.status(403).json({ detail: "只有项目拥有者可以删除项目" });
      return;
    }
    await prisma.project.delete({ where: { id } });
    res.json({ message: "项目已删除" });
  } catch {
    res.status(500).json({ detail: "删除项目失败" });
  }
});

// --- Member management ---

// List members
router.get("/api/projects/:id/members", authMiddleware, async (req: AuthRequest, res: Response) => {
  const projectId = param(req, "id");
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, username: true, avatar: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    });
    res.json(members);
  } catch {
    res.status(500).json({ detail: "获取成员列表失败" });
  }
});

// Add member
router.post("/api/projects/:id/members", authMiddleware, requireProjectRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const projectId = param(req, "id");
  const { userId, role } = req.body;

  if (!userId) {
    res.status(400).json({ detail: "缺少用户 ID" });
    return;
  }

  try {
    const member = await prisma.projectMember.create({
      data: { projectId, userId, role: role || "VIEWER" },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    res.json(member);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ detail: "用户已是项目成员" });
      return;
    }
    res.status(500).json({ detail: "添加成员失败" });
  }
});

// Update member role
router.put("/api/projects/:id/members/:userId", authMiddleware, requireProjectRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const projectId = param(req, "id");
  const userId = param(req, "userId");
  const { role } = req.body;

  if (!role) {
    res.status(400).json({ detail: "缺少角色" });
    return;
  }

  try {
    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { role },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    res.json(member);
  } catch {
    res.status(404).json({ detail: "成员不存在" });
  }
});

// Remove member
router.delete("/api/projects/:id/members/:userId", authMiddleware, requireProjectRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const projectId = param(req, "id");
  const userId = param(req, "userId");
  try {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
    res.json({ message: "成员已移除" });
  } catch {
    res.status(404).json({ detail: "成员不存在" });
  }
});

export default router;
