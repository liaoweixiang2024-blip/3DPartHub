import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "test-secret";

const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = await import("./jwt.js");

test("access and refresh tokens are type-bound", () => {
  const payload = { userId: "user-1", role: "VIEWER" };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  assert.equal(verifyAccessToken(accessToken).tokenType, "access");
  assert.equal(verifyRefreshToken(refreshToken).tokenType, "refresh");
  assert.throws(() => verifyRefreshToken(accessToken), /Invalid refresh token/);
  assert.throws(() => verifyAccessToken(refreshToken), /Invalid access token/);
});
