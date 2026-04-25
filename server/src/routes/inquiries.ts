import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { createNotification } from "./notifications.js";

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// ========== Public endpoints ==========

// Create inquiry
router.post("/api/inquiries", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { items, remark, company, contactName, contactPhone } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ detail: "至少需要一个询价项目" });
      return;
    }

    // Resolve product names/specs from productId
    const productIds = items.map((i: any) => i.productId).filter(Boolean) as string[];
    const products = productIds.length > 0
      ? await prisma.selectionProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, modelNo: true, specs: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const inquiry = await prisma.inquiry.create({
      data: {
        userId: req.user!.userId,
        status: "submitted",
        remark: remark || null,
        company: company || null,
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        items: {
          create: items.map((item: any) => {
            const product = item.productId ? productMap.get(item.productId) : null;
            return {
              productId: item.productId || null,
              productName: product?.name || item.productName || "未知产品",
              modelNo: product?.modelNo || item.modelNo || null,
              specs: product?.specs || item.specs || null,
              qty: item.qty || 1,
              remark: item.remark || null,
            };
          }),
        },
      },
      include: { items: true },
    });

    // Notify admins
    try {
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          title: "新询价单",
          message: `用户提交了一份新的询价单，包含 ${inquiry.items.length} 个产品`,
          type: "inquiry",
          relatedId: inquiry.id,
        });
      }
    } catch {}

    res.status(201).json(inquiry);
  } catch (err) {
    console.error("[Inquiries] Create error:", err);
    res.status(500).json({ detail: "创建询价单失败" });
  }
});

// List my inquiries
router.get("/api/inquiries", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const inquiries = await prisma.inquiry.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      include: {
        items: { select: { id: true, productName: true, modelNo: true, qty: true, unitPrice: true } },
      },
    });
    res.json(inquiries);
  } catch (err) {
    console.error("[Inquiries] List error:", err);
    res.status(500).json({ detail: "获取询价单列表失败" });
  }
});

// Get inquiry detail
router.get("/api/inquiries/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = param(req, "id");
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: {
        items: true,
        messages: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
          orderBy: { createdAt: "asc" },
        },
        user: { select: { id: true, username: true, email: true, avatar: true, company: true, phone: true } },
      },
    });
    if (!inquiry) {
      res.status(404).json({ detail: "询价单不存在" });
      return;
    }
    if (inquiry.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权访问" });
      return;
    }
    res.json(inquiry);
  } catch (err) {
    console.error("[Inquiries] Get error:", err);
    res.status(500).json({ detail: "获取询价单详情失败" });
  }
});

// Cancel inquiry
router.put("/api/inquiries/:id/cancel", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = param(req, "id");
    const inquiry = await prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) {
      res.status(404).json({ detail: "询价单不存在" });
      return;
    }
    if (inquiry.userId !== req.user!.userId) {
      res.status(403).json({ detail: "无权操作" });
      return;
    }
    if (inquiry.status !== "submitted" && inquiry.status !== "draft") {
      res.status(400).json({ detail: "当前状态无法取消" });
      return;
    }
    const updated = await prisma.inquiry.update({
      where: { id },
      data: { status: "cancelled" },
    });
    res.json(updated);
  } catch (err) {
    console.error("[Inquiries] Cancel error:", err);
    res.status(500).json({ detail: "取消询价单失败" });
  }
});

// Send message
router.post("/api/inquiries/:id/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = param(req, "id");
    const { content, attachment } = req.body;
    if ((!content || !content.trim()) && !attachment) {
      res.status(400).json({ detail: "消息内容不能为空" });
      return;
    }

    const inquiry = await prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) {
      res.status(404).json({ detail: "询价单不存在" });
      return;
    }
    if (inquiry.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权操作" });
      return;
    }

    const isAdmin = req.user!.role === "ADMIN";
    const message = await prisma.inquiryMessage.create({
      data: {
        inquiryId: id,
        userId: req.user!.userId,
        content: content?.trim() || "",
        attachment: attachment || null,
        isAdmin,
      },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });

    // Notify the other party
    try {
      const targetUserId = isAdmin ? inquiry.userId : null;
      if (isAdmin) {
        await createNotification({
          userId: targetUserId!,
          title: "询价单回复",
          message: `管理员回复了您的询价单`,
          type: "inquiry",
          relatedId: id,
        });
      } else {
        const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
        for (const admin of admins) {
          await createNotification({
            userId: admin.id,
            title: "询价单新回复",
            message: `用户回复了询价单`,
            type: "inquiry",
            relatedId: id,
          });
        }
      }
    } catch {}

    res.json(message);
  } catch (err) {
    console.error("[Inquiries] Message error:", err);
    res.status(500).json({ detail: "发送消息失败" });
  }
});

// ========== Admin endpoints ==========

// List all inquiries
router.get("/api/admin/inquiries", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const status = req.query.status as string | undefined;

    const where = status && status !== "all" ? { status } : {};
    const [total, items] = await Promise.all([
      prisma.inquiry.count({ where }),
      prisma.inquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, username: true, email: true, company: true } },
          items: { select: { id: true, productName: true, modelNo: true, qty: true, unitPrice: true } },
        },
      }),
    ]);
    res.json({ total, page, pageSize, items });
  } catch (err) {
    console.error("[Inquiries] Admin list error:", err);
    res.status(500).json({ detail: "获取询价单列表失败" });
  }
});

// Submit quote
router.put("/api/admin/inquiries/:id/quote", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  try {
    const id = param(req, "id");
    const { items: quoteItems, totalAmount, adminRemark } = req.body;

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!inquiry) {
      res.status(404).json({ detail: "询价单不存在" });
      return;
    }

    // Update each item's unitPrice
    if (Array.isArray(quoteItems)) {
      await prisma.$transaction(
        quoteItems
          .filter((qi: any) => qi.unitPrice !== undefined)
          .map((qi: any) =>
            prisma.inquiryItem.update({
              where: { id: qi.id },
              data: { unitPrice: qi.unitPrice },
            })
          )
      );
    }

    const updated = await prisma.inquiry.update({
      where: { id },
      data: {
        status: "quoted",
        totalAmount: totalAmount || null,
        adminRemark: adminRemark || null,
      },
      include: {
        items: true,
        user: { select: { id: true, username: true } },
      },
    });

    // Notify user
    await createNotification({
      userId: inquiry.userId,
      title: "询价单已报价",
      message: `您的询价单已有报价，请查看`,
      type: "inquiry",
      relatedId: id,
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error("[Inquiries] Quote error:", err);
    res.status(500).json({ detail: "报价失败" });
  }
});

// Update inquiry status (accept / reject)
router.put("/api/admin/inquiries/:id/status", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  try {
    const id = param(req, "id");
    const { status } = req.body;
    if (!["accepted", "rejected"].includes(status)) {
      res.status(400).json({ detail: "无效状态" });
      return;
    }
    const updated = await prisma.inquiry.update({
      where: { id },
      data: { status },
    });

    const STATUS_LABELS: Record<string, string> = { accepted: "已接受", rejected: "已拒绝" };
    await createNotification({
      userId: updated.userId,
      title: "询价单状态更新",
      message: `您的询价单状态已更新为「${STATUS_LABELS[status] || status}」`,
      type: "inquiry",
      relatedId: id,
    }).catch(() => {});

    res.json(updated);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "询价单不存在" });
      return;
    }
    console.error("[Inquiries] Status update error:", err);
    res.status(500).json({ detail: "更新状态失败" });
  }
});

export default router;
