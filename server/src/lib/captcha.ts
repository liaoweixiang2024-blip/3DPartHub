import svgCaptcha from "svg-captcha";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "captcha" });

export const redis = new Redis(config.redisUrl, {
  connectTimeout: 2000,
  commandTimeout: 1000,
  maxRetriesPerRequest: 0,
  retryStrategy(times) { if (times > 3) return null; return Math.min(times * 200, 2000); },
});
redis.on("error", (err) => log.error({ err }, "Redis error"));

interface CaptchaResult {
  captchaId: string;
  captchaSvg: string;
}

export async function generateCaptcha(ttlSeconds = 300): Promise<CaptchaResult> {
  const captcha = svgCaptcha.create({
    size: 6,
    noise: 5,
    color: true,
    background: "#f0f0f0",
    width: 150,
    height: 44,
    ignoreChars: "o0il1",
  });

  const captchaId = `cap_${randomBytes(18).toString("base64url")}`;
  const key = `captcha:${captchaId}`;

  await redis.set(key, captcha.text.toLowerCase(), "EX", Math.max(60, ttlSeconds));

  return { captchaId, captchaSvg: captcha.data };
}

export async function verifyCaptcha(captchaId: string, text: string): Promise<boolean> {
  const key = `captcha:${captchaId}`;
  const result = await redis.eval(
    `local stored = redis.call("GET", KEYS[1])
     if not stored then return 0 end
     if stored == ARGV[1] then
       redis.call("DEL", KEYS[1])
       return 1
     end
     return 0`,
    1,
    key,
    text.toLowerCase(),
  );
  return result === 1;
}

export async function checkRateLimit(key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, "1", "EX", Math.max(1, ttlSeconds), "NX");
  return result === "OK";
}

export async function storeEmailCode(email: string, code: string, ttlSeconds = 600): Promise<void> {
  const key = `email_code:${email}`;
  await redis.set(key, code, "EX", Math.max(60, ttlSeconds));
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const key = `email_code:${email}`;
  const result = await redis.eval(
    `local stored = redis.call("GET", KEYS[1])
     if not stored then return 0 end
     if stored == ARGV[1] then
       redis.call("DEL", KEYS[1])
       return 1
     end
     return 0`,
    1,
    key,
    code,
  );
  return result === 1;
}
