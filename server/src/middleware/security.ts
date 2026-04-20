import rateLimit from "express-rate-limit";
import helmet from "helmet";

// Rate limiting configurations
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "请求过于频繁，请稍后再试" },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "上传次数超出限制" },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "登录尝试过多，请稍后再试" },
});

// Helmet security configuration
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
