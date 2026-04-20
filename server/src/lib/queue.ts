import { Queue, Worker, type Job } from "bullmq";
import { config } from "./config.js";

const connection = {
  host: config.redisUrl.replace("redis://", "").split(":")[0] || "localhost",
  port: Number(config.redisUrl.replace("redis://", "").split(":")[1]) || 6379,
};

export const conversionQueue = new Queue("model-conversion", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export function createWorker(processor: (job: Job) => Promise<void>) {
  return new Worker("model-conversion", processor, {
    connection,
    concurrency: 2,
  });
}
