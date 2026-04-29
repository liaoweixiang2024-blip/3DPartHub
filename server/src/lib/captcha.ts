import svgCaptcha from "svg-captcha";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

const redis = new Redis(config.redisUrl);
redis.on("error", (err) => console.error("Redis (captcha) error:", err.message));

interface CaptchaResult {
  captchaId: string;
  captchaSvg: string;
}

export async function generateCaptcha(): Promise<CaptchaResult> {
  const captcha = svgCaptcha.create({
    size: 4,
    noise: 3,
    color: true,
    background: "#f0f0f0",
    width: 120,
    height: 40,
  });

  const captchaId = `cap_${randomBytes(18).toString("base64url")}`;
  const key = `captcha:${captchaId}`;

  await redis.set(key, captcha.text.toLowerCase(), "EX", 300); // 5 min TTL

  return { captchaId, captchaSvg: captcha.data };
}

export async function verifyCaptcha(captchaId: string, text: string): Promise<boolean> {
  const key = `captcha:${captchaId}`;
  const stored = await redis.get(key);
  if (!stored) return false;
  await redis.del(key); // one-time use
  return stored === text.toLowerCase();
}

export async function checkRateLimit(key: string, ttlSeconds: number): Promise<boolean> {
  const exists = await redis.exists(key);
  if (exists) return false; // rate limited
  await redis.set(key, "1", "EX", ttlSeconds);
  return true;
}

export async function storeEmailCode(email: string, code: string): Promise<void> {
  const key = `email_code:${email}`;
  await redis.set(key, code, "EX", 600); // 10 min TTL
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const key = `email_code:${email}`;
  const stored = await redis.get(key);
  if (!stored) return false;
  await redis.del(key); // one-time use
  return stored === code;
}
