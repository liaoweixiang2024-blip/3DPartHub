import test from "node:test";
import assert from "node:assert/strict";
import { asyncHandler, badRequest, forbidden, isHttpError } from "./http.js";

test("HttpError helpers expose status and message", () => {
  const err = badRequest("参数错误", { code: "BAD_INPUT", details: { field: "name" } });
  assert.equal(isHttpError(err), true);
  assert.equal(err.status, 400);
  assert.equal(err.message, "参数错误");
  assert.equal(err.code, "BAD_INPUT");
  assert.deepEqual(err.details, { field: "name" });
  assert.equal(forbidden().status, 403);
});

test("asyncHandler forwards rejected errors to next", async () => {
  const error = new Error("boom");
  let captured: unknown;
  const handler = asyncHandler(async () => {
    throw error;
  });

  handler({} as any, {} as any, (err?: unknown) => {
    captured = err;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captured, error);
});
